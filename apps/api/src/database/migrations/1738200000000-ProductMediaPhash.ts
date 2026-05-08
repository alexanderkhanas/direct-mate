import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `product_media.phash CHAR(16)` for fast image-similarity lookup
 * against customer-attached photos in DMs.
 *
 * Why a hex pHash and not pgvector / CLIP embeddings: the matching
 * goal is "exact same image" (customer screenshots a story / saves the
 * catalog photo), not semantic similarity. A 64-bit dHash + Hamming
 * distance is fast, deterministic, and avoids over-matching unrelated
 * dresses that happen to be visually similar. Embeddings would erode
 * the "high-confidence resolve, otherwise hand off" guardrail.
 *
 * Stored as 16 hex chars (= 64 bits). Lookup is done in-memory for
 * the tenant's media set (~hundreds of rows in practice); no SQL
 * Hamming-distance dance needed.
 *
 * No backfill in the migration itself — the catalog import path
 * always-replaces `product_media` rows on each sync, so a single
 * connector run after deploy populates hashes for all existing rows.
 */
export class ProductMediaPhash1738200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE product_media
        ADD COLUMN phash CHAR(16) NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_product_media_phash
        ON product_media (phash)
        WHERE phash IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_media_phash`);
    await queryRunner.query(`
      ALTER TABLE product_media DROP COLUMN IF EXISTS phash
    `);
  }
}
