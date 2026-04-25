import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { bootstrap, teardown, resetDemoSpend, BootstrapResult } from './setup';

describe('demo budget cap', () => {
  let ctx: BootstrapResult;
  let classifierModel: string;

  beforeAll(async () => {
    ctx = await bootstrap();
    classifierModel =
      ctx.app.get(ConfigService).get<string>('openai.model') ?? 'gpt-5.4-mini';
  });

  afterAll(async () => {
    await teardown(ctx);
  });

  beforeEach(async () => {
    await resetDemoSpend(ctx.dataSource);
    ctx.replyEngineMock.mockClear();
  });

  it("returns budget_exceeded and skips the engine when today's classifier spend is over the cap", async () => {
    await ctx.dataSource.query(
      `INSERT INTO demo_spend_daily (day, model, usd_cents, calls)
       VALUES (CURRENT_DATE, $1, 99999, 9999)
       ON CONFLICT (day, model) DO UPDATE SET usd_cents = 99999`,
      [classifierModel],
    );

    const res = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', '198.51.100.10')
      .send({ sessionKey: `budget-${Date.now()}`, text: 'привіт' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reply: null,
      decision: 'budget_exceeded',
      scenario: null,
      isAggregated: false,
      handoff: { required: false, reason: null },
    });
    // Engine must NOT have been called once the cap was hit.
    expect(ctx.replyEngineMock).not.toHaveBeenCalled();
  });

  it('lets traffic through when spend is under the cap', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', '198.51.100.11')
      .send({ sessionKey: `budget-ok-${Date.now()}`, text: 'привіт' });

    expect(res.status).toBe(200);
    expect(res.body.decision).not.toBe('budget_exceeded');
    expect(ctx.replyEngineMock).toHaveBeenCalledTimes(1);
  });
});
