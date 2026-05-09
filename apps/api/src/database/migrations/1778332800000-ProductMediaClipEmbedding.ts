import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `product_media.clip_embedding BYTEA` for semantic image-similarity
 * retrieval against customer-attached photos in DMs.
 *
 * Replaces the original "exact-match-only" pHash design (still used as a
 * fast Stage 1 deterministic shortcut). pHash misses when a customer
 * sends a screenshot of the same product from another source — brand
 * feed, reseller post, blog photo, webshop listing — because pixel-level
 * hashes are sensitive to crop/angle/lighting/Instagram chrome.
 *
 * CLIP image embeddings (Xenova/clip-vit-base-patch32, 512-dim float32)
 * capture semantic/visual similarity instead and bridge those framing
 * differences. The embedding is L2-normalized at write time so a
 * downstream cosine == dot product.
 *
 * Storage: 512 × 4 bytes = 2048 bytes per row, raw BYTEA. JS-side cosine
 * over hundreds of vectors is sub-millisecond, so no pgvector / HNSW
 * index is needed at this scale. The retrieval code is structured so
 * pgvector can replace the in-memory rank later without touching the
 * matchCustomerPhoto flow signature, once any tenant's catalog crosses
 * ~5k–10k images.
 *
 * No backfill in the migration itself — a follow-up
 * `npm run backfill:clip-embeddings -- --tenant=<id>` script populates
 * existing rows. New catalog syncs compute the embedding inline
 * alongside pHash.
 */
export class ProductMediaClipEmbedding1778332800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE product_media
        ADD COLUMN clip_embedding BYTEA NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_product_media_clip_embedding_not_null
        ON product_media (id)
        WHERE clip_embedding IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_media_clip_embedding_not_null`);
    await queryRunner.query(`
      ALTER TABLE product_media DROP COLUMN IF EXISTS clip_embedding
    `);
  }
}
