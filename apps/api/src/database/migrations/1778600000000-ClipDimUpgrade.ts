import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bumps the CLIP embedding model from `Xenova/clip-vit-base-patch32`
 * (512-dim, 2048-byte BYTEA) to the Replicate-hosted `krthr/clip-embeddings`
 * (CLIP ViT-L/14, 768-dim, 3072-byte BYTEA).
 *
 * Why: the previous in-process model crashed `onnxruntime-node@1.14.0`
 * on Debian glibc (`free(): invalid size` → SIGSEGV). Phase A confirmed
 * the binary itself is the failure point; switching to a remote API
 * takes ORT out of the request path. The model that's actually
 * available + maintained on Replicate is L/14, not B/32 — so the
 * vector space changes too.
 *
 * Stored vectors in 512-dim space are no longer comparable to fresh
 * 768-dim vectors. NULLing them out is correct: the background
 * `ProductMediaEmbedder` worker will re-compute every NULL row on its
 * next tick, this time hitting Replicate and storing 3072-byte rows.
 *
 * The `embedding_attempted_at` column is also cleared so the
 * 15-minute backoff doesn't strand previously-stamped rows.
 *
 * Down: irreversible without re-running the old in-process pipeline.
 * We don't keep an escape hatch for that — the prod binary is broken.
 * Leaves the column nullable; nothing breaks if down() is run, but
 * the rows would need a 512-dim model to be reusable.
 */
export class ClipDimUpgrade1778600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Guard with `octet_length` so this is idempotent — re-running the
    // migration on rows already in the new shape is a no-op.
    await queryRunner.query(`
      UPDATE product_media
      SET clip_embedding = NULL,
          embedding_attempted_at = NULL
      WHERE clip_embedding IS NOT NULL
        AND octet_length(clip_embedding) <> 3072
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op. The forward migration is destructive (drops 512-dim
    // vectors) and the old in-process model is unrecoverable on
    // this Linux build, so there is nothing meaningful to undo.
  }
}
