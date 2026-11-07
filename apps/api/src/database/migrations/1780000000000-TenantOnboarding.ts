import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Self-serve setup (onboarding round one). What a store has actually set up
 * (Instagram, products, notes, Telegram) is read from the real tables; this
 * row only holds what has nowhere else to live: steps the owner skipped,
 * drafts in progress (store notes, the interview, the Instagram history
 * import), when they tried the bot, asked for help, and finished.
 *
 * Every store that exists before this migration is marked finished, so only
 * new sign-ups see the setup flow.
 */
export class TenantOnboarding1780000000000 implements MigrationInterface {
  name = 'TenantOnboarding1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenant_onboarding" (
        "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
        "steps_skipped" text[] NOT NULL DEFAULT '{}',
        "notes_draft" jsonb,
        "interview" jsonb,
        "history_import" jsonb,
        "help_requested_at" timestamptz,
        "tested_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      INSERT INTO "tenant_onboarding" ("tenant_id", "completed_at")
      SELECT id, now() FROM tenants
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_onboarding"`);
  }
}
