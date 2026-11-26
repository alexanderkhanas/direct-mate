import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New monthly prices (kopiyky): Starter 4 099, Professional 6 399, Business 7 999 UAH.
 *
 * Only new checkouts get them. A store that already pays keeps the amount its
 * Monobank subscription was created with, until it subscribes again.
 *
 * The down restores the prices the plans were first seeded with, not whatever
 * was set in the admin before this ran.
 */
export class PlanPrices1781400000000 implements MigrationInterface {
  name = 'PlanPrices1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE subscription_plan_configs SET price = 409900, updated_at = now() WHERE plan_type = 'starter'`);
    await queryRunner.query(`UPDATE subscription_plan_configs SET price = 639900, updated_at = now() WHERE plan_type = 'professional'`);
    await queryRunner.query(`UPDATE subscription_plan_configs SET price = 799900, updated_at = now() WHERE plan_type = 'business'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE subscription_plan_configs SET price = 409900, updated_at = now() WHERE plan_type = 'starter'`);
    await queryRunner.query(`UPDATE subscription_plan_configs SET price = 819900, updated_at = now() WHERE plan_type = 'professional'`);
    await queryRunner.query(`UPDATE subscription_plan_configs SET price = 1639900, updated_at = now() WHERE plan_type = 'business'`);
  }
}
