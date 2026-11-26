import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two-factor sign-in with an authenticator app (modules/auth/two-factor/):
 * the code secret (encrypted like the Instagram token), the last code step
 * used (a code works once), recovery codes kept only as hashes, a time before
 * which a user's login tokens no longer count, and a lock after repeated
 * failed attempts. A store can require 2FA of its users; superadmins always
 * need it.
 */
export class TwoFactor1781300000000 implements MigrationInterface {
  name = 'TwoFactor1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN totp_secret_encrypted text,
        ADD COLUMN totp_pending_secret_encrypted text,
        ADD COLUMN totp_enabled_at timestamptz,
        ADD COLUMN totp_last_step bigint,
        ADD COLUMN sessions_valid_after timestamptz,
        ADD COLUMN failed_logins integer NOT NULL DEFAULT 0,
        ADD COLUMN locked_until timestamptz
    `);
    await queryRunner.query(
      `ALTER TABLE tenant_settings ADD COLUMN require_two_factor boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      CREATE TABLE user_recovery_codes (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash text NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_user_recovery_codes_user ON user_recovery_codes (user_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE user_recovery_codes`);
    await queryRunner.query(`ALTER TABLE tenant_settings DROP COLUMN require_two_factor`);
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN totp_secret_encrypted,
        DROP COLUMN totp_pending_secret_encrypted,
        DROP COLUMN totp_enabled_at,
        DROP COLUMN totp_last_step,
        DROP COLUMN sessions_valid_after,
        DROP COLUMN failed_logins,
        DROP COLUMN locked_until
    `);
  }
}
