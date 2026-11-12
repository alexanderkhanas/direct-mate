import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When the visual check last compared a story, post or reel with the catalog:
 * it runs once per piece of content (a model call), claimed by setting this.
 */
export class ContentVisionChecked1780500000000 implements MigrationInterface {
  name = 'ContentVisionChecked1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE instagram_media_mappings ADD COLUMN vision_checked_at timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE instagram_media_mappings DROP COLUMN IF EXISTS vision_checked_at`);
  }
}
