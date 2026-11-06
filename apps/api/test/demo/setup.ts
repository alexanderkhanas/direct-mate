import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/http-exception.filter';
import { createDemoCorsMiddleware } from '../../src/modules/demo/demo-cors.middleware';
import { TurnRunner } from '../../src/modules/conversations/turn-runner.service';
import { DemoMessageBufferService } from '../../src/modules/demo/demo-message-buffer.service';
import { DemoRateLimiterService } from '../../src/modules/demo/demo-rate-limiter.service';

export interface BootstrapResult {
  app: NestExpressApplication;
  dataSource: DataSource;
  turnRunnerMock: jest.SpyInstance;
}

/**
 * Turn result returned for every demo turn in e2e — keeps tests deterministic,
 * fast, and free of model calls.
 */
export const STUB_TURN_RESULT = {
  status: 'replied',
  messages: [{ kind: 'reply', text: 'привіт' }],
  handoff: null,
  committed: { orderId: null, paymentDetailsSent: false },
  agent: {
    reply: 'привіт',
    effects: [],
    handoff: null,
    attempts: [],
    steps: [
      {
        attempt: 1,
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'search_products', input: { query: 'сукня' } }],
        toolResults: [],
      },
    ],
    model: 'gpt-5.4-mini',
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10 },
    durationMs: 1,
  },
  traceId: 'e2e-stub',
};

export async function bootstrap(): Promise<BootstrapResult> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();

  // Mirror main.ts setup that affects the demo endpoint.
  app.set('trust proxy', true);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  const demoAllowedOrigins = config.get<string[]>('demo.cors.allowedOrigins') ?? [];
  app.use('/demo', createDemoCorsMiddleware(demoAllowedOrigins));

  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:5173',
    credentials: false,
  });

  await app.init();

  const dataSource = app.get(DataSource);

  // Reset rate limiter between specs so each suite starts fresh.
  const rateLimiter = app.get(DemoRateLimiterService) as unknown as {
    entries: Map<string, unknown>;
  };
  rateLimiter.entries.clear();

  // Replace the turn runner so tests never call a model.
  const buffer = app.get(DemoMessageBufferService);
  const runner = (buffer as unknown as { turnRunner: TurnRunner }).turnRunner;
  const turnRunnerMock = jest.spyOn(runner, 'run').mockResolvedValue(STUB_TURN_RESULT as never);

  return { app, dataSource, turnRunnerMock };
}

export async function teardown(result: BootstrapResult): Promise<void> {
  result.turnRunnerMock.mockRestore();
  await result.app.close();
}

/**
 * Wipes today's spend rows so budget tests start at zero spend.
 */
export async function resetDemoSpend(dataSource: DataSource): Promise<void> {
  await dataSource.query(`DELETE FROM demo_spend_daily WHERE day = CURRENT_DATE`);
}
