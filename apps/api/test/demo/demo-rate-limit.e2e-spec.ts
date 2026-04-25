import * as request from 'supertest';
import { bootstrap, teardown, resetDemoSpend, BootstrapResult } from './setup';

describe('demo rate limit', () => {
  let ctx: BootstrapResult;

  beforeAll(async () => {
    ctx = await bootstrap();
    await resetDemoSpend(ctx.dataSource);
  });

  afterAll(async () => {
    await teardown(ctx);
  });

  it('blocks the 6th distinct sessionKey from the same IP within an hour', async () => {
    const ip = '203.0.113.42';

    for (let i = 1; i <= 5; i++) {
      const res = await request(ctx.app.getHttpServer())
        .post('/demo/message')
        .set('X-Forwarded-For', ip)
        .send({ sessionKey: `rl-${i}`, text: 'привіт' });
      expect(res.status).toBe(200);
    }

    const sixth = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', ip)
      .send({ sessionKey: 'rl-6', text: 'привіт' });

    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
    expect(sixth.headers['retry-after']).toBeDefined();
    expect(parseInt(sixth.headers['retry-after'], 10)).toBeGreaterThan(0);
  });

  it('allows replays of an already-seen sessionKey even after the limit', async () => {
    const ip = '203.0.113.43';
    for (let i = 1; i <= 5; i++) {
      await request(ctx.app.getHttpServer())
        .post('/demo/message')
        .set('X-Forwarded-For', ip)
        .send({ sessionKey: `replay-${i}`, text: 'привіт' });
    }
    // Replaying an existing sessionKey is free — the limiter only counts NEW
    // sessions.
    const replay = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', ip)
      .send({ sessionKey: 'replay-1', text: 'ще раз' });
    expect(replay.status).toBe(200);
  });
});
