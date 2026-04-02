import { MigrationInterface, QueryRunner } from 'typeorm';

export class LearningMode1721000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE store_configs
        ADD COLUMN operating_mode VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN learning_started_at TIMESTAMPTZ NULL,
        ADD COLUMN learning_notified_at TIMESTAMPTZ NULL;

      CREATE INDEX idx_store_configs_operating_mode ON store_configs(operating_mode);

      ALTER TABLE extracted_conversation_fragments
        ADD COLUMN source VARCHAR(30) NOT NULL DEFAULT 'screenshot',
        ALTER COLUMN file_id DROP NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE store_configs
        DROP COLUMN operating_mode,
        DROP COLUMN learning_started_at,
        DROP COLUMN learning_notified_at;

      DROP INDEX IF EXISTS idx_store_configs_operating_mode;

      ALTER TABLE extracted_conversation_fragments
        DROP COLUMN source,
        ALTER COLUMN file_id SET NOT NULL;
    `);
  }
}
