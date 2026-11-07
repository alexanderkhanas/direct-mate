import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { ConnectionStatus, ConnectionType, SyncType } from '@direct-mate/shared';
import { Connection } from '../integrations/entities/connection.entity';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogService } from '../catalog/catalog.service';
import { ProductAttributesService } from '../catalog/attributes/product-attributes.service';
import { CatalogIndexService } from '../agent/catalog/catalog-index.service';
import { FeedError, fetchFeed, type FetchedFeed } from './feed-fetcher';
import { FEED_ID_PREFIX, type FeedFormat, type FeedWarning, type ParsedFeed } from './feed-normalize';
import { parseFeed } from './parse-feed';

/** What the connection keeps between syncs (`connections.metadata`). */
interface FeedMeta {
  url: string;
  format?: FeedFormat;
  etag?: string | null;
  lastModified?: string | null;
  /** Hash of the parsed products: many generated feeds send a new ETag on every request. */
  payloadHash?: string;
  lastItemCount?: number;
  warnings?: FeedWarning[];
  lastError?: { code: string; message: string } | null;
}

export interface FeedPreview {
  format: FeedFormat;
  products: number;
  variants: number;
  /** Products with at least one variant in stock. */
  inStock: number;
  sample: Array<{
    title: string;
    category: string | null;
    price: number;
    currency: string;
    colors: string[];
    sizes: string[];
    image: string | null;
    inStock: boolean;
  }>;
  warnings: FeedWarning[];
}

export interface FeedStatus {
  feed: {
    id: string;
    url: string;
    format: FeedFormat | null;
    status: ConnectionStatus;
    lastSyncAt: Date | null;
    products: number | null;
    warnings: FeedWarning[];
    lastError: { code: string; message: string } | null;
  } | null;
  jobs: Array<{ status: string; startedAt: Date | null; finishedAt: Date | null; summary: unknown; error: string | null }>;
}

/** Below this share of the last sync's products, a feed is treated as broken: nothing is archived. */
const PARTIAL_FEED_RATIO = 0.5;
/** A trial store gets Starter's product limit; there is no plan config for `trial`. */
const TRIAL_PLAN = 'starter';
const DEFAULT_PRODUCT_LIMIT = 500;

/**
 * A store's product feed: preview a link, connect it, and keep the catalog in
 * step with it — on connect, hourly, and on demand. Products are written
 * through `CatalogService.importCatalog` with ids prefixed `feed:`, so a feed
 * never archives products another connector brought in.
 */
