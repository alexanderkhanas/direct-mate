import { MigrationInterface, QueryRunner } from 'typeorm';

export class DemoTenantFlag1733000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX idx_tenants_is_demo ON tenants (is_demo) WHERE is_demo = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_tenants_is_demo;
      ALTER TABLE tenants DROP COLUMN IF EXISTS is_demo;
    `);
  }
}
