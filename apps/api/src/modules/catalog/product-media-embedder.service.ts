import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductMedia } from './entities/product-media.entity';
import { ImageEmbeddingService } from './image-embedding.service';

/**
 * Background worker that fills in missing `product_media.clip_embedding`
 * rows. Decoupled from the catalog-import hot path so a slow or
 * unstable CLIP can never block (or crash) the api process.
 *
 * Pending row predicate:
 *   clip_embedding IS NULL
 *   AND (embedding_attempted_at IS NULL
 *        OR embedding_attempted_at < NOW() - INTERVAL '15 minutes')
 *
 * Permanently broken image URLs (404, decode error) get stamped with
 * `embedding_attempted_at` after each attempt, so the 15-minute
 * backoff stops them from dominating the queue.
 *
 * The worker runs sequentially through one tick's batch — concurrent
 * inference on the shared onnxruntime session is what SIGSEGV'd us
 * in the inline catalog-import flow. `ImageEmbeddingService` already
 * serializes calls internally, but processing rows in a sequential
 * `for` loop here keeps the worker's footprint predictable and makes
 * shutdown cleaner.
 *
 * Config:
 *   CLIP_BACKFILL_TICK_MS   — interval between ticks (default 60000)
 *   CLIP_BACKFILL_BATCH     — max rows processed per tick (default 10)
 *   CLIP_BACKFILL_BACKOFF_MIN — minutes before retrying a failed row
 *                               (default 15)
 *   CLIP_ENABLED            — global kill-switch; when false the
 *                             worker still runs but skips ticks
 */
@Injectable()
export class ProductMediaEmbedderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductMediaEmbedderService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickMs: number;
  private batchSize: number;
  private backoffMinutes: number;

  constructor(
    @InjectRepository(ProductMedia)
    private readonly mediaRepo: Repository<ProductMedia>,
    private readonly embeddings: ImageEmbeddingService,
    private readonly config: ConfigService,
  ) {
    this.tickMs = parseInt(
      this.config.get<string>('CLIP_BACKFILL_TICK_MS') ?? '60000',
      10,
    );
    this.batchSize = parseInt(
      this.config.get<string>('CLIP_BACKFILL_BATCH') ?? '10',
      10,
    );
    this.backoffMinutes = parseInt(
      this.config.get<string>('CLIP_BACKFILL_BACKOFF_MIN') ?? '15',
      10,
    );
  }

  onModuleInit(): void {
    this.logger.log(
      `ProductMediaEmbedder starting (tick=${this.tickMs}ms, batch=${this.batchSize}, backoff=${this.backoffMinutes}m)`,
    );
    // First tick fires after the interval, not immediately — gives the
    // app time to settle on boot.
    this.timer = setInterval(() => this.runTick(), this.tickMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runTick(): Promise<void> {
    if (this.running) {
      // Previous tick still in flight — skip silently rather than
      // queueing up. setInterval doesn't await our callback so this
      // guard is necessary.
      return;
    }
    this.running = true;
    try {
      const pending = await this.fetchPending();
      if (pending.length === 0) return;
      let embedded = 0;
      let failed = 0;
      for (const row of pending) {
        const ok = await this.embedRow(row);
        if (ok) embedded++;
        else failed++;
      }
      this.logger.log(
        `embedder tick: embedded=${embedded} failed=${failed} batch=${pending.length}`,
      );
    } catch (err) {
      // Defensive — repo errors shouldn't crash the worker loop.
      this.logger.error(`embedder tick failed: ${err}`);
    } finally {
      this.running = false;
    }
  }

  private async fetchPending(): Promise<ProductMedia[]> {
    // Raw SQL — the partial index `product_media_embed_pending_idx`
    // covers exactly this predicate and ordering, so the planner can
    // do a cheap index scan + LIMIT.
    return this.mediaRepo
      .createQueryBuilder('m')
      .where('m.clipEmbedding IS NULL')
      .andWhere(
        `(m.embeddingAttemptedAt IS NULL OR m.embeddingAttemptedAt < NOW() - INTERVAL '${this.backoffMinutes} minutes')`,
      )
      .orderBy('m.embeddingAttemptedAt', 'ASC', 'NULLS FIRST')
      .addOrderBy('m.createdAt', 'ASC')
      .limit(this.batchSize)
      .getMany();
  }

  private async embedRow(row: ProductMedia): Promise<boolean> {
    const stamp = new Date();
    try {
      const vec = await this.embeddings.embedFromUrl(row.url);
      if (!vec) {
        // Either CLIP disabled, download failed, or decode failed —
        // stamp the attempt so we don't immediately retry.
        await this.mediaRepo.update(
          { id: row.id },
          { embeddingAttemptedAt: stamp },
        );
        return false;
      }
      const buf = this.embeddings.serializeEmbedding(vec);
      await this.mediaRepo.update(
        { id: row.id },
        { clipEmbedding: buf, embeddingAttemptedAt: stamp },
      );
      return true;
    } catch (err) {
      // JS-level error path. A native segfault inside ORT would have
      // killed the process before we got here; if WASM EP gives us a
      // raisable error instead, this catches it.
      this.logger.warn(`embedRow(${row.id}, url=${row.url}) failed: ${err}`);
      try {
        await this.mediaRepo.update(
          { id: row.id },
          { embeddingAttemptedAt: stamp },
        );
      } catch (innerErr) {
        this.logger.error(`failed to stamp attempted_at: ${innerErr}`);
      }
      return false;
    }
  }
}
