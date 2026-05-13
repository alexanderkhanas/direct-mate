import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductMedia } from './entities/product-media.entity';
import { ImageEmbeddingService } from './image-embedding.service';

// Bytes → rounded MB for log readability. Used in instrumentation so a
// crash log shows which embedding (#5 vs #500) and what RSS trajectory
// preceded it.
const toMB = (bytes: number): number => Math.round(bytes / 1024 / 1024);

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
    const tickStartedAt = Date.now();
    const startRss = process.memoryUsage().rss;
    let processed = 0;
    let embedded = 0;
    let failed = 0;
    let pending: ProductMedia[] = [];
    try {
      pending = await this.fetchPending();
      if (pending.length === 0) return;
      this.logger.log(
        `tick start: ${pending.length} rows, rss=${toMB(startRss)}MB`,
      );
      for (const row of pending) {
        const beforeRss = process.memoryUsage().rss;
        const beforeMs = Date.now();
        try {
          const ok = await this.embedRow(row);
          const afterRss = process.memoryUsage().rss;
          processed++;
          if (ok) embedded++;
          else failed++;
          this.logger.log(
            `embed #${processed}/${pending.length} ${ok ? 'ok' : 'skip'} ` +
              `row=${row.id} ` +
              `dur=${Date.now() - beforeMs}ms ` +
              `rss=${toMB(afterRss)}MB ` +
              `delta=${toMB(afterRss - beforeRss)}MB`,
          );
        } catch (err) {
          // embedRow has its own try/catch and never rejects in
          // practice; this is a belt-and-braces last line so a
          // synchronous throw still surfaces the failing row #.
          this.logger.error(
            `embed FAIL #${processed + 1}/${pending.length} row=${row.id}: ${err}`,
          );
          throw err;
        }
      }
    } catch (err) {
      // Defensive — repo errors shouldn't crash the worker loop.
      this.logger.error(`embedder tick failed: ${err}`);
    } finally {
      const endRss = process.memoryUsage().rss;
      this.logger.log(
        `tick end: processed=${processed}/${pending.length} ` +
          `embedded=${embedded} failed=${failed} ` +
          `dur=${Date.now() - tickStartedAt}ms ` +
          `rss=${toMB(endRss)}MB rss_delta=${toMB(endRss - startRss)}MB`,
      );
      if (global.gc) {
        const beforeGcRss = process.memoryUsage().rss;
        global.gc();
        const afterGcRss = process.memoryUsage().rss;
        this.logger.log(
          `gc: freed=${toMB(beforeGcRss - afterGcRss)}MB rss=${toMB(afterGcRss)}MB`,
        );
      }
      this.running = false;
    }
  }

  private async fetchPending(): Promise<ProductMedia[]> {
    // Raw SQL — the partial index `product_media_embed_pending_idx`
    // covers most of this predicate so the planner can do a cheap
    // index scan + LIMIT.
    //
    // `url LIKE 'http%'` filters out demo-seed rows that store
    // relative paths like `/uploads/cosmetics/foo.jpg`. Those work
    // for the in-app demo widget (the api serves them through
    // `useStaticAssets`) but Replicate is external and refuses
    // them with HTTP 422 ("Does not match format 'uri'"). Without
    // this filter the worker burns ~3,500 Replicate calls/day
    // retrying ~36 rows on the 15-min backoff, none of which can
    // ever succeed. Skipping at the SQL layer means those rows
    // stay `clip_embedding IS NULL` permanently — fine, since the
    // demo widget doesn't use Stage 2 CLIP retrieval.
    return this.mediaRepo
      .createQueryBuilder('m')
      .where('m.clipEmbedding IS NULL')
      .andWhere(`m.url LIKE 'http%'`)
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
