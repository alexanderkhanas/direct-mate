import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, Not, Repository } from 'typeorm';
import OpenAI from 'openai';
import { InstagramMediaMapping } from './entities/instagram-media-mapping.entity';
import { Connection } from '../../integrations/entities/connection.entity';
import { Product } from '../../catalog/entities/product.entity';
import { ProductVariant } from '../../catalog/entities/product-variant.entity';
import { StoreConfig } from '../../engine/entities/store-config.entity';
import { CryptoService } from '../../../common/crypto.service';
import { ImageHashService } from '../../catalog/image-hash.service';
import { ImageEmbeddingService } from '../../catalog/image-embedding.service';
import { DataSource } from 'typeorm';
import { ConnectionType, ConnectionStatus } from '@direct-mate/shared';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { uploadPath } from '../../../common/uploads';
import { GRAPH_API, GRAPH_BUDGET_KEY } from '../../../common/meta-graph';
import { safeFetch } from '../../../common/safe-fetch';
import type { IgAccount } from './instagram-sender.service';

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

/** What Graph or a webhook tells us about one piece of content. */
export interface ContentDetails {
  caption?: string | null;
  mediaUrl?: string | null;
  permalink?: string | null;
  /** Graph's `media_type`, lower case: image, video, carousel_album. */
  mediaType?: string | null;
  /** A video's cover (the store's own reels and video posts). */
  thumbnailUrl?: string | null;
  /** Graph's `media_product_type`: FEED, REELS, STORY, AD. */
  productType?: string | null;
  /** Our stored copy (image or video contact sheet), `/uploads/content-media/…`. */
  imagePath?: string | null;
}

/** What Graph said about one piece of content. `refused`: it can't be read with the store's token, or there is none. */
export type MediaRead = { details: ContentDetails } | { details: null; refused: boolean };

/** A post, reel or story as Graph returns it. */
interface GraphMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

interface GraphPage {
  data?: GraphMedia[];
  paging?: { cursors?: { after?: string }; next?: string };
}

const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp';
const POSTS_PAGE_SIZE = 50;
/** Posts read in one run at most: a store's first sync, or a burst of new posts. */
const MAX_POSTS_PER_RUN = 200;
const MAX_STORIES_PER_RUN = 100;
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** The scheduled run reads posts and reels on every other 30-minute tick. */
const POSTS_INTERVAL_MS = 55 * 60 * 1000;
/** New stories matched by vision per store per run: one model call each. */
const VISION_STORIES_PER_RUN = 5;
/** Every Graph call. */
const GRAPH_TIMEOUT_MS = 30_000;
/** An image downloaded for a vision call. */
const VISION_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VISION_IMAGE_TIMEOUT_MS = 15_000;

const DEFAULT_SKU_PATTERNS = [
  'SKU[:\\s]*(\\S+)',
  '#SKU(\\S+)',
  'Артикул[:\\s]*(\\S+)',
  'Код[:\\s]*(\\S+)',
  'арт\\.?[:\\s]*(\\S+)',
];

/**
 * One product candidate routed to the GPT vision verification step.
 *
 * `cosine` is null for `linked`-only candidates (we don't run a CLIP
 * embed against the IG post photo URL — they're included as
 * supplementary corroboration and rely on GPT to rank them visually).
 *
 * `source`:
 *   - `clip` — surfaced by the CLIP cosine ranking.
 *   - `linked` — drawn from the last 10 confirmed
 *     `instagram_media_mappings` rows, productId NOT covered by CLIP.
 *   - `clip+linked` — surfaced by CLIP AND productId is also present
 *     in linked media (strongest corroboration; satisfies the
 *     "strong linked-media corroboration" branch of the acceptance
 *     gate even when cosine < the strong-cosine floor).
 */
type VisionCandidate = {
  productId: string;
  variantId: string | null;
  color: string | null;
  mediaUrl: string;
  title: string;
  sku: string | null;
  category: string | null;
  cosine: number | null;
  source: 'clip' | 'linked' | 'clip+linked';
};

@Injectable()
export class InstagramContentService {
  private readonly logger = new Logger(InstagramContentService.name);
  private readonly openai: OpenAI;
  /** A scheduled run is in progress in this process. Production is a single replica. */
  private running = false;
  /** When this process last started reading posts and reels; 0 = not since boot. */
  private lastPostsAt = 0;

