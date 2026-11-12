import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Instagram content the AI agent can look at: our own copy of a post's or
 * story's image (or, for a video, a contact sheet of its frames), so it
 * outlives Meta's expiring CDN links and is made once per piece of content.
 * Plus what Meta says the item is: its cover for videos and its product type
 * (FEED / REELS / STORY), which `media_type` alone can't tell apart.
 */
export class InstagramContentImages1780300000000 implements MigrationInterface {
  name = 'InstagramContentImages1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE instagram_media_mappings
        ADD COLUMN image_path text,
        ADD COLUMN thumbnail_url text,
        ADD COLUMN media_product_type text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE instagram_media_mappings
        DROP COLUMN IF EXISTS image_path,
        DROP COLUMN IF EXISTS thumbnail_url,
        DROP COLUMN IF EXISTS media_product_type
    `);
  }
}
