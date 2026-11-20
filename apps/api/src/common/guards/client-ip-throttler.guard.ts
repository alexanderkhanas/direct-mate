import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * `@Throttle` limits per client address. `main.ts` trusts any
 * `X-Forwarded-For` (`trust proxy: true`), so `req.ip` is whatever the caller
 * wrote there, and a limit keyed on it is skipped by changing the header.
 * nginx overwrites `X-Real-IP` with the address it saw, so that is the key
 * behind it; without nginx (development) it falls back to `req.ip`.
 *
 * Applied per route (`@UseGuards`), not globally: `ThrottlerModule`'s default
 * would otherwise limit every endpoint, webhooks included.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return clientIp(req);
  }
}

export function clientIp(req: { headers?: Record<string, unknown>; ip?: string }): string {
  const real = req.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.ip ?? 'unknown';
}
