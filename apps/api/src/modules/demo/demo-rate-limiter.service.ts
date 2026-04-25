import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Entry {
  sessionKeys: Set<string>;
  windowStart: number;
}

const WINDOW_MS = 3_600_000;
const JANITOR_INTERVAL_MS = 60_000;

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

@Injectable()
export class DemoRateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoRateLimiterService.name);
  private readonly entries = new Map<string, Entry>();
  private readonly limit: number;
  private readonly janitor: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {
    this.limit =
      this.config.get<number>('demo.rateLimit.sessionsPerHour') ?? 5;
    this.janitor = setInterval(() => this.sweep(), JANITOR_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.janitor);
    this.entries.clear();
  }

  /**
   * Counts NEW sessionKeys per IP within a rolling 1h window. Existing
   * sessionKeys (a session that's already been seen) pass through freely.
   */
  acceptSession(ip: string, sessionKey: string): RateLimitDecision {
    const now = Date.now();
    let entry = this.entries.get(ip);
    if (!entry || now - entry.windowStart > WINDOW_MS) {
      entry = { sessionKeys: new Set(), windowStart: now };
      this.entries.set(ip, entry);
    }
    if (entry.sessionKeys.has(sessionKey)) return { ok: true };
    if (entry.sessionKeys.size >= this.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000),
      );
      return { ok: false, retryAfterSeconds };
    }
    entry.sessionKeys.add(sessionKey);
    return { ok: true };
  }

  private sweep(): void {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [ip, entry] of this.entries.entries()) {
      if (entry.windowStart < cutoff) {
        this.entries.delete(ip);
      }
    }
  }
}
