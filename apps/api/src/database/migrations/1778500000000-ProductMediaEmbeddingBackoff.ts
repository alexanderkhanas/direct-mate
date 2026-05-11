import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `product_media.embedding_attempted_at TIMESTAMPTZ NULL` to back
 * the deferred CLIP-embedding background worker.
 *
 * `clipEmbedding IS NULL` is the queue of pending rows. Without a
 * "we tried this one" timestamp, a permanently-broken image URL
 * (dead CDN entry, 404, decode error) would loop forever — every
 * tick would re-pick it, try, fail, leave it null, repeat.
 *
 * The worker stamps `embedding_attempted_at = NOW()` after each try
 * regardless of outcome. The next-eligible filter is
 *
 *   clip_embedding IS NULL
 *   AND (embedding_attempted_at IS NULL
 *        OR embedding_attempted_at < NOW() - '15 min'::interval)
 *
 * giving 15-minute retry backoff per row. Permanently bad rows
 * accumulate but no longer dominate the queue.
 *
 * Partial index makes the scan cheap: only rows that are NULL
 * embeddings are even in the index, and the worker SELECT can hit it
 * directly. Most product_media rows have an embedding once the
 * backfill catches up, so the index stays tiny.
 */
export class ProductMediaEmbeddingBackoff1778500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE product_media
      ADD COLUMN embedding_attempted_at TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      CREATE INDEX product_media_embed_pending_idx
      ON product_media (embedding_attempted_at NULLS FIRST)
      WHERE clip_embedding IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS product_media_embed_pending_idx`,
    );
    await queryRunner.query(
      `ALTER TABLE product_media DROP COLUMN IF EXISTS embedding_attempted_at`,
    );
  }
}
