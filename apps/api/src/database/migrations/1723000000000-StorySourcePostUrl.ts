import { MigrationInterface, QueryRunner } from 'typeorm';

export class StorySourcePostUrl1723000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE instagram_media_mappings
        ADD COLUMN IF NOT EXISTS source_post_url TEXT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE instagram_media_mappings
        DROP COLUMN IF EXISTS source_post_url
    `);
  }
}
