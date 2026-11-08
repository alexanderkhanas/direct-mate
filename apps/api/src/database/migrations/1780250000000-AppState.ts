import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Small app-wide state that belongs to no store: today, the pause on Meta's
 * message-read budget for the Instagram history import (the budget is the
 * app's, so one store's code 4 blocks every store's reads).
 */
export class AppState1780250000000 implements MigrationInterface {
  name = 'AppState1780250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE app_state (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app_state`);
  }
}
