import { clientIp } from './client-ip-throttler.guard';

describe('clientIp', () => {
  it("keys on nginx's X-Real-IP, not on req.ip, which a caller sets through X-Forwarded-For", () => {
    expect(clientIp({ headers: { 'x-real-ip': '203.0.113.7' }, ip: '6.6.6.6' })).toBe('203.0.113.7');
  });

  it('falls back to req.ip without nginx (development)', () => {
    expect(clientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
    expect(clientIp({ headers: { 'x-real-ip': '  ' }, ip: '127.0.0.1' })).toBe('127.0.0.1');
  });
});
