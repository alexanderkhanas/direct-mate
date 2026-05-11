import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  env: {
    backends: {
      onnx: {
        executionProviders: string[];
        wasm?: { numThreads?: number; simd?: boolean };
      };
    };
  };
}

@Injectable()
export class ImageEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(ImageEmbeddingService.name);
  private extractor: Pipeline | null = null;
  private transformers: TransformersModule | null = null;
  private enabled = true;
  /** Serializes concurrent embed calls onto a single ORT session.
   *  Parallel inference on one onnxruntime-node session segfaults
   *  (SIGSEGV exit 139) — observed under catalog-import where each
   *  product's images embed in parallel. Chaining promises through a
   *  shared lock keeps the session single-threaded. */
  private embedQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    // Production safety: env flag to disable CLIP entirely. Set
    // CLIP_ENABLED=false when onnxruntime is unstable on the host.
    // `embedFromUrl` then returns null and downstream code writes
    // null clipEmbedding rows — pHash + GPT vision still work for
    // customer-photo matching.
    const flag = this.config.get<string>('CLIP_ENABLED');
    if (flag !== undefined && flag.toLowerCase() !== 'true' && flag !== '1') {
      this.enabled = false;
      this.logger.warn('CLIP disabled by CLIP_ENABLED env flag');
      return;
    }
    try {
      this.transformers = await dynamicImport<TransformersModule>(
        '@xenova/transformers',
      );
      // Force the WASM execution provider — the default CPU EP in
      // onnxruntime-node segfaults under concurrent inference
      // (observed in prod: SIGSEGV exit 139 + `free(): invalid size`
      // glibc heap corruption). WASM runs the model inside a sandbox,
      // ~2-3× slower per inference but immune to native crashes.
      // Order in the array IS the priority — ['wasm'] means CPU is
      // never attempted.
      this.transformers.env.backends.onnx.executionProviders = ['wasm'];
      // Single-threaded WASM keeps things deterministic + low-memory.
      // CLIP-ViT-base inference doesn't benefit much from extra
      // threads at this batch size (single image at a time via the
      // serialized embed queue).
      if (this.transformers.env.backends.onnx.wasm) {
        this.transformers.env.backends.onnx.wasm.numThreads = 1;
      }
      this.extractor = await this.transformers.pipeline(
        'image-feature-extraction',
        'Xenova/clip-vit-base-patch32',
      );
      this.logger.log('CLIP image embedding model loaded (WASM EP)');
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
    if (!this.enabled || !this.extractor || !this.transformers) {
      return null;
    }

    // Chain onto the shared queue — only one CLIP inference at a time.
    // Multiple concurrent callers serialize behind this lock; failures
    // on one URL don't break the chain (each step has its own try/catch).
    const next = this.embedQueue.then(() => this.embedOne(url));
    // Swallow rejection in the queue tracker so future calls aren't
    // poisoned by a single failure; the caller still receives the
    // (resolved-to-null or thrown) result from `next`.
    this.embedQueue = next.catch(() => null);
    return next;
  }

  private async embedOne(url: string): Promise<Float32Array | null> {
    if (!this.extractor || !this.transformers) return null;
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
