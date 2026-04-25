import * as request from 'supertest';
import { bootstrap, teardown, BootstrapResult } from './setup';

describe('demo length cap', () => {
  let ctx: BootstrapResult;

  beforeAll(async () => {
    ctx = await bootstrap();
  });

  afterAll(async () => {
    await teardown(ctx);
  });

  it('rejects 501-char text with 400 too_long', async () => {
    const text = 'a'.repeat(501);
    const res = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ sessionKey: `len-${Date.now()}`, text });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const message = res.body.error.message;
    if (Array.isArray(message)) {
      expect(message).toContain('too_long');
    } else {
      expect(String(message)).toContain('too_long');
    }
  });

  it('accepts 500-char text', async () => {
    const text = 'a'.repeat(500);
    const res = await request(ctx.app.getHttpServer())
      .post('/demo/message')
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ sessionKey: `len-ok-${Date.now()}`, text });

    expect(res.status).toBe(200);
  });
});
