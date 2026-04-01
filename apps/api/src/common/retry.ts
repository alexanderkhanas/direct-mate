import { Logger } from '@nestjs/common';

const logger = new Logger('Retry');

/**
 * Retry an async operation with exponential backoff.
 * For fire-and-forget operations that must not silently fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { label: string; maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const { label, maxAttempts = 3, baseDelayMs = 1000 } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(
        `${label}: attempt ${attempt}/${maxAttempts} failed — ${(err as Error).message}${isLast ? ' (giving up)' : `, retrying in ${delay}ms`}`,
      );
      if (isLast) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}
