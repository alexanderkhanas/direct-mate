import { MigrationInterface, QueryRunner } from 'typeorm';

export class FragmentBotAnalysis1722000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE extracted_conversation_fragments
        ADD COLUMN IF NOT EXISTS classification_json jsonb,
        ADD COLUMN IF NOT EXISTS bot_reply text,
        ADD COLUMN IF NOT EXISTS template_scenario varchar(100)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE extracted_conversation_fragments
        DROP COLUMN IF EXISTS classification_json,
        DROP COLUMN IF EXISTS bot_reply,
        DROP COLUMN IF EXISTS template_scenario
    `);
  }
}