  constructor(
    @InjectRepository(InstagramMediaMapping)
    private readonly mappingRepo: Repository<InstagramMediaMapping>,
    @InjectRepository(Connection)
    private readonly connectionRepo: Repository<Connection>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(StoreConfig)
    private readonly storeConfigRepo: Repository<StoreConfig>,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly imageHashService: ImageHashService,
    private readonly imageEmbeddingService: ImageEmbeddingService,
    private readonly dataSource: DataSource,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get<string>('openai.apiKey') });
  }

  async findByMediaId(
    tenantId: string,
    mediaId: string,
  ): Promise<InstagramMediaMapping | null> {
    return this.mappingRepo.findOne({
      where: { tenantId, instagramMediaId: mediaId },
    });
  }

  /**
   * Persist a customer-photo match to `instagram_media_mappings` so
   * subsequent turns for the same media_id read from cache instead of
   * re-running pHash/CLIP/vision. Race-safe: `(tenantId, instagramMediaId)`
   * UNIQUE constraint + orIgnore() means a duplicate-key conflict from
   * a concurrent write is silently no-op'd. Always inserts with
   * `confirmed=false` so the admin linking page surfaces auto-matches
   * for review.
   */
  async persistCustomerPhotoMatch(
    tenantId: string,
    mediaId: string,
    match: {
      productId: string;
      variantId: string | null;
      color: string | null;
      confidence: number;
      matchMethod:
        | 'customer_photo_phash'
        | 'customer_photo_exact'
        | 'customer_photo_clip'
        | 'customer_photo_vision';
    },
  ): Promise<void> {
    await this.mappingRepo
      .createQueryBuilder()
      .insert()
      .into(InstagramMediaMapping)
      .values({
        tenantId,
        instagramMediaId: mediaId,
        mediaType: 'customer_photo',
        productId: match.productId,
        variantId: match.variantId,
        linkedColor: match.color,
        matchMethod: match.matchMethod,
        matchConfidence: match.confidence,
        confirmed: false,
      })
      .orIgnore()
      .execute();
  }

  /**
   * Remember a piece of content a customer brought up that isn't linked to a
   * product: a new row, or the empty fields of an existing one filled in (the
   * image we saved, the caption, Meta's links). Never touches a link. A stored
   * image equal to `stalePath` (its file is gone) is replaced.
   */
  async saveUnlinkedMedia(
    tenantId: string,
    mediaId: string,
    mediaType: string,
    details: ContentDetails = {},
    stalePath: string | null = null,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO instagram_media_mappings
         (tenant_id, instagram_media_id, media_type, caption, media_url, permalink, image_path, thumbnail_url, media_product_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, instagram_media_id) DO UPDATE SET
         caption = coalesce(instagram_media_mappings.caption, EXCLUDED.caption),
         media_url = coalesce(EXCLUDED.media_url, instagram_media_mappings.media_url),
         permalink = coalesce(instagram_media_mappings.permalink, EXCLUDED.permalink),
         image_path = CASE WHEN instagram_media_mappings.image_path IS NOT DISTINCT FROM $10::text THEN EXCLUDED.image_path
                           ELSE coalesce(instagram_media_mappings.image_path, EXCLUDED.image_path) END,
         thumbnail_url = coalesce(EXCLUDED.thumbnail_url, instagram_media_mappings.thumbnail_url),
         media_product_type = coalesce(instagram_media_mappings.media_product_type, EXCLUDED.media_product_type)`,
      [
        tenantId,
        mediaId,
        mediaType,
        details.caption ?? null,
        details.mediaUrl ?? null,
        details.permalink ?? null,
        details.imagePath ?? null,
        details.thumbnailUrl ?? null,
        details.productType ?? null,
        stalePath,
      ],
    );
  }

  /**
   * Keep our copy of a piece of content's image (or video contact sheet), made
   * once per media id: where there is none yet, or the one stored is
   * `stalePath` (its file is gone).
   */
  async saveContentImage(tenantId: string, mediaId: string, imagePath: string, stalePath: string | null = null): Promise<void> {
    await this.dataSource.query(
      `UPDATE instagram_media_mappings SET image_path = $3
        WHERE tenant_id = $1 AND instagram_media_id = $2 AND (image_path IS NULL OR image_path = $4::text)`,
      [tenantId, mediaId, imagePath, stalePath],
    );
  }

  async findAll(
    tenantId: string,
    filters?: { linked?: boolean; limit?: number; offset?: number },
  ): Promise<{ items: InstagramMediaMapping[]; total: number }> {
    const qb = this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .orderBy('m.createdAt', 'DESC');

    if (filters?.linked === true) qb.andWhere('m.product_id IS NOT NULL');
    if (filters?.linked === false) qb.andWhere('m.product_id IS NULL');

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    qb.take(limit).skip(offset);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async updateMapping(
    id: string,
    tenantId: string,
    data: {
      productId?: string | null;
      variantId?: string | null;
      linkedColor?: string | null;
      confirmed?: boolean;
    },
  ): Promise<InstagramMediaMapping> {
    const mapping = await this.mappingRepo.findOne({ where: { id, tenantId } });
    if (!mapping) throw new NotFoundException('Mapping not found');

    if (data.productId !== undefined) mapping.productId = data.productId;
    if (data.variantId !== undefined) mapping.variantId = data.variantId;
    if (data.linkedColor !== undefined) mapping.linkedColor = data.linkedColor;
    if (data.confirmed !== undefined) mapping.confirmed = data.confirmed;
    if (data.productId) mapping.matchMethod = 'manual';

    return this.mappingRepo.save(mapping);
  }

  async deleteMapping(id: string, tenantId: string): Promise<void> {
    const mapping = await this.mappingRepo.findOne({ where: { id, tenantId } });
    if (!mapping) throw new NotFoundException('Mapping not found');
    await this.mappingRepo.remove(mapping);
  }

  async createManualMapping(
    tenantId: string,
    data: { instagramMediaId: string; mediaType?: string; caption?: string; productId?: string },
  ): Promise<InstagramMediaMapping> {
    const existing = await this.mappingRepo.findOne({
      where: { tenantId, instagramMediaId: data.instagramMediaId },
    });
    if (existing) {
      if (data.productId) existing.productId = data.productId;
      if (data.caption) existing.caption = data.caption;
      existing.matchMethod = 'manual';
      existing.confirmed = !!data.productId;
      return this.mappingRepo.save(existing);
    }

    // Try to fetch media info from Instagram API
    let fetchedCaption = data.caption ?? null;
    let fetchedMediaUrl: string | null = null;
    let fetchedPermalink: string | null = null;
    let fetchedMediaType = data.mediaType ?? 'highlight';

    if (/^\d+$/.test(data.instagramMediaId)) {
      const info = await this.getMediaDetails(tenantId, data.instagramMediaId);
      if (info) {
        fetchedCaption = fetchedCaption || info.caption || null;
        fetchedMediaUrl = info.mediaUrl || null;
        fetchedPermalink = info.permalink || null;
        fetchedMediaType = info.mediaType || fetchedMediaType;
      }
    }

    return this.mappingRepo.save(this.mappingRepo.create({
      tenantId,
      instagramMediaId: data.instagramMediaId,
      mediaType: fetchedMediaType,
      caption: fetchedCaption,
      mediaUrl: fetchedMediaUrl,
      permalink: fetchedPermalink,
      productId: data.productId ?? null,
      matchMethod: 'manual',
      confirmed: !!data.productId,
    }));
  }

  /**
   * One piece of content from Graph: caption, links, and what kind it is.
   * Null when the store isn't connected, or the media isn't readable with its
   * token (another account's post a customer shared, an expired story), or
   * Graph failed.
   */
  async getMediaDetails(tenantId: string, mediaId: string): Promise<ContentDetails | null> {
    return (await this.readMediaDetails(tenantId, mediaId)).details;
  }

  /**
   * `getMediaDetails`, telling a refusal from a failure: `refused` when the
   * store isn't connected or Graph says the media can't be read with its token
   * (codes 10 and 200, or 100 with subcode 33); not when Graph timed out,
   * throttled or erred.
   */
  async readMediaDetails(tenantId: string, mediaId: string): Promise<MediaRead> {
    try {
      const connection = await this.connectionRepo.findOne({
        where: { tenantId, type: ConnectionType.Instagram, status: ConnectionStatus.Connected },
      });
      if (!connection?.accessTokenEncrypted) return { details: null, refused: true };

      const token = this.crypto.decrypt(connection.accessTokenEncrypted);
      const res = await fetch(
        `${GRAPH_API}/${mediaId}?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: number; error_subcode?: number } } | null;
        const code = body?.error?.code;
        const refused = code === 10 || code === 200 || (code === 100 && body?.error?.error_subcode === 33);
        this.logger.warn(`Failed to fetch media info for ${mediaId}: ${res.status}${code ? ` (code ${code})` : ''}`);
        return { details: null, refused };
      }
      const data = await res.json() as any;
      return {
        details: {
          caption: data.caption,
          mediaUrl: data.media_url,
          permalink: data.permalink,
          mediaType: (data.media_type ?? '').toLowerCase(),
          thumbnailUrl: data.thumbnail_url,
          productType: data.media_product_type,
        },
      };
    } catch (err) {
      this.logger.warn(`Error fetching media info: ${(err as Error).message}`);
      return { details: null, refused: false };
    }
  }

  parseInstagramLink(url: string): { mediaId: string | null; highlightId: string | null; type: string } {
    // Extract story_media_id from highlight links
    // e.g. https://www.instagram.com/s/aGlnaGxpZ2h0OjE3ODUy...?story_media_id=3863556360571278165
    const storyMediaMatch = url.match(/story_media_id=(\d+)/);
    if (storyMediaMatch) {
      // Also decode highlight ID from base64 path
      const base64Match = url.match(/instagram\.com\/s\/([A-Za-z0-9+/=]+)/);
      let highlightId: string | null = null;
      if (base64Match) {
        try {
          const decoded = Buffer.from(base64Match[1], 'base64').toString('utf8');
          // decoded = "highlight:17852274741645557"
          highlightId = decoded.replace('highlight:', '');
        } catch { /* ignore */ }
      }
      return { mediaId: storyMediaMatch[1], highlightId, type: 'highlight' };
    }

    // Extract from regular post links: https://www.instagram.com/p/ABC123/
    const postMatch = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    if (postMatch) {
      return { mediaId: postMatch[1], highlightId: null, type: 'post' };
    }

    // Extract from story links: https://www.instagram.com/stories/username/12345/
    const storyMatch = url.match(/stories\/[^/]+\/(\d+)/);
    if (storyMatch) {
      return { mediaId: storyMatch[1], highlightId: null, type: 'story' };
    }

    return { mediaId: null, highlightId: null, type: 'unknown' };
  }

  /**
   * Resolve a pasted Instagram POST/REEL url («…/p/DatNLAWgFMB/») to the
   * `instagram_media_id` of the mapping that links it to a product — so the
   * caller can hand it to the normal media-resolution flow as if it were a
   * post reply. Returns null when the url isn't a post link or the post isn't
   * mapped to a product (→ caller keeps today's behavior: plain text → handoff).
   *
   * Matched by `permalink` (the shortcode), NOT `instagram_media_id`: a pasted
   * url gives us the shortcode, while the mapping is keyed by the numeric media
   * id.
   */
  async resolveMediaIdByPostUrl(
    tenantId: string,
    url: string,
  ): Promise<string | null> {
    const parsed = this.parseInstagramLink(url);
    if (parsed.type !== 'post' || !parsed.mediaId) return null;
    const shortcode = parsed.mediaId;

    const row = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      // Match the shortcode between slashes so it works for both /p/ and /reel/
      // permalinks. `escapeLike` neutralises `_`/`%` inside shortcodes (SQL LIKE
      // wildcards) so a shortcode with an underscore can't over-match.
      .andWhere("m.permalink LIKE :pattern ESCAPE '\\'", {
        pattern: `%/${this.escapeLike(shortcode)}/%`,
      })
      .andWhere('m.product_id IS NOT NULL')
      .getOne();

    return row?.instagramMediaId ?? null;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`);
  }

  // ─── Fetching content ─────────────────────────────────────────

  /**
   * Every 30 minutes: each connected store's live stories, so every story is
   * seen within its 24 hours; on every other tick, its new posts and reels too.
   * Off with CONTENT_FETCH_WORKER_ENABLED=false (the CLI scripts do that).
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick(): Promise<void> {
    if (!this.config.get<boolean>('contentFetch.workerEnabled')) return;
    if (this.running) return;
    this.running = true;
    try {
      const pausedUntil = await this.graphPausedUntil();
      if (pausedUntil) {
        this.logger.log(`Content fetch skipped: Meta's call budget is paused until ${pausedUntil}`);
        return;
      }
      const posts = Date.now() - this.lastPostsAt >= POSTS_INTERVAL_MS;
      if (posts) this.lastPostsAt = Date.now();
      await this.fetchAllStores({ posts });
    } catch (err) {
      this.logger.error(`Content fetch failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * When the app-wide pause on Meta's call budget ends, while it lasts (the
   * history import sets it on a throttle or a high `x-app-usage`); null when
   * there is none. Calls made while Meta throttles keep the block going.
   */
  private async graphPausedUntil(): Promise<string | null> {
    const [row]: Array<{ paused_until: string }> = await this.dataSource.query(
      `SELECT value->>'pausedUntil' AS paused_until FROM app_state
        WHERE key = $1 AND (value->>'pausedUntil')::timestamptz > now()`,
      [GRAPH_BUDGET_KEY],
    );
    return row?.paused_until ?? null;
  }

  /**
   * One pass over every connected store, one store at a time; a store's
   * failure is logged and the rest carry on. The new-story vision pass comes
   * after every store is fetched, so a slow model call never holds up another
   * store's stories.
   */
  async fetchAllStores(opts: { posts: boolean }): Promise<void> {
    const connections = await this.connectionRepo.find({
      where: { type: ConnectionType.Instagram, status: ConnectionStatus.Connected },
    });
    const stores = [...new Map(connections.map((c) => [c.tenantId, c])).values()].filter(
      (c) => c.accessTokenEncrypted && c.externalAccountId,
    );

    const newStories: Array<{ tenantId: string; ids: string[] }> = [];
    let fetched = 0;
    let failed = 0;
    for (const connection of stores) {
      try {
        const result = await this.fetchStore(connection, opts);
        fetched += result.fetched;
        if (result.newStoryIds.length) newStories.push({ tenantId: connection.tenantId, ids: result.newStoryIds });
      } catch (err) {
        failed++;
        this.logger.error(`Content fetch failed for tenant ${connection.tenantId}: ${(err as Error).message}`);
      }
    }
    for (const { tenantId, ids } of newStories) await this.matchNewStories(tenantId, ids);

    this.logger.log(
      `Content fetch (${opts.posts ? 'stories, posts and reels' : 'stories'}): ${stores.length} stores, ${fetched} items` +
        (failed ? `, ${failed} failed` : ''),
    );
  }

  /**
   * The Content page's «Fetch content» button: the scheduled fetch for one
   * store, now. Returns once the fetch and the SKU pass are done; vision for
   * new stories carries on in the background, never inside the request.
   */
  async fetchContent(tenantId: string): Promise<{ fetched: number; matched: number }> {
    const connection = await this.connectionRepo.findOne({
      where: { tenantId, type: ConnectionType.Instagram, status: ConnectionStatus.Connected },
    });
    if (!connection || !connection.accessTokenEncrypted || !connection.externalAccountId) {
      throw new BadRequestException('No active Instagram connection');
    }
    const result = await this.fetchStore(connection, { posts: true });
    if (result.newStoryIds.length) void this.matchNewStories(tenantId, result.newStoryIds);
    return { fetched: result.fetched, matched: result.matched };
  }

  /** One store: its stories, and when asked its posts and reels followed by the SKU pass. */
  private async fetchStore(
    connection: Connection,
    opts: { posts: boolean },
  ): Promise<{ fetched: number; matched: number; newStoryIds: string[] }> {
    const tenantId = connection.tenantId;
    const account: IgAccount = {
      token: this.crypto.decrypt(connection.accessTokenEncrypted!),
      igAccountId: connection.externalAccountId!,
    };

    const stories = await this.fetchStories(tenantId, account);
    if (!opts.posts) return { fetched: stories.count, matched: 0, newStoryIds: stories.newIds };

    const fullSync = !(await this.hasFetchedPosts(tenantId));
    const posts = await this.fetchPosts(tenantId, account, fullSync);
    const matched = await this.matchSkusInCaptions(tenantId);
    return { fetched: stories.count + posts, matched, newStoryIds: stories.newIds };
  }

  /**
   * Whether the store's posts were ever fetched. Rows a customer brought up (a
   * story reply, a shared post) and fetched stories don't count, so they no
   * longer stand in the way of the first full sync.
   */
  private async hasFetchedPosts(tenantId: string): Promise<boolean> {
    const [row]: Array<{ found: boolean }> = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM instagram_media_mappings
                       WHERE tenant_id = $1 AND match_method = 'bulk_import' AND media_type <> 'story') AS found`,
      [tenantId],
    );
    return !!row?.found;
  }

  /**
   * Save one fetched post, reel or story, or refresh what Meta says about it
   * (type, caption, links, cover) if we have it already. A link is never
   * touched. True when the item is new to the store.
   */
  private async upsertMedia(
    tenantId: string,
    item: GraphMedia,
    mediaType: string,
    expiresAt: Date | null = null,
  ): Promise<boolean> {
    const rows: Array<{ inserted: boolean }> = await this.dataSource.query(
      `INSERT INTO instagram_media_mappings
         (tenant_id, instagram_media_id, media_type, caption, media_url, permalink, thumbnail_url, media_product_type, match_method, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'bulk_import', $9)
       ON CONFLICT (tenant_id, instagram_media_id) DO UPDATE SET
         media_type = EXCLUDED.media_type,
         caption = coalesce(EXCLUDED.caption, instagram_media_mappings.caption),
         media_url = coalesce(EXCLUDED.media_url, instagram_media_mappings.media_url),
         permalink = coalesce(EXCLUDED.permalink, instagram_media_mappings.permalink),
         thumbnail_url = coalesce(EXCLUDED.thumbnail_url, instagram_media_mappings.thumbnail_url),
         media_product_type = coalesce(EXCLUDED.media_product_type, instagram_media_mappings.media_product_type),
         expires_at = coalesce(instagram_media_mappings.expires_at, EXCLUDED.expires_at),
         fetched_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        tenantId,
        item.id,
        mediaType,
        item.caption ?? null,
        item.media_url ?? null,
        item.permalink ?? null,
        item.thumbnail_url ?? null,
        item.media_product_type ?? null,
        expiresAt,
      ],
    );
    return rows[0]?.inserted === true;
  }

  /**
   * Posts and reels, newest first. The first sync pages back up to 200. After
   * that, paging stops at the first page holding a post we already have; that
   * page is still saved whole, which keeps the newest posts' expiring CDN links
   * and details fresh at no extra Graph call. A failure is logged, not thrown,
   * so the stories fetched before it still reach the vision pass.
   */
  private async fetchPosts(tenantId: string, account: IgAccount, fullSync: boolean): Promise<number> {
    const base = `${GRAPH_API}/${account.igAccountId}/media?fields=${MEDIA_FIELDS}&limit=${POSTS_PAGE_SIZE}`;
    let fetched = 0;

    try {
      let cursor: string | undefined;
      do {
        const res = await fetch(cursor ? `${base}&after=${cursor}` : base, {
          headers: { Authorization: `Bearer ${account.token}` },
          signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        });
        if (!res.ok) {
          this.logger.warn(`Instagram posts API error for tenant ${tenantId}: ${res.status}`);
          break;
        }
        const body = (await res.json()) as GraphPage;

        let reachedKnown = false;
        for (const item of body.data ?? []) {
          const isNew = await this.upsertMedia(tenantId, item, (item.media_type ?? 'IMAGE').toLowerCase());
          if (!isNew) reachedKnown = true;
          fetched++;
        }
        if (reachedKnown && !fullSync) break;
        cursor = body.paging?.next ? body.paging.cursors?.after : undefined;
      } while (cursor && fetched < MAX_POSTS_PER_RUN);

      this.logger.log(`Fetched ${fetched} posts for tenant ${tenantId}${fullSync ? ' (full sync)' : ''}`);
    } catch (err) {
      this.logger.warn(`Failed to fetch posts for tenant ${tenantId} (${fetched} saved): ${(err as Error).message}`);
    }
    return fetched;
  }

  /**
   * The store's live stories. A failure here is logged, not thrown: some
   * accounts can't read stories, and their posts should still be fetched.
   * Returns the stories new to us, for the vision pass.
   */
  private async fetchStories(tenantId: string, account: IgAccount): Promise<{ count: number; newIds: string[] }> {
    const base = `${GRAPH_API}/${account.igAccountId}/stories?fields=${MEDIA_FIELDS}`;
    let count = 0;
    const newIds: string[] = [];

    try {
      let cursor: string | undefined;
      do {
        const res = await fetch(cursor ? `${base}&after=${cursor}` : base, {
          headers: { Authorization: `Bearer ${account.token}` },
          signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
        });
        if (!res.ok) {
          this.logger.warn(`Instagram stories API error for tenant ${tenantId}: ${res.status}`);
          break;
        }
        const body = (await res.json()) as GraphPage;

        for (const item of body.data ?? []) {
          const posted = item.timestamp ? Date.parse(item.timestamp) : NaN;
          const expiresAt = new Date((Number.isNaN(posted) ? Date.now() : posted) + STORY_LIFETIME_MS);
          if (await this.upsertMedia(tenantId, item, 'story', expiresAt)) newIds.push(item.id);
          count++;
        }
        cursor = body.paging?.next ? body.paging.cursors?.after : undefined;
      } while (cursor && count < MAX_STORIES_PER_RUN);

      this.logger.log(`Fetched ${count} stories for tenant ${tenantId} (${newIds.length} new)`);
    } catch (err) {
      this.logger.warn(`Failed to fetch stories for tenant ${tenantId}: ${(err as Error).message}`);
    }

    return { count, newIds };
  }

  /** The vision pass for new stories, after their fetch. A failure is only logged. */
  private async matchNewStories(tenantId: string, ids: string[]): Promise<void> {
    try {
      await this.matchStoriesByVision(tenantId, ids);
    } catch (err) {
      this.logger.error(`Story vision pass failed for tenant ${tenantId}: ${(err as Error).message}`);
    }
  }

  // ─── AI vision matching ────────────────────────────────────────

  /** An image for a vision call, as a data URL. Null when it can't be had, or the link is a video. */
  private async toBase64DataUrl(url: string): Promise<string | null> {
    try {
      // Our own copies (customer photos, demo catalog images) are read from disk.
      const local = uploadPath(url);
      if (local) {
        const mime = MEDIA_TYPES[extname(local).toLowerCase()] ?? 'image/jpeg';
        return `data:${mime};base64,${(await readFile(local)).toString('base64')}`;
      }
      const res = await safeFetch(url, {
        timeoutMs: VISION_IMAGE_TIMEOUT_MS,
        maxBytes: VISION_IMAGE_MAX_BYTES,
        onHeaders: (status, headers) => {
          if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
          if ((headers['content-type'] ?? '').toLowerCase().startsWith('video/')) throw new Error('a video, not an image');
        },
      });
      const mime = res.headers['content-type'] ?? 'image/jpeg';
      return `data:${mime};base64,${res.body.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** The picture vision can read: our copy, a video's cover, else Meta's link (never a video's). */
  private visionImage(m: InstagramMediaMapping): string | null {
    return m.imagePath ?? m.thumbnailUrl ?? (m.mediaType === 'video' ? null : m.mediaUrl) ?? null;
  }

  /**
   * New stories against the store's linked posts: one vision call per story,
   * at most VISION_STORIES_PER_RUN per store. Runs after the fetch, never
   * inside a request.
   */
  private async matchStoriesByVision(tenantId: string, newIds: string[]): Promise<void> {
    if (newIds.length === 0) return;
    const unlinkedStories = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.media_type = :type', { type: 'story' })
      .andWhere('m.product_id IS NULL')
      .andWhere('m.instagram_media_id IN (:...newIds)', { newIds })
      .getMany();

    const candidates = unlinkedStories.filter((s) => this.visionImage(s)).slice(0, VISION_STORIES_PER_RUN);
    if (candidates.length === 0) return;

    const linkedPosts = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.product_id IS NOT NULL')
      .andWhere('(m.image_path IS NOT NULL OR m.thumbnail_url IS NOT NULL OR m.media_url IS NOT NULL)')
      .orderBy('m.created_at', 'DESC')
      .limit(10)
      .getMany();

    if (linkedPosts.length === 0) return;

    // The same posts are compared with every story: download them once.
    const postDataUrls = await Promise.all(linkedPosts.map((p) => this.toBase64DataUrl(this.visionImage(p)!)));
    const validPosts = linkedPosts.filter((_, i) => postDataUrls[i] !== null);
    const validDataUrls = postDataUrls.filter((u): u is string => u !== null);
    if (validPosts.length === 0) return;

    for (const story of candidates) {
      try {
        const storyDataUrl = await this.toBase64DataUrl(this.visionImage(story)!);
        if (!storyDataUrl) {
          this.logger.warn(`Vision match: could not download story image ${story.instagramMediaId}`);
          continue;
        }

        const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = [
          {
            type: 'image_url',
            image_url: { url: storyDataUrl, detail: 'low' },
          },
          ...validDataUrls.map((url): OpenAI.Chat.ChatCompletionContentPart => ({
            type: 'image_url',
            image_url: { url, detail: 'low' },
          })),
          {
            type: 'text',
            text: `The first image is a story. The next ${validPosts.length} images are product posts (index 0 to ${validPosts.length - 1}). Does the story show the same product as any of the posts? Reply with JSON only: {"match": <index or -1 if no match>, "confidence": <0.0 to 1.0>}`,
          },
        ];

        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: imageContent }],
          max_tokens: 50,
          temperature: 0,
        });

        const text = response.choices[0]?.message?.content?.trim() ?? '';
        const jsonMatch = text.match(/\{.*\}/s);
        if (!jsonMatch) continue;

        const result = JSON.parse(jsonMatch[0]) as { match: number; confidence: number };

        if (result.match >= 0 && result.match < validPosts.length && result.confidence >= 0.8) {
          const sourcePost = validPosts[result.match];
          // Only while still unlinked: the owner may have linked it meanwhile.
          await this.mappingRepo.update({ id: story.id, productId: IsNull() }, {
            productId: sourcePost.productId,
            variantId: sourcePost.variantId,
            linkedColor: sourcePost.linkedColor,
            matchMethod: 'ai_vision_match',
            matchConfidence: result.confidence,
          });
          this.logger.log(
            `Story ${story.instagramMediaId} matched to post ${sourcePost.instagramMediaId}${sourcePost.linkedColor ? ` (color=${sourcePost.linkedColor})` : ''} via vision (confidence: ${result.confidence})`,
          );
        } else {
          this.logger.log(
            `Story ${story.instagramMediaId}: no vision match (match=${result.match}, confidence=${result.confidence})`,
          );
        }
      } catch (err) {
        this.logger.error(`Vision match failed for story ${story.instagramMediaId}: ${err}`);
      }
    }
  }

  // ─── Customer photo matching ───────────────────────────────────

  async matchCustomerPhoto(
    tenantId: string,
    customerImageUrl: string,
    opts?: { conversationId?: string },
  ): Promise<{
    productId: string;
    variantId: string | null;
    color: string | null;
    confidence: number;
    matchMethod:
      | 'customer_photo_phash'
      | 'customer_photo_exact'
      | 'customer_photo_clip'
      | 'customer_photo_vision';
  } | null> {
    // Three-stage flow:
    //   Stage 1 — pHash exact-match shortcut. Catches "customer
    //             reshares our catalog photo verbatim".
    //   Stage 2 — CLIP cosine ranking over `product_media.clip_embedding`
    //             (semantic / visual similarity, robust to
    //             angle/crop/lighting). Top results are deduped by
    //             productId; up to 15 distinct products go to vision.
    //             Last 10 confirmed `instagram_media_mappings` rows are
    //             merged in (linked-media corroboration); overlaps
    //             upgrade source to `clip+linked`.
    //   Stage 3 — GPT vision verifies which candidate (if any) is the
    //             same product. Final accept/reject lives here. Never
    //             auto-accept based on CLIP cosine alone.
    const conversationTag = opts?.conversationId ?? '-';

    // ─── Stage 1: pHash direct match ───────────────────────────────
    const phashCandidates = await this.findCatalogCandidatesByPhash(
      tenantId,
      customerImageUrl,
    );

    if (phashCandidates && phashCandidates.candidates.length > 0) {
      const closest = phashCandidates.candidates[0];
      const second = phashCandidates.candidates[1];
      const directMatch =
        closest.distance <= ImageHashService.MATCH_THRESHOLD &&
        (!second || second.distance > closest.distance);
      if (directMatch) {
        this.logger.log(
          `Customer photo: pHash direct match (distance=${closest.distance}) → product ${closest.product_id}`,
        );
        const variantId = closest.color
          ? await this.resolveVariantByColor(closest.product_id, closest.color)
          : null;
        const confidence = Math.max(
          0.7,
          1 - closest.distance / (ImageHashService.MATCH_THRESHOLD * 2),
        );
        return {
          productId: closest.product_id,
          variantId,
          color: closest.color ?? null,
          confidence,
          matchMethod: 'customer_photo_phash',
        };
      }
    }

    // Load linked media (last 10 confirmed mappings). Used both for
    // exact-URL short-circuit AND as supplementary candidates in
    // Stage 2. A linked candidate is "strong corroboration" — the
    // mapping was admin-confirmed or auto-linked from SKU caption,
    // so a vision pick against one is more trustworthy than a pure
    // CLIP-only pick.
    const linkedMedia = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.product_id IS NOT NULL')
      .andWhere('m.media_url IS NOT NULL')
      // Exclude self-generated customer-photo mappings — those rows
      // are produced by past customer-photo matches (persisted by
      // `persistCustomerPhotoMatch` for cache reuse). Letting them
      // back into this "trusted linked" query creates a contamination
      // loop: one noisy vision accept becomes a future "linked"
      // candidate, escalating confidence without human review. Only
      // human-confirmed mappings (admin manual) and SKU-caption /
      // story-from-post auto-links count as trusted corroboration
      // for new photo matches.
      .andWhere(
        `(m.match_method IS NULL
          OR m.match_method NOT IN (
            'customer_photo_phash',
            'customer_photo_clip',
            'customer_photo_vision',
            'customer_photo_exact'
          ))`,
      )
      .orderBy('m.created_at', 'DESC')
      .limit(10)
      .getMany();

    // Short-circuit: customer URL is literally one of the linked
    // media URLs (deterministic, simulator-friendly).
    const exact = linkedMedia.find((m) => m.mediaUrl === customerImageUrl);
    if (exact) {
      this.logger.log(
        `Customer photo: exact URL match to media ${exact.instagramMediaId} → product ${exact.productId}`,
      );
      return {
        productId: exact.productId!,
        variantId: exact.variantId,
        color: exact.linkedColor ?? null,
        confidence: 1.0,
        matchMethod: 'customer_photo_exact',
      };
    }

    // ─── Stage 2: CLIP retrieval ───────────────────────────────────
    // Replicate fetches the image itself, so a file only we serve can't be embedded.
    const customerEmbedding = /^https?:\/\//i.test(customerImageUrl)
      ? await this.imageEmbeddingService.embedFromUrl(customerImageUrl)
      : null;

    let clipCandidates: VisionCandidate[] = [];
    let top1: VisionCandidate | undefined;
    let top2: VisionCandidate | undefined;
    let ambiguousCloseCandidates = false;

    if (customerEmbedding) {
      clipCandidates = await this.findCatalogCandidatesByClip(
        tenantId,
        customerEmbedding,
      );
      top1 = clipCandidates[0];
      top2 = clipCandidates[1];
      if (
        top1 &&
        top2 &&
        top1.productId !== top2.productId &&
        (top1.cosine ?? 0) - (top2.cosine ?? 0) < 0.03
      ) {
        ambiguousCloseCandidates = true;
      }
    } else {
      this.logger.warn(
        `Customer photo: CLIP embedding failed (conv=${conversationTag}) → falling back to linked-only candidates`,
      );
    }

    // Mark CLIP candidates that overlap with linked media. Their
    // source upgrades from `clip` → `clip+linked` so the acceptance
    // gate's "strong linked-media corroboration" branch can fire
    // even when the picked candidate came in via the CLIP path.
    const linkedProductIds = new Set(
      linkedMedia
        .filter((m) => m.productId)
        .map((m) => m.productId as string),
    );
    for (const c of clipCandidates) {
      if (linkedProductIds.has(c.productId)) c.source = 'clip+linked';
    }

    // Linked-only candidates: any linked-media row whose productId
    // isn't already covered by the CLIP set. We pull product
    // metadata in `hydrateCandidateMetadata` further down.
    const clipProductIds = new Set(clipCandidates.map((c) => c.productId));
    const linkedOnly: VisionCandidate[] = linkedMedia
      .filter(
        (m) =>
          m.productId && m.mediaUrl && !clipProductIds.has(m.productId),
      )
      .slice(0, 10)
      .map(
        (m): VisionCandidate => ({
          productId: m.productId!,
          variantId: m.variantId ?? null,
          color: null,
          mediaUrl: m.mediaUrl!,
          title: '',
          sku: null,
          category: null,
          cosine: null,
          source: 'linked',
        }),
      );

    // Final candidate set: cap CLIP top to 15 distinct products,
    // append linked-only (up to 10). Vision sees at most 25
    // deduped product candidates.
    const allCandidates: VisionCandidate[] = [
      ...clipCandidates.slice(0, 15),
      ...linkedOnly,
    ];

    if (allCandidates.length === 0) {
      this.logger.log(
        `Customer photo: no CLIP or linked candidates (conv=${conversationTag}) → handoff`,
      );
      return null;
    }

    // Hydrate title / sku / category for any candidate that doesn't
    // already have them (linked-only rows arrive without metadata).
    await this.hydrateCandidateMetadata(allCandidates);

    // ─── Stage 3: Vision verification ──────────────────────────────
    const customerDataUrl = await this.toBase64DataUrl(customerImageUrl);
    if (!customerDataUrl) {
      this.logger.warn(`matchCustomerPhoto: could not download customer image url=${customerImageUrl.slice(0, 80)}…`);
      return null;
    }
    // Diagnostic — prod is rejecting vision matches at 0.98 confidence on
    // image setups that succeed locally. Log image fingerprint + the full
    // signed URL so the same bytes can be re-fetched from local within
    // the ~24h Meta lookaside signature validity window. SHA-256 lets us
    // confirm bit-identical bytes between local and prod fetch attempts.
    {
      const semiIdx = customerDataUrl.indexOf(',');
      const mime = customerDataUrl.slice(5, customerDataUrl.indexOf(';'));
      const b64Len = semiIdx > 0 ? customerDataUrl.length - semiIdx - 1 : 0;
      const approxBytes = Math.floor(b64Len * 3 / 4);
      const rawB64 = customerDataUrl.slice(semiIdx + 1);
      const bytes = Buffer.from(rawB64, 'base64');
      const sha256 = (await import('node:crypto'))
        .createHash('sha256')
        .update(bytes)
        .digest('hex');
      let assetId = 'unknown';
      try { assetId = new URL(customerImageUrl).searchParams.get('asset_id') ?? 'unknown'; } catch { /* keep unknown */ }
      this.logger.log(
        `Customer photo: customer image fetched mime=${mime} base64Len=${b64Len} approxKB=${(approxBytes / 1024).toFixed(1)} sha256=${sha256.slice(0, 16)} asset_id=${assetId} url=${customerImageUrl}`,
      );
    }

    const candidateDataUrls = await Promise.all(
      allCandidates.map((c) => this.toBase64DataUrl(c.mediaUrl)),
    );
    const validIdx: number[] = [];
    const validUrls: string[] = [];
    const failedCandidates: Array<{ url: string; productId: string; source: string }> = [];
    for (let i = 0; i < allCandidates.length; i++) {
      const dataUrl = candidateDataUrls[i];
      if (dataUrl) {
        validIdx.push(i);
        validUrls.push(dataUrl);
      } else {
        const c = allCandidates[i];
        failedCandidates.push({ url: c.mediaUrl, productId: c.productId, source: c.source });
      }
    }

    // Diagnostic — partial candidate-fetch failures are invisible to the
    // acceptance gate. When the right answer's image silently fails to
    // download (DNS hairpinning, TLS to own host, 403, etc.), vision
    // receives a candidate list missing the correct match and rejects
    // at high confidence. Log the per-call download tally so prod log
    // grep can prove or rule out this mode. Cause-of-record: prod conv
    // `05d802e7-…` where vision rejected a CLIP=0.98 match three times
    // and no other diagnostic surfaced the partial-failure shape.
    if (failedCandidates.length > 0) {
      this.logger.warn(
        `Customer photo: ${failedCandidates.length}/${allCandidates.length} candidate images failed to download — ${JSON.stringify(failedCandidates.slice(0, 5))}`,
      );
    } else {
      // Per-candidate fingerprint: title + source + first-16 of base64-SHA-256.
      // Lets a local probe re-fetch each URL, compute its SHA, and prove
      // the exact bytes sent to OpenAI match (or don't) between envs.
      const crypto = await import('node:crypto');
      const fingerprints = validIdx.map((idx, promptIdx) => {
        const c = allCandidates[idx];
        const dataUrl = candidateDataUrls[idx]!;
        const semi = dataUrl.indexOf(',');
        const bytes = Buffer.from(dataUrl.slice(semi + 1), 'base64');
        const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
        return `${promptIdx + 1}:${c.title.slice(0, 20).replace(/\s+/g, '_')}[${c.source}]=${sha}`;
      });
      this.logger.log(
        `Customer photo: ${validIdx.length}/${allCandidates.length} candidate images downloaded — ${fingerprints.join(' ')}`,
      );
    }

    if (validIdx.length === 0) {
      this.logger.warn(
        `Customer photo: all candidate images failed to download → handoff`,
      );
      return null;
    }

    try {
      const candidateMetadataLines = validIdx
        .map((idx, promptIdx) => {
          const c = allCandidates[idx];
          const parts = [
            `${promptIdx + 1}: title="${c.title || '(unknown)'}"`,
          ];
          if (c.sku) parts.push(`sku=${c.sku}`);
          if (c.category) parts.push(`category=${c.category}`);
          parts.push(`source=${c.source}`);
          if (c.cosine !== null) parts.push(`cosine=${c.cosine.toFixed(3)}`);
          return '  ' + parts.join(' ');
        })
        .join('\n');

      const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = [
        {
          type: 'image_url',
          image_url: { url: customerDataUrl, detail: 'low' },
        },
        ...validUrls.map((url): OpenAI.Chat.ChatCompletionContentPart => ({
          type: 'image_url',
          image_url: { url, detail: 'low' },
        })),
        {
          type: 'text',
          text:
            `Image 0 is a customer's screenshot or photo of a product they are interested in. ` +
            `It may be from Instagram, a reseller page, a brand page, or a cropped image — different framing, model pose, crop, lighting, and Instagram UI chrome are normal.\n\n` +
            `Images 1 to ${validUrls.length} are products from OUR store, with the following metadata:\n` +
            candidateMetadataLines +
            `\n\n` +
            `Select a candidate ONLY if it appears to be the same actual product/SKU as image 0 — not just visually similar. ` +
            `Use BOTH visual evidence AND the metadata (title / brand / category / SKU) when deciding. ` +
            `Two different products that happen to look similar (different brand, different cut, different SKU) → return -1. ` +
            `If unsure, return -1. ` +
            `Do NOT infer products outside the candidate list.\n\n` +
            `Reply with JSON only: {"match": <index 1-${validUrls.length} or -1>, "confidence": <0.0 to 1.0>}. ` +
            `Use confidence ≥ 0.85 only when you are confident it is the same product.`,
        },
      ];

      // Vision-specific model (gpt-4o by default). Separate from the
      // classifier model — vision needs the stronger model for product
      // matching to avoid the prod gpt-5.4-mini rejection regression
      // we hit earlier.
      const visionModel =
        this.config.get<string>('openai.visionModel') ?? 'gpt-4o';
      // Use withResponse() to capture x-request-id from response headers.
      // Local probe with identical input bytes + identical key + identical
      // model name accepts the same match prod rejects; we've ruled out
      // every observable variable. request_id lets us escalate to OpenAI
      // support with a concrete pair of conflicting request IDs.
      const apiResult = await this.openai.chat.completions
        .create({
          model: visionModel,
          messages: [{ role: 'user', content: imageContent }],
          max_completion_tokens: 2000,
          temperature: 0,
        })
        .withResponse();
      const response = apiResult.data;
      const requestId = apiResult.response.headers.get('x-request-id') ?? 'unknown';
      const openaiModelHeader = apiResult.response.headers.get('openai-model') ?? 'unknown';
      this.logger.log(
        `Customer photo: vision request_id=${requestId} openai-model-header=${openaiModelHeader} model-sent=${visionModel}`,
      );

      const text = response.choices[0]?.message?.content?.trim() ?? '';
      const jsonMatch = text.match(/\{.*\}/s);
      if (!jsonMatch) {
        this.logger.warn(
          `Customer photo: vision returned non-JSON response: "${text.slice(0, 200)}"`,
        );
        return null;
      }
      const result = JSON.parse(jsonMatch[0]) as {
        match: number;
        confidence: number;
      };

      const matchIdx = result.match - 1;
      const validRange =
        matchIdx >= 0 && matchIdx < validIdx.length;
      const candidate = validRange
        ? allCandidates[validIdx[matchIdx]]
        : null;

      const margin =
        top1 && top2 ? (top1.cosine ?? 0) - (top2.cosine ?? 0) : null;

      // Diagnostic log per spec: IDs/scores only, no raw content.
      const diag = {
        tenantId,
        conversationId: conversationTag,
        top1: top1
          ? {
              productId: top1.productId,
              cosine: top1.cosine,
              source: top1.source,
            }
          : null,
        top2: top2
          ? {
              productId: top2.productId,
              cosine: top2.cosine,
              source: top2.source,
            }
          : null,
        margin,
        ambiguousCloseCandidates,
        gptMatch: result.match,
        gptConfidence: result.confidence,
      };

      // ─── Acceptance gate ───────────────────────────────────────
      // Accept only if all hold:
      //   1. GPT selected a valid candidate (not -1).
      //   2. GPT confidence ≥ 0.85.
      //   3. Selected candidate has cosine ≥ 0.70 OR strong
      //      linked-media corroboration (`source` includes "linked").
      //   4. Candidate is in the deduped top product candidate set
      //      (true by construction — `allCandidates` already deduped).
      //   5. We are NOT bypassing GPT based on CLIP alone.
      const STRONG_COSINE = 0.7;
      const CONFIDENCE_FLOOR = 0.85;
      const isLinkedCorroborated =
        candidate !== null &&
        (candidate.source === 'linked' || candidate.source === 'clip+linked');
      const cosineOk =
        candidate !== null &&
        candidate.cosine !== null &&
        candidate.cosine >= STRONG_COSINE;

      if (
        candidate &&
        result.confidence >= CONFIDENCE_FLOOR &&
        (cosineOk || isLinkedCorroborated)
      ) {
        const variantId =
          candidate.variantId ??
          (candidate.color
            ? await this.resolveVariantByColor(candidate.productId, candidate.color)
            : null);
        this.logger.log(
          `Customer photo: ACCEPTED ${JSON.stringify({
            ...diag,
            selected: {
              productId: candidate.productId,
              source: candidate.source,
              cosine: candidate.cosine,
            },
            finalDecision: 'accepted',
          })}`,
        );
        return {
          productId: candidate.productId,
          variantId,
          color: candidate.color ?? null,
          confidence: result.confidence,
          // CLIP-corroborated picks are `clip`/`clip+linked`; pure linked
          // picks come from the linked-media exact branch above. The
          // vision step is what gates acceptance in all cases.
          matchMethod: 'customer_photo_vision',
        };
      }

      // High CLIP, GPT-reject — log so we can tune later, but still
      // hand off (do NOT bypass GPT).
      if (
        top1 &&
        (top1.cosine ?? 0) >= 0.85 &&
        (!candidate || result.confidence < CONFIDENCE_FLOOR)
      ) {
        this.logger.log(
          `Customer photo: high CLIP score but vision rejected ${JSON.stringify({
            ...diag,
            finalDecision: 'handoff',
          })}`,
        );
      } else {
        this.logger.log(
          `Customer photo: HANDOFF ${JSON.stringify({
            ...diag,
            finalDecision: 'handoff',
          })}`,
        );
      }
      return null;
    } catch (err) {
      this.logger.error(`matchCustomerPhoto vision call failed: ${err}`);
      return null;
    }
  }

  // ─── CLIP retrieval ────────────────────────────────────────────

  /**
   * Rank tenant `product_media` rows with non-null clip_embedding by
   * cosine similarity to the customer image embedding. Filter weak
   * candidates (cosine < 0.60), dedupe by productId (best media row
   * per product), return top 15 distinct products with attached
   * title / sku / category metadata.
   *
   * CLIP is for retrieval ONLY. Returned candidates still go through
   * GPT vision verification + the acceptance gate before any product
   * is reported as a match. Never auto-accept by cosine alone.
   */
  private async findCatalogCandidatesByClip(
    tenantId: string,
    customerEmbedding: Float32Array,
  ): Promise<VisionCandidate[]> {
    type Row = {
      product_id: string;
      color: string | null;
      url: string;
      clip_embedding: Buffer;
      title: string;
      sku: string | null;
      category: string | null;
    };
    const rows: Row[] = await this.dataSource.query(
      `SELECT pm.product_id, pm.color, pm.url, pm.clip_embedding,
              p.title, p.sku, p.category
         FROM product_media pm
         JOIN products p ON p.id = pm.product_id
        WHERE p.tenant_id = $1 AND pm.clip_embedding IS NOT NULL`,
      [tenantId],
    );

    if (rows.length === 0) {
      this.logger.log('CLIP: no product_media rows with clip_embedding for tenant');
      return [];
    }

    const scored: VisionCandidate[] = [];
    for (const r of rows) {
      const emb = this.imageEmbeddingService.deserializeEmbedding(
        r.clip_embedding,
      );
      if (!emb) continue;
      const cosine = this.imageEmbeddingService.cosine(
        customerEmbedding,
        emb,
      );
      if (cosine < 0.6) continue;
      scored.push({
        productId: r.product_id,
        variantId: null,
        color: r.color,
        mediaUrl: r.url,
        title: r.title,
        sku: r.sku,
        category: r.category,
        cosine,
        source: 'clip',
      });
    }

    scored.sort((a, b) => (b.cosine ?? 0) - (a.cosine ?? 0));
    const top30 = scored.slice(0, 30);

    // Dedupe by productId — first row per product is the best by
    // cosine since the array is already sorted descending.
    const seen = new Map<string, VisionCandidate>();
    for (const c of top30) {
      if (!seen.has(c.productId)) seen.set(c.productId, c);
    }
    return Array.from(seen.values()).slice(0, 15);
  }

  /**
   * Fill in title / sku / category for any candidate that arrived
   * without them (linked-only rows). CLIP candidates already carry
   * these from the join in `findCatalogCandidatesByClip`.
   */
  private async hydrateCandidateMetadata(
    candidates: VisionCandidate[],
  ): Promise<void> {
    const missing = candidates.filter((c) => !c.title);
    if (missing.length === 0) return;
    const ids = [...new Set(missing.map((c) => c.productId))];
    const products = await this.productRepo
      .createQueryBuilder('p')
      .select(['p.id', 'p.title', 'p.sku', 'p.category'])
      .where('p.id IN (:...ids)', { ids })
      .getMany();
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const c of missing) {
      const p = byId.get(c.productId);
      if (!p) continue;
      c.title = p.title ?? '';
      c.sku = p.sku ?? null;
      c.category = p.category ?? null;
    }
  }

  // ─── pHash matching ────────────────────────────────────────────

  /**
   * Hash the customer photo and rank the tenant's `product_media`
   * rows by Hamming distance ascending. Returns null when the image
   * can't be hashed or the tenant has no hashed rows.
   *
   * The caller decides whether the closest row is good enough for a
   * direct resolve or whether the top-K should be handed off to the
   * vision narrowing step.
   */
  private async findCatalogCandidatesByPhash(
    tenantId: string,
    customerImageUrl: string,
  ): Promise<{
    customerHash: string;
    candidates: Array<{
      product_id: string;
      color: string | null;
      url: string;
      phash: string;
      distance: number;
    }>;
  } | null> {
    let buf: Buffer;
    try {
      const local = uploadPath(customerImageUrl);
      if (local) {
        buf = await readFile(local);
      } else {
        const res = await fetch(customerImageUrl);
        if (!res.ok) {
          this.logger.warn(`pHash: customer image fetch HTTP ${res.status}`);
          return null;
        }
        buf = Buffer.from(await res.arrayBuffer());
      }
    } catch (err: any) {
      this.logger.warn(`pHash: customer image fetch failed: ${err.message ?? err}`);
      return null;
    }
    const customerHash = await this.imageHashService.hashFromBuffer(buf);
    if (!customerHash) {
      this.logger.warn('pHash: customer image hashFromBuffer returned null');
      return null;
    }

    type Row = { product_id: string; color: string | null; url: string; phash: string };
    const rows: Row[] = await this.dataSource.query(
      `SELECT pm.product_id, pm.color, pm.url, pm.phash
         FROM product_media pm
         JOIN products p ON p.id = pm.product_id
        WHERE p.tenant_id = $1 AND pm.phash IS NOT NULL`,
      [tenantId],
    );
    if (rows.length === 0) {
      this.logger.log('pHash: no product_media rows with phash for tenant');
      return null;
    }

    const ranked = rows
      .map((r) => ({
        ...r,
        distance: this.imageHashService.hammingDistance(customerHash, r.phash),
      }))
      .sort((a, b) => a.distance - b.distance);

    this.logger.log(
      `pHash: customer=${customerHash} closest=${ranked[0].distance} second=${ranked[1]?.distance ?? 'none'} (threshold=${ImageHashService.MATCH_THRESHOLD}, candidates=${rows.length})`,
    );

    return { customerHash, candidates: ranked };
  }

  private async resolveVariantByColor(
    productId: string,
    color: string,
  ): Promise<string | null> {
    const variant = await this.variantRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('v.product_id = :pid', { pid: productId })
      .andWhere('LOWER(v.color) = LOWER(:c)', { c: color })
      .andWhere('v.active = true')
      .orderBy(
        'COALESCE(s.available_qty, 0) - COALESCE(s.reserved_qty, 0) - COALESCE(s.pending_checkout_qty, 0)',
        'DESC',
      )
      .getOne();
    return variant?.id ?? null;
  }

  // ─── SKU matching ──────────────────────────────────────────────

  private async getSkuPatterns(tenantId: string): Promise<RegExp[]> {
    const config = await this.storeConfigRepo.findOne({ where: { tenantId } });
    const custom = (config?.brandConfig as any)?.skuPatterns as string[] | undefined;
    const patterns = custom?.length ? custom : DEFAULT_SKU_PATTERNS;
    return patterns.map(p => new RegExp(p, 'i'));
  }

  private extractSkus(caption: string, patterns: RegExp[]): string[] {
    const skus: string[] = [];
    for (const pattern of patterns) {
      const match = caption.match(pattern);
      if (match?.[1]) {
        skus.push(match[1].trim());
      }
    }
    return skus;
  }

  /**
   * Link captioned content nobody has linked or unlinked yet (fetched, or
   * brought up by a customer) to the product whose SKU its caption names.
   * A manual link, or a link the owner removed, is left alone.
   */
  private async matchSkusInCaptions(tenantId: string): Promise<number> {
    // `IsNull()`, not `undefined`: TypeORM drops an undefined key from the
    // where, which loaded every row and re-linked manual links.
    const open = { tenantId, productId: IsNull(), caption: Not(IsNull()) };
    const withCaptions = await this.mappingRepo.find({
      where: [
        { ...open, matchMethod: IsNull() },
        { ...open, matchMethod: 'bulk_import' },
      ],
    });
    if (withCaptions.length === 0) return 0;

    const patterns = await this.getSkuPatterns(tenantId);

    // Load all product SKUs
    const products = await this.productRepo
      .createQueryBuilder('p')
      .select(['p.id', 'p.sku'])
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('p.sku IS NOT NULL')
      .getMany();

    // Load all variant SKUs
    const variants = await this.variantRepo
      .createQueryBuilder('v')
      .innerJoin('v.product', 'p')
      .select(['v.id', 'v.sku', 'v.productId', 'v.color'])
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('v.active = true')
      .andWhere('v.sku IS NOT NULL')
      .getMany();

    const skuMap = new Map<
      string,
      { variantId: string | null; productId: string; color: string | null }
    >();
    // Product-level SKUs first (no variant, no color)
    for (const p of products) {
      if (p.sku)
        skuMap.set(p.sku.toLowerCase(), {
          variantId: null,
          productId: p.id,
          color: null,
        });
    }
    // Variant-level SKUs (override product if same SKU) — propagate
    // the variant's color so applySkuMatch can populate linkedColor.
    for (const v of variants) {
      if (v.sku)
        skuMap.set(v.sku.toLowerCase(), {
          variantId: v.id,
          productId: v.productId,
          color: v.color ?? null,
        });
    }

    let matched = 0;
    for (const mapping of withCaptions) {
      // Strategy 1: Regex pattern extraction (e.g. "Артикул: DM-1019")
      const extracted = this.extractSkus(mapping.caption!, patterns);
      let found = false;
      for (const sku of extracted) {
        const match = skuMap.get(sku.toLowerCase());
        if (match) {
          if (await this.applySkuMatch(mapping, match, sku)) matched++;
          found = true;
          break;
        }
      }
      if (found) continue;

      // Strategy 2: Direct word match — every word in caption checked against all SKUs
      const words = mapping.caption!.split(/[\s,;|#@()[\]{}\n]+/).filter(w => w.length >= 2);
      for (const word of words) {
        const match = skuMap.get(word.toLowerCase());
        if (match) {
          if (await this.applySkuMatch(mapping, match, word)) matched++;
          break;
        }
      }
    }

    return matched;
  }

  /** Link one row by SKU. False when it got linked by someone else since it was read. */
  private async applySkuMatch(
    mapping: InstagramMediaMapping,
    match: { variantId: string | null; productId: string; color: string | null },
    sku: string,
  ): Promise<boolean> {
    const { affected } = await this.mappingRepo.update(
      { id: mapping.id, productId: IsNull() },
      {
        productId: match.productId,
        variantId: match.variantId,
        // A variant-level SKU carries its colour: a colour-level link. A
        // product-level SKU leaves linkedColor null.
        linkedColor: match.color,
        matchMethod: 'sku_from_caption',
        confirmed: true,
      },
    );
    if (!affected) return false;
    this.logger.log(
      `SKU match: "${sku}" → product ${match.productId}${match.variantId ? ` variant ${match.variantId}` : ''}${match.color ? ` color=${match.color}` : ''}`,
    );
    return true;
  }
}
