import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Failed sign-in attempts per account, on top of the per-address limit on the
 * login route (spread across addresses, guesses would get past that). A wrong
 * password and a wrong code count alike; after `MAX_FAILED_ATTEMPTS` in a row
 * the account waits `LOCK_MINUTES`, then gets a fresh count.
 */

export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_MINUTES = 15;

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export async function recordFailure(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET
        locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
        failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
      WHERE id = $1`,
    [userId, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
  );
}

export async function clearFailures(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1 AND (failed_logins > 0 OR locked_until IS NOT NULL)`,
    [userId],
  );
}

/** Throws while the account is locked. */
export function assertNotLocked(lockedUntil: Date | null | undefined, now = new Date()): void {
  if (!lockedUntil || lockedUntil <= now) return;
  throw new HttpException(
    {
      message: 'Too many attempts. Try again later.',
      details: { code: 'locked', retryAfterSeconds: Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000) },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
