import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The free trial starts when the owner turns the bot on, not at sign-up:
 * 14 days or 200 conversations, whichever comes first. Setup and the test
 * chat are free and have no clock.
 *
 * - `trial_started_at`: null until go-live. Trials that already exist
 *   started at sign-up, so they keep that date.
 * - `reminders_sent`: which reminders (3 days, 1 day, 80% / 100% of the
 *   conversations, expired) have gone out, so each goes out once.
 * - A `trial` plan config, so limit lookups find one; inactive, so it isn't
 *   offered as a plan to buy.
 */
export class TrialStartsAtGoLive1780100000000 implements MigrationInterface {
  name = 'TrialStartsAtGoLive1780100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        ADD COLUMN "trial_started_at" timestamptz,
        ADD COLUMN "reminders_sent" text[] NOT NULL DEFAULT '{}'
    `);
    await queryRunner.query(`UPDATE "subscription_plans" SET "trial_started_at" = "created_at" WHERE "plan_type" = 'trial'`);
    await queryRunner.query(`
      INSERT INTO "subscription_plan_configs"
        (plan_type, display_name, price, conversation_limit, ig_accounts_limit, products_limit,
         connections_limit, team_members_limit, history_days, is_active, sort_order)
      SELECT 'trial', 'Пробний період', 0, 200, 1, 500, 2, 1, 30, false, 0
       WHERE NOT EXISTS (SELECT 1 FROM "subscription_plan_configs" WHERE plan_type = 'trial')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "subscription_plan_configs" WHERE plan_type = 'trial'`);
    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        DROP COLUMN "reminders_sent",
        DROP COLUMN "trial_started_at"
    `);
  }
}
