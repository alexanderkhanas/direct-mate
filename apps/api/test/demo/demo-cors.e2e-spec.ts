import * as request from 'supertest';
import { bootstrap, teardown, BootstrapResult } from './setup';

describe('demo CORS', () => {
  let ctx: BootstrapResult;

  beforeAll(async () => {
    ctx = await bootstrap();
  });

  afterAll(async () => {
    await teardown(ctx);
  });

  it('rejects preflight from a non-whitelisted origin with 403', async () => {
    const res = await request(ctx.app.getHttpServer())
      .options('/demo/message')
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts preflight from https://directmate.ua and echoes the origin', async () => {
    const res = await request(ctx.app.getHttpServer())
      .options('/demo/message')
      .set('Origin', 'https://directmate.ua')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://directmate.ua');
  });

  it('accepts preflight from a localhost origin (dev)', async () => {
    const res = await request(ctx.app.getHttpServer())
      .options('/demo/message')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