@Injectable()
export class FeedSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeedSyncService.name);
  /** Feeds syncing in this process. Production is a single replica. */
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(Connection) private readonly connections: Repository<Connection>,
    private readonly integrations: IntegrationsService,
    private readonly catalog: CatalogService,
    private readonly catalogIndex: CatalogIndexService,
    private readonly attributes: ProductAttributesService,
    private readonly dataSource: DataSource,
  ) {}

  /** A sync interrupted by a restart would otherwise look like it is still running. */
  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource
      .query(
        `UPDATE sync_jobs SET status = 'failed', finished_at = now(), error_message = 'Interrupted by a restart'
          WHERE status = 'running'
            AND connection_id IN (SELECT id FROM connections WHERE type = $1)`,
        [ConnectionType.ProductFeed],
      )
      .catch((err) => this.logger.warn(`Could not close interrupted feed syncs: ${(err as Error).message}`));
  }

  async preview(tenantId: string, url: string): Promise<FeedPreview> {
    const fetched = await fetchFeed(url);
    const parsed = parseFeed(fetched.format!, fetched.body, { maxProducts: await this.productLimit(tenantId) });
    if (parsed.products.length === 0) throw new FeedError('unknown_format', 'No products found in the feed');
    return summarize(parsed);
  }

  /** Connect (or re-point) the store's feed and run the first sync. */
  async connect(tenantId: string, url: string): Promise<FeedStatus> {
    const fetched = await fetchFeed(url);
    const preview = parseFeed(fetched.format!, fetched.body, { maxProducts: null });
    if (preview.products.length === 0) throw new FeedError('unknown_format', 'No products found in the feed');

    let connection = await this.connections.findOne({ where: { tenantId, type: ConnectionType.ProductFeed } });
    const metadata: FeedMeta = { url: url.trim(), format: fetched.format! };
    if (connection) {
      // A new link starts fresh: its first sync is a full one.
      const previous = (connection.metadata ?? {}) as unknown as FeedMeta;
      connection.metadata = { ...metadata, lastItemCount: previous.url === metadata.url ? previous.lastItemCount : undefined } as never;
      connection.status = ConnectionStatus.Connected;
    } else {
      connection = this.connections.create({
        tenantId,
        type: ConnectionType.ProductFeed,
        status: ConnectionStatus.Connected,
        metadata: metadata as never,
      });
    }
    connection = await this.connections.save(connection);
    await this.sync(connection.id, { prefetched: fetched });
    return this.status(tenantId);
  }

  async disconnect(tenantId: string, connectionId: string): Promise<void> {
    // Products stay: the owner may be switching sources, and archiving a
    // whole catalog by accident is worse than keeping it until the next import.
    await this.connections.delete({ id: connectionId, tenantId, type: ConnectionType.ProductFeed });
  }

  async status(tenantId: string): Promise<FeedStatus> {
    const connection = await this.connections.findOne({ where: { tenantId, type: ConnectionType.ProductFeed } });
    if (!connection) return { feed: null, jobs: [] };
    const meta = (connection.metadata ?? {}) as unknown as FeedMeta;
    const jobs: Array<{ status: string; started_at: Date | null; finished_at: Date | null; summary: unknown; error_message: string | null }> =
      await this.dataSource.query(
        `SELECT status, started_at, finished_at, summary, error_message FROM sync_jobs
          WHERE connection_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [connection.id],
      );
    return {
      feed: {
        id: connection.id,
        url: meta.url,
        format: meta.format ?? null,
        status: connection.status,
        lastSyncAt: connection.lastSyncAt,
        products: meta.lastItemCount ?? null,
        warnings: meta.warnings ?? [],
        lastError: meta.lastError ?? null,
      },
      jobs: jobs.map((j) => ({
        status: j.status,
        startedAt: j.started_at,
        finishedAt: j.finished_at,
        summary: j.summary,
        error: j.error_message,
      })),
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async syncAll(): Promise<void> {
    const feeds = await this.connections.find({ where: { type: ConnectionType.ProductFeed } });
    for (const feed of feeds) {
      if (feed.status === ConnectionStatus.Disconnected) continue;
      await this.sync(feed.id).catch((err) => this.logger.error(`Feed ${feed.id} sync failed: ${(err as Error).message}`));
    }
  }

  /**
   * Fetch, parse and import one feed. Unchanged feeds (304, or the same
   * products as last time) write nothing.
   */
  async sync(
    connectionId: string,
    opts: { force?: boolean; prefetched?: FetchedFeed } = {},
  ): Promise<{ status: 'imported' | 'unchanged' | 'already_running' | 'failed' }> {
    if (this.running.has(connectionId)) return { status: 'already_running' };
    const connection = await this.connections.findOne({ where: { id: connectionId } });
    if (!connection) return { status: 'failed' };
    const [busy] = await this.dataSource.query(
      `SELECT 1 FROM sync_jobs WHERE connection_id = $1 AND status = 'running' AND started_at > now() - interval '1 hour' LIMIT 1`,
      [connectionId],
    );
    if (busy) return { status: 'already_running' };

    this.running.add(connectionId);
    const meta = (connection.metadata ?? {}) as unknown as FeedMeta;
    const job = await this.integrations.queueSyncJob(connection.tenantId, connectionId, SyncType.Catalog, 'full');
    await this.integrations.markJobRunning(job.id);
    try {
      const fetched =
        opts.prefetched ??
        (await fetchFeed(meta.url, opts.force ? {} : { etag: meta.etag, lastModified: meta.lastModified }));
      if (!fetched.changed) {
        await this.finishUnchanged(connection, meta, fetched, job.id);
        return { status: 'unchanged' };
      }

      const parsed = parseFeed(fetched.format!, fetched.body, {
        maxProducts: await this.productLimit(connection.tenantId),
      });
      const payloadHash = createHash('sha256').update(JSON.stringify(parsed.products)).digest('hex');
      if (!opts.force && meta.payloadHash === payloadHash) {
        await this.finishUnchanged(connection, meta, fetched, job.id);
        return { status: 'unchanged' };
      }

      const partial = !!meta.lastItemCount && parsed.products.length < meta.lastItemCount * PARTIAL_FEED_RATIO;
      const warnings: FeedWarning[] = partial
        ? [...parsed.warnings, { code: 'partial_feed', count: meta.lastItemCount! - parsed.products.length }]
        : parsed.warnings;
      const result = await this.catalog.importCatalog(connection.tenantId, parsed.products, {
        idPrefix: FEED_ID_PREFIX,
        archiveMissing: !partial,
      });
      this.catalogIndex.invalidate(connection.tenantId);

      const firstImport = !meta.payloadHash;
      await this.saveState(connection, {
        ...meta,
        format: parsed.format,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        payloadHash,
        // A broken run doesn't become the new baseline.
        lastItemCount: partial ? meta.lastItemCount : parsed.products.length,
        warnings,
        lastError: null,
      });
      await this.integrations.markJobDone(job.id, { ...result, errors: result.errors.slice(0, 20), products: parsed.products.length, warnings });
      if (firstImport) void this.extractAttributes(connection.tenantId);
      return { status: 'imported' };
    } catch (err) {
      const code = err instanceof FeedError ? err.code : 'import_failed';
      const message = (err as Error).message;
      this.logger.warn(`Feed ${connectionId} (${meta.url}) failed: ${code} ${message}`);
      await this.saveState(connection, { ...meta, lastError: { code, message } }, ConnectionStatus.Error);
      await this.integrations.markJobFailed(job.id, `${code}: ${message}`);
      if (opts.prefetched) throw err;
      return { status: 'failed' };
    } finally {
      this.running.delete(connectionId);
    }
  }

  private async finishUnchanged(connection: Connection, meta: FeedMeta, fetched: FetchedFeed, jobId: string): Promise<void> {
    await this.saveState(connection, {
      ...meta,
      etag: fetched.etag ?? meta.etag,
      lastModified: fetched.lastModified ?? meta.lastModified,
      lastError: null,
    });
    await this.integrations.markJobDone(jobId, { unchanged: true });
  }

  private async saveState(connection: Connection, meta: FeedMeta, status = ConnectionStatus.Connected): Promise<void> {
    await this.connections.update(connection.id, {
      metadata: meta as never,
      status,
      ...(status === ConnectionStatus.Connected && { lastSyncAt: new Date() }),
    });
  }

  /** The plan's product limit; null = unlimited. */
  private async productLimit(tenantId: string): Promise<number | null> {
    const [row]: Array<{ products_limit: number | null; found: boolean }> = await this.dataSource.query(
      `SELECT c.products_limit, c.id IS NOT NULL AS found
         FROM subscription_plans sp
         LEFT JOIN subscription_plan_configs c
           ON c.plan_type = CASE WHEN sp.plan_type = 'trial' THEN $2 ELSE sp.plan_type END AND c.is_active
        WHERE sp.tenant_id = $1
        ORDER BY sp.created_at DESC
        LIMIT 1`,
      [tenantId, TRIAL_PLAN],
    );
    if (!row || !row.found) return DEFAULT_PRODUCT_LIMIT;
    return row.products_limit;
  }

  /**
   * After a store's first import, read look attributes (formality, fit…) from
   * product photos so «щось на весілля» works from day one. Clothing only: the
   * extraction prompt is written for clothes and shoes. One product at a time,
   * in the background.
   */
  private async extractAttributes(tenantId: string): Promise<void> {
    const [tenant]: Array<{ clothing: boolean }> = await this.dataSource.query(
      `SELECT (t.business_type = 'fashion' OR sc.flow_config->>'businessType' = 'clothing') AS clothing
         FROM tenants t LEFT JOIN store_configs sc ON sc.tenant_id = t.id WHERE t.id = $1`,
      [tenantId],
    );
    if (!tenant?.clothing) return;
    const ids = await this.attributes.findStale({ tenantId, limit: 5000, backoffMinutes: 0 });
    let done = 0;
    for (const id of ids) {
      const r = await this.attributes.extract(id, { tenantId }).catch((err) => ({ ok: false, error: (err as Error).message }));
      if (r.ok) done++;
    }
    this.catalogIndex.invalidate(tenantId);
    this.logger.log(`Attributes read for ${done}/${ids.length} products of ${tenantId}`);
  }
}

function summarize(parsed: ParsedFeed): FeedPreview {
  const inStock = (p: ParsedFeed['products'][number]) => p.variants.some((v) => (v.inventoryQty ?? 0) > 0);
  return {
    format: parsed.format,
    products: parsed.products.length,
    variants: parsed.products.reduce((n, p) => n + p.variants.length, 0),
    inStock: parsed.products.filter(inStock).length,
    sample: parsed.products.slice(0, 5).map((p) => {
      const prices = p.variants.map((v) => v.salePrice ?? v.price);
      return {
        title: p.title,
        category: p.categories?.[0] ?? null,
        price: Math.min(...prices),
        currency: p.variants[0]?.currency ?? 'UAH',
        colors: [...new Set(p.variants.map((v) => v.color).filter((c): c is string => !!c))],
        sizes: [...new Set(p.variants.map((v) => v.size).filter((s): s is string => !!s))],
        image: p.images?.[0]?.url ?? null,
        inStock: inStock(p),
      };
    }),
    warnings: parsed.warnings,
  };
}
