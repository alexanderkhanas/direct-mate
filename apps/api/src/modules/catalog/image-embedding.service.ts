import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * CLIP image-embedding wrapper around `@xenova/transformers`.
 *
 * Used by Stage 2 of customer-photo product matching:
 * `instagram-content.service.ts:matchCustomerPhoto` retrieves
 * candidate products for a customer's screenshot by computing the CLIP
 * embedding of the screenshot and ranking `product_media.clip_embedding`
 * rows by cosine similarity. This bridges the framing/angle/lighting
 * gap that pHash can't (pHash stays as a Stage 1 deterministic exact-
 * match shortcut).
 *
 * Critical product guardrail: CLIP is for retrieval ONLY. It does not
 * decide product identity. Final accept/reject still goes through GPT
 * vision verification + confidence thresholds. Never auto-accept a
 * product based on CLIP cosine alone.
 *
 * Implementation notes:
 *   - `@xenova/transformers` is ESM-only; our tsconfig is CJS. We use
 *     a `new Function('return import(...)')` thunk so TypeScript does
 *     not rewrite the dynamic `import()` to `require()` (which would
 *     fail at runtime).
 *   - Model: `Xenova/clip-vit-base-patch32` (~150MB ONNX, 512-dim
 *     float32 output, well-calibrated cosine similarity).
 *   - Vectors are L2-normalized at write time so a downstream cosine
 *     reduces to a dot product.
 *   - All failure paths return null + warn. We never throw in the
 *     request path; the caller falls back to pHash-only behavior or
 *     handoff.
 */

const CLIP_DIM = 512;

// Bypass TS's commonjs rewrite of dynamic import. Function constructor
// emits a true `import()` call at runtime, which Node resolves to the
// ESM loader regardless of our calling context.
const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as <T = unknown>(specifier: string) => Promise<T>;

type Pipeline = (
  images: unknown,
) => Promise<{ data: Float32Array | number[] }>;

interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
  ) => Promise<Pipeline>;
  RawImage: {
    fromURL: (url: string) => Promise<unknown>;
  };
}

@Injectable()
export class ImageEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(ImageEmbeddingService.name);
  private extractor: Pipeline | null = null;
  private transformers: TransformersModule | null = null;

  async onModuleInit(): Promise<void> {
    try {
      this.transformers = await dynamicImport<TransformersModule>(
        '@xenova/transformers',
      );
      this.extractor = await this.transformers.pipeline(
        'image-feature-extraction',
        'Xenova/clip-vit-base-patch32',
      );
      this.logger.log('CLIP image embedding model loaded');
    } catch (err) {
      this.logger.error(
        `Failed to load CLIP model — embeddings will be skipped: ${err}`,
      );
    }
  }

  /**
   * Compute a 512-dim L2-normalized CLIP embedding for an image URL.
   * Returns null on any failure (model not loaded, network error,
   * decode error, dimension mismatch, zero-norm vector). Caller must
   * handle null gracefully — never throw in request path.
   */
  async embedFromUrl(url: string): Promise<Float32Array | null> {
    if (!this.extractor || !this.transformers) {
      this.logger.warn('embedFromUrl called before model loaded — returning null');
      return null;
    }

    try {
      const image = await this.transformers.RawImage.fromURL(url);
      const out = await this.extractor(image);
      const raw = out.data;
      const v = raw instanceof Float32Array ? new Float32Array(raw) : Float32Array.from(raw);

      if (v.length !== CLIP_DIM) {
        this.logger.warn(
          `Unexpected CLIP embedding dimension: ${v.length} (expected ${CLIP_DIM})`,
        );
        return null;
      }

      // L2-normalize so cosine similarity == dot product.
      let norm = 0;
      for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm);
      if (!Number.isFinite(norm) || norm <= 0) {
        this.logger.warn(`embedFromUrl(${url}): zero or non-finite norm`);
        return null;
      }
      for (let i = 0; i < v.length; i++) v[i] /= norm;

      return v;
    } catch (err) {
      this.logger.warn(`embedFromUrl(${url}) failed: ${err}`);
      return null;
    }
  }

  /**
   * Cosine similarity between two L2-normalized vectors. Both inputs
   * must have come from `embedFromUrl` (or `deserializeEmbedding` of
   * a value that was stored after normalization). Returns -1 on
   * dimension mismatch.
   */
  cosine(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return -1;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }

  /** Pack a 512-dim float32 vector to a 2048-byte Buffer for BYTEA storage. */
  serializeEmbedding(v: Float32Array): Buffer {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }

  /**
   * Read back a 2048-byte BYTEA into a Float32Array view. Returns null
   * on size mismatch (corrupt row, wrong column, dimension drift after
   * a model swap).
   */
  deserializeEmbedding(buffer: Buffer | null): Float32Array | null {
    if (!buffer || buffer.byteLength !== CLIP_DIM * 4) return null;
    // Buffer's underlying ArrayBuffer can be larger than the slice we own
    // (Node pools small Buffers). Use byteOffset/byteLength to scope the view.
    return new Float32Array(buffer.buffer, buffer.byteOffset, CLIP_DIM);
  }
}
