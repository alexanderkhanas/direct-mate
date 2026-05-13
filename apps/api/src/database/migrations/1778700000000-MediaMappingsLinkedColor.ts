import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `instagram_media_mappings.linked_color text` so a story/post can
 * be linked to a specific color of a product (e.g. "red dress, all
 * sizes"), not just to the parent product or a specific SKU row.
 *
 * NULL = product-level link (current behavior). When set, the reply
 * engine fans out to all variants of that color and surfaces the
 * `confirm_color_variant_in_stock` template.
 *
 * No backfill: existing rows stay NULL. If we ever want analytics on
 * historical color-linked content, a one-shot script can populate
 * `linked_color = variant.color` for rows with a non-null variant_id.
 */
export class MediaMappingsLinkedColor1778700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE instagram_media_mappings
        ADD COLUMN linked_color TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE instagram_media_mappings DROP COLUMN IF EXISTS linked_color
    `);
  }
}
