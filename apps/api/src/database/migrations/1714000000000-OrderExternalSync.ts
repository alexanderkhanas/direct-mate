import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderExternalSync1714000000000 implements MigrationInterface {
  name = 'OrderExternalSync1714000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN "external_sync_status" text NOT NULL DEFAULT 'none'
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN "external_order_metadata" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN "external_sync_triggered_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "orders" ADD COLUMN "external_sync_completed_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "external_sync_completed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "external_sync_triggered_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "external_order_metadata"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "external_sync_status"`);
  }
}
