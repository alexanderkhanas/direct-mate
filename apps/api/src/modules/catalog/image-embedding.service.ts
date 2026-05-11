import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * CLIP image-embedding service backed by the Replicate API.
 *
 * Previously this called `@xenova/transformers` in-process, which
 * loaded `onnxruntime-node`'s native binary. The v1.14 prebuilt
 * heap-corrupts on first inference under Debian 12 / glibc 2.36
 * (`free(): invalid size` → SIGSEGV), both under CPU and WASM
 * execution providers. Phase A pinned WASM correctly and proved
 * the binary itself is the failure point. Switching to a remote
 * API takes the broken binary out of the request path entirely.
 *
 * Model: `krthr/clip-embeddings` on Replicate — CLIP ViT-L/14,
 * 768-dim output. The previous in-process model was ViT-B/32
 * (512-dim), so existing 2048-byte BYTEAs in
 * `product_media.clip_embedding` no longer match the new space
 * and are NULL'd by migration `1778600000000-ClipDimUpgrade` so the
 * background worker re-embeds them under the new dim. The
 * Instagram photo-matching retrieval still uses cosine on the same
 * `clip_embedding` column — it just compares 768-dim vectors
 * against each other once the backfill catches up.
 *
 * Public contract preserved: `embedFromUrl` still returns a
 * `Float32Array | null`, now of length 768 (L2-normalized at the
 * source). `serializeEmbedding` / `deserializeEmbedding` / `cosine`
 * are pure Buffer/Float32 math and still work, just on 3072-byte
 * BYTEAs now (768 × 4).
 */

// 768 for ViT-L/14. The corresponding BYTEA storage is 768*4 = 3072
// bytes per row. Bumping this is a breaking change for stored vectors;
// pair it with a migration that NULLs the now-wrong-shape rows so the
// worker recomputes them.
const CLIP_DIM = 768;
const REPLICATE_API_URL = 'https://api.replicate.com/v1/predictions';
// Pinned model version for reproducibility. Do not switch to a caret
// range — a new variant could shift output space and silently
// invalidate every stored vector. Bump deliberately, with a compat
// smoke (cosine ≥ 0.999 against a known stored row) before deploying.
const DEFAULT_MODEL_VERSION =
  '1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4';

// `Prefer: wait` tells Replicate to hold the connection up to 60s
// and return the completed prediction inline. Most predictions finish
// in 2-3s, so this avoids a separate polling round-trip. Polling is
// still implemented as a fallback for the long-tail.
const SYNC_WAIT_HEADER = 'wait';
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 60;

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: { embedding?: number[] } | null;
  error?: string | null;
}

@Injectable()
export class ImageEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(ImageEmbeddingService.name);
  private apiToken: string | null = null;
  private modelVersion: string | null = null;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const flag = this.config.get<string>('CLIP_ENABLED');
    this.enabled =
      flag !== undefined && (flag.toLowerCase() === 'true' || flag === '1');

    if (!this.enabled) {
      this.logger.warn('CLIP disabled by CLIP_ENABLED env flag');
      return;
    }

    const token = this.config.get<string>('REPLICATE_API_TOKEN');
    if (!token) {
      this.logger.error(
        'CLIP_ENABLED=true but REPLICATE_API_TOKEN missing — disabling',
      );
      this.enabled = false;
      return;
    }
    this.apiToken = token;

    this.modelVersion =
      this.config.get<string>('REPLICATE_CLIP_MODEL_VERSION') ??
      DEFAULT_MODEL_VERSION;

    this.logger.log(
      `CLIP image embedding enabled via Replicate (model ${this.modelVersion.slice(0, 8)}...)`,
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get a 512-dim CLIP image embedding for an image URL. Returns
   * null when CLIP is disabled, the API call fails, the prediction
   * fails, or the output shape is unexpected. Caller must handle
   * null gracefully — this is the same contract the in-process
   * implementation honored.
   */
  async embedFromUrl(imageUrl: string): Promise<Float32Array | null> {
    if (!this.enabled || !this.apiToken || !this.modelVersion) {
      return null;
    }

    const startedAt = Date.now();
    try {
      const embedding = await this.callReplicate(imageUrl);
      this.logger.debug(
        `embed ok url=${this.truncateUrl(imageUrl)} ` +
          `dur=${Date.now() - startedAt}ms dim=${embedding.length}`,
      );
      return embedding;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `embed FAIL url=${this.truncateUrl(imageUrl)} ` +
          `dur=${Date.now() - startedAt}ms: ${msg}`,
      );
      return null;
    }
  }

  private async callReplicate(imageUrl: string): Promise<Float32Array> {
    const createResponse = await fetch(REPLICATE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiToken!}`,
        'Content-Type': 'application/json',
        Prefer: SYNC_WAIT_HEADER,
      },
      body: JSON.stringify({
        version: this.modelVersion,
        input: { image: imageUrl },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => '<unreadable>');
      throw new Error(
        `Replicate API ${createResponse.status}: ${errorText.slice(0, 200)}`,
      );
    }

    let prediction = (await createResponse.json()) as ReplicatePrediction;

    // `Prefer: wait` usually returns a terminal status inline. If not,
    // fall through to polling.
    if (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      prediction = await this.pollPrediction(prediction.id);
    }

    if (prediction.status === 'failed') {
      throw new Error(
        `Replicate prediction failed: ${prediction.error ?? 'unknown'}`,
      );
    }
    if (prediction.status !== 'succeeded') {
      throw new Error(
        `Replicate prediction did not succeed: status=${prediction.status}`,
      );
    }

    const embedding = prediction.output?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error(
        `Replicate response missing embedding: ${JSON.stringify(prediction.output).slice(0, 200)}`,
      );
    }
    if (embedding.length !== CLIP_DIM) {
      throw new Error(
        `Unexpected embedding dim: got ${embedding.length}, expected ${CLIP_DIM}`,
      );
    }

    // L2-normalize. Replicate's `krthr/clip-embeddings` returns raw
    // CLIP image features (typical ||v|| ≈ 10-20, not 1.0). The
    // previous in-process service normalized at write time so that
    // downstream `cosine()` reduces to a dot product. Preserve that
    // invariant so callers don't need to know which backend produced
    // the vector.
    const v = Float32Array.from(embedding);
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm <= 0) {
      throw new Error(
        `Embedding has zero or non-finite norm (got ${norm})`,
      );
    }
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }

  private async pollPrediction(
    predictionId: string,
  ): Promise<ReplicatePrediction> {
    const url = `${REPLICATE_API_URL}/${predictionId}`;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const response = await fetch(url, {
        headers: { Authorization: `Token ${this.apiToken!}` },
      });
      if (!response.ok) {
        throw new Error(`Polling failed: HTTP ${response.status}`);
      }
      const prediction = (await response.json()) as ReplicatePrediction;
      if (prediction.status === 'succeeded' || prediction.status === 'failed') {
        return prediction;
      }
    }
    throw new Error(
      `Replicate prediction polling timeout after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS}ms`,
    );
  }

  private truncateUrl(url: string): string {
    if (url.length <= 60) return url;
    return `${url.slice(0, 50)}...${url.slice(-7)}`;
  }

  /**
   * Cosine similarity between two L2-normalized vectors. Both inputs
   * must already be normalized (Replicate's clip-embeddings model
   * returns L2-normalized output, and any stored vectors from the
   * prior in-process service were normalized at write time). Returns
   * -1 on dimension mismatch.
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
    return new Float32Array(buffer.buffer, buffer.byteOffset, CLIP_DIM);
  }
}
