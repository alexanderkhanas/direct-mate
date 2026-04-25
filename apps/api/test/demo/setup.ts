import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/http-exception.filter';
import { createDemoCorsMiddleware } from '../../src/modules/demo/demo-cors.middleware';
import { ReplyEngineService } from '../../src/modules/conversations/reply-engine.service';
import { DemoMessageBufferService } from '../../src/modules/demo/demo-message-buffer.service';
import { DemoRateLimiterService } from '../../src/modules/demo/demo-rate-limiter.service';
import { ReplyDecision } from '@direct-mate/shared';

export interface BootstrapResult {
  app: NestExpressApplication;
  dataSource: DataSource;
  replyEngineMock: jest.SpyInstance;
}

/**
 * Mock reply payload returned for all engine calls in e2e — keeps tests
 * deterministic, fast, and free of OpenAI dependency.
 */
export const STUB_ENGINE_RESPONSE = {
  decision: ReplyDecision.Reply,
  reply: { text: 'привіт', sendNow: true, imageUrls: undefined },
  handoff: { required: false, reason: null },
  stateUpdate: null,
  templateScenario: 'greeting',
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

  // Replace replyEngineService.process so tests never hit OpenAI.
  const buffer = app.get(DemoMessageBufferService);
  const engine = (buffer as unknown as { replyEngineService: ReplyEngineService })
    .replyEngineService;
  const replyEngineMock = jest
    .spyOn(engine, 'process')
    .mockResolvedValue(STUB_ENGINE_RESPONSE as never);

  return { app, dataSource, replyEngineMock };
}

export async function teardown(result: BootstrapResult): Promise<void> {
  result.replyEngineMock.mockRestore();
  await result.app.close();
}

/**
 * Wipes today's spend rows so budget tests start at zero spend.
 */
export async function resetDemoSpend(dataSource: DataSource): Promise<void> {
  await dataSource.query(`DELETE FROM demo_spend_daily WHERE day = CURRENT_DATE`);
}
