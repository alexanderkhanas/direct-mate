// For someone who lost both their phone and their recovery codes: turns their
// two-factor sign-in off and ends their sessions. If 2FA is required of them
// (a superadmin, or a store with `require_two_factor`), they set it up again at
// their next sign-in. `--unlock` only lifts the lock after repeated failed attempts.
//
//   npm run 2fa:reset -- --email owner@store.ua [--unlock]
//   npm run 2fa:reset:prod -- --email owner@store.ua        (on the server, compiled)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { returnedRows } from '../common/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email');
  const unlockOnly = process.argv.includes('--unlock');
  if (!email) {
    console.error('Usage: 2fa:reset --email <email> [--unlock]');
    process.exit(1);
  }
  await AppDataSource.initialize();
  try {
    const sql = unlockOnly
      ? `UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = now()
          WHERE email = $1 RETURNING id, email, role`
      : `UPDATE users SET totp_secret_encrypted = NULL, totp_pending_secret_encrypted = NULL, totp_enabled_at = NULL,
                          totp_last_step = NULL, failed_logins = 0, locked_until = NULL,
                          sessions_valid_after = now(), updated_at = now()
          WHERE email = $1 RETURNING id, email, role`;
    const users = returnedRows<{ id: string; email: string; role: string }>(await AppDataSource.query(sql, [email]));
    if (users.length === 0) throw new Error(`No user with email ${email}`);
    if (!unlockOnly) {
      await AppDataSource.query(`DELETE FROM user_recovery_codes WHERE user_id = ANY($1::uuid[])`, [users.map((u) => u.id)]);
    }
    for (const u of users) {
      console.log(unlockOnly ? `Unlocked ${u.email} (${u.role})` : `2FA reset for ${u.email} (${u.role}); their sessions ended`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
