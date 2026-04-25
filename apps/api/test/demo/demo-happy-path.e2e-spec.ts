import * as request from 'supertest';
import { bootstrap, teardown, resetDemoSpend, BootstrapResult } from './setup';

describe('demo happy path', () => {
  let ctx: BootstrapResult;

  beforeAll(async () => {
    ctx = await bootstrap();
    await resetDemoSpend(ctx.dataSource);
  });

  afterAll(async () => {
    await teardown(ctx);
  });

  it('returns the full DemoReplyPayload shape on a normal request', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ sessionKey: `happy-${Date.now()}`, text: 'привіт' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reply: { text: expect.any(String) },
      decision: expect.any(String),
      scenario: expect.anything(),
      isAggregated: false,
      handoff: { required: false, reason: null },
    });
  });
});
