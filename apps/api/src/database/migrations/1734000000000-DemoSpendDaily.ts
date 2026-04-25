import { MigrationInterface, QueryRunner } from 'typeorm';

export class DemoSpendDaily1734000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE demo_spend_daily (
        day DATE NOT NULL,
        model TEXT NOT NULL,
        usd_cents INTEGER NOT NULL DEFAULT 0,
        calls INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, model)
      );
      CREATE INDEX idx_demo_spend_daily_day ON demo_spend_daily (day);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_demo_spend_daily_day;
      DROP TABLE IF EXISTS demo_spend_daily;
    `);
  }
}
