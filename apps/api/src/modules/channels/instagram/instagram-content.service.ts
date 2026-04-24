import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { InstagramMediaMapping } from './entities/instagram-media-mapping.entity';
import { Connection } from '../../integrations/entities/connection.entity';
import { Product } from '../../catalog/entities/product.entity';
import { ProductVariant } from '../../catalog/entities/product-variant.entity';
import { StoreConfig } from '../../engine/entities/store-config.entity';
import { CryptoService } from '../../../common/crypto.service';
import { ConnectionType, ConnectionStatus } from '@direct-mate/shared';

const DEFAULT_SKU_PATTERNS = [
  'SKU[:\\s]*(\\S+)',
  '#SKU(\\S+)',
  'Артикул[:\\s]*(\\S+)',
  'Код[:\\s]*(\\S+)',
  'арт\\.?[:\\s]*(\\S+)',
];

@Injectable()
export class InstagramContentService {
  private readonly logger = new Logger(InstagramContentService.name);
  private readonly openai: OpenAI;

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

  async saveUnlinkedMedia(
    tenantId: string,
    mediaId: string,
    mediaType: string,
  ): Promise<void> {
    await this.mappingRepo
      .createQueryBuilder()
      .insert()
      .into(InstagramMediaMapping)
      .values({
        tenantId,
        instagramMediaId: mediaId,
        mediaType,
      })
      .orIgnore()
      .execute();
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
    data: { productId?: string | null; variantId?: string | null; confirmed?: boolean },
  ): Promise<InstagramMediaMapping> {
    const mapping = await this.mappingRepo.findOne({ where: { id, tenantId } });
    if (!mapping) throw new NotFoundException('Mapping not found');

    if (data.productId !== undefined) mapping.productId = data.productId;
    if (data.variantId !== undefined) mapping.variantId = data.variantId;
    if (data.confirmed !== undefined) mapping.confirmed = data.confirmed;
    if (data.productId) mapping.matchMethod = 'manual';

    return this.mappingRepo.save(mapping);
  }

  async fetchContentForAllTenants(): Promise<{ tenants: number; totalFetched: number; totalMatched: number }> {
    const connections = await this.connectionRepo.find({
      where: { type: ConnectionType.Instagram, status: ConnectionStatus.Connected },
    });

    const tenantIds = [...new Set(connections.map(c => c.tenantId))];
    let totalFetched = 0;
    let totalMatched = 0;

    for (const tenantId of tenantIds) {
      try {
        const result = await this.fetchContent(tenantId);
        totalFetched += result.fetched;
        totalMatched += result.matched;
      } catch (err) {
        this.logger.error(`Content fetch failed for tenant ${tenantId}`, (err as Error).message);
      }
    }

    this.logger.log(`Content fetch complete: ${tenantIds.length} tenants, ${totalFetched} fetched, ${totalMatched} matched`);
    return { tenants: tenantIds.length, totalFetched, totalMatched };
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
      const info = await this.fetchMediaInfo(tenantId, data.instagramMediaId);
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

  private async fetchMediaInfo(tenantId: string, mediaId: string): Promise<{
    caption?: string; mediaUrl?: string; permalink?: string; mediaType?: string;
  } | null> {
    try {
      const connection = await this.connectionRepo.findOne({
        where: { tenantId, type: ConnectionType.Instagram, status: ConnectionStatus.Connected },
      });
      if (!connection?.accessTokenEncrypted) return null;

      const token = this.crypto.decrypt(connection.accessTokenEncrypted);
      const res = await fetch(
        `https://graph.instagram.com/v21.0/${mediaId}?fields=id,caption,media_type,media_url,permalink,timestamp`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        this.logger.warn(`Failed to fetch media info for ${mediaId}: ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      return {
        caption: data.caption,
        mediaUrl: data.media_url,
        permalink: data.permalink,
        mediaType: (data.media_type ?? '').toLowerCase(),
      };
    } catch (err) {
      this.logger.warn(`Error fetching media info: ${(err as Error).message}`);
      return null;
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

  async fetchContent(tenantId: string): Promise<{ fetched: number; matched: number }> {
    const connection = await this.connectionRepo.findOne({
      where: { tenantId, type: ConnectionType.Instagram, status: ConnectionStatus.Connected },
    });
    if (!connection || !connection.accessTokenEncrypted) {
      throw new BadRequestException('No active Instagram connection');
    }

    const token = this.crypto.decrypt(connection.accessTokenEncrypted);
    let fetched = 0;

    // Check if this is first sync (no existing mappings) → full pagination
    const existingCount = await this.mappingRepo.count({ where: { tenantId } });
    const fullSync = existingCount === 0;

    // 1. Fetch posts (full pagination only on first sync)
    fetched += await this.fetchPosts(tenantId, token, fullSync);

    // 2. Fetch active stories (24h window)
    const storiesResult = await this.fetchStories(tenantId, token);
    fetched += storiesResult.count;

    // 3. SKU matching pass
    const matched = await this.matchSkusInCaptions(tenantId);

    // 4. Inherit product links for stories reshared from mapped posts
    await this.inheritProductsFromSourcePosts(tenantId);

    // 5. AI vision matching for new unlinked stories only
    if (storiesResult.newIds.length > 0) {
      await this.matchStoriesByVision(tenantId, storiesResult.newIds);
    }

    return { fetched, matched };
  }

  // Returns true if this was a new insert (not an update of existing)
  private async upsertMedia(
    tenantId: string,
    item: any,
    mediaType: string,
    sourcePostUrl?: string | null,
  ): Promise<boolean> {
    const existing = await this.mappingRepo.findOne({
      where: { tenantId, instagramMediaId: item.id },
      select: ['id'],
    });

    await this.mappingRepo
      .createQueryBuilder()
      .insert()
      .values({
        tenantId,
        instagramMediaId: item.id,
        mediaType,
        caption: item.caption ?? null,
        mediaUrl: item.media_url ?? null,
        permalink: item.permalink ?? null,
        sourcePostUrl: sourcePostUrl ?? null,
        matchMethod: 'bulk_import',
      })
      .orUpdate(
        ['caption', 'media_url', 'permalink', 'source_post_url'],
        ['tenant_id', 'instagram_media_id'],
      )
      .execute();

    return !existing;
  }

  private async fetchPosts(tenantId: string, token: string, fullSync = false): Promise<number> {
    let fetched = 0;
    let cursor: string | undefined;
    const maxItems = fullSync ? 200 : 50; // First sync: up to 200, regular: first page only

    do {
      const url = `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,permalink,timestamp,media_url&limit=50${cursor ? `&after=${cursor}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        this.logger.error(`Instagram posts API error: ${res.status}`);
        break;
      }

      const body = (await res.json()) as {
        data: any[];
        paging?: { cursors?: { after?: string }; next?: string };
      };

      for (const item of body.data ?? []) {
        await this.upsertMedia(tenantId, item, (item.media_type ?? 'IMAGE').toLowerCase());
        fetched++;
      }

      cursor = fullSync && body.paging?.next ? body.paging?.cursors?.after : undefined;
    } while (cursor && fetched < maxItems);

    this.logger.log(`Fetched ${fetched} posts for tenant ${tenantId}`);
    return fetched;
  }

  private async fetchStories(tenantId: string, token: string): Promise<{ count: number; newIds: string[] }> {
    let fetched = 0;
    const newIds: string[] = [];

    try {
      const url = `https://graph.instagram.com/v21.0/me/stories?fields=id,caption,media_type,media_url,permalink,timestamp`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        this.logger.warn(`Instagram stories API error: ${res.status} — stories may not be available`);
        return { count: 0, newIds: [] };
      }

      const body = (await res.json()) as { data: any[] };

      for (const item of body.data ?? []) {
        const isNew = await this.upsertMedia(tenantId, item, 'story', null);
        if (isNew) newIds.push(item.id);

        // Set expiry for stories (24h from fetch)
        await this.mappingRepo
          .createQueryBuilder()
          .update()
          .set({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } as any)
          .where('tenant_id = :tenantId AND instagram_media_id = :mediaId AND expires_at IS NULL', {
            tenantId,
            mediaId: item.id,
          })
          .execute();
        fetched++;
      }

      this.logger.log(`Fetched ${fetched} stories for tenant ${tenantId} (${newIds.length} new)`);
    } catch (err) {
      this.logger.warn('Failed to fetch stories', (err as Error).message);
    }

    return { count: fetched, newIds };
  }

  // ─── Story → post product inheritance ─────────────────────────

  private async inheritProductsFromSourcePosts(tenantId: string): Promise<number> {
    // Find unlinked stories that have a source_post_url (reshared from a post)
    const stories = await this.mappingRepo.find({
      where: { tenantId, mediaType: 'story', productId: undefined as any },
    });

    this.logger.log(`inheritProductsFromSourcePosts: ${stories.length} unlinked stories total, ${stories.filter(s => s.sourcePostUrl).length} have sourcePostUrl`);
    stories.forEach(s => this.logger.log(`  story ${s.instagramMediaId}: sourcePostUrl=${s.sourcePostUrl ?? 'null'}`));

    const candidates = stories.filter((s) => s.sourcePostUrl);
    if (candidates.length === 0) return 0;

    let inherited = 0;

    for (const story of candidates) {
      // Extract shortcode from URL: https://www.instagram.com/p/{shortcode}/
      const match = story.sourcePostUrl!.match(/\/p\/([A-Za-z0-9_-]+)/);
      if (!match) continue;

      const shortcode = match[1];

      const sourcePost = await this.mappingRepo
        .createQueryBuilder('m')
        .where('m.tenant_id = :tenantId', { tenantId })
        .andWhere('m.permalink LIKE :pattern', { pattern: `%/p/${shortcode}/%` })
        .andWhere('m.product_id IS NOT NULL')
        .getOne();

      if (!sourcePost) continue;

      await this.mappingRepo.update(story.id, {
        productId: sourcePost.productId,
        variantId: sourcePost.variantId,
        matchMethod: 'story_from_post',
        matchConfidence: 1.0,
      });

      this.logger.log(
        `Story ${story.instagramMediaId} inherited product ${sourcePost.productId} from post ${shortcode}`,
      );
      inherited++;
    }

    return inherited;
  }

  // ─── AI vision matching ────────────────────────────────────────

  private async toBase64DataUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      const mime = res.headers.get('content-type') ?? 'image/jpeg';
      return `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
    } catch {
      return null;
    }
  }

  private async matchStoriesByVision(tenantId: string, newIds: string[]): Promise<void> {
    const unlinkedStories = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.media_type = :type', { type: 'story' })
      .andWhere('m.product_id IS NULL')
      .andWhere('m.instagram_media_id IN (:...newIds)', { newIds })
      .getMany();

    const candidates = unlinkedStories.filter((s) => s.mediaUrl).slice(0, 5);
    if (candidates.length === 0) return;

    const linkedPosts = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.product_id IS NOT NULL')
      .andWhere('m.media_url IS NOT NULL')
      .limit(10)
      .getMany();

    if (linkedPosts.length === 0) return;

    for (const story of candidates) {
      try {
        const storyDataUrl = await this.toBase64DataUrl(story.mediaUrl!);
        if (!storyDataUrl) {
          this.logger.warn(`Vision match: could not download story image ${story.instagramMediaId}`);
          continue;
        }

        const postDataUrls = await Promise.all(linkedPosts.map((p) => this.toBase64DataUrl(p.mediaUrl!)));
        const validPosts = linkedPosts.filter((_, i) => postDataUrls[i] !== null);
        const validDataUrls = postDataUrls.filter((u): u is string => u !== null);

        if (validPosts.length === 0) continue;

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
          await this.mappingRepo.update(story.id, {
            productId: sourcePost.productId,
            variantId: sourcePost.variantId,
            matchMethod: 'ai_vision_match',
            matchConfidence: result.confidence,
          });
          this.logger.log(
            `Story ${story.instagramMediaId} matched to post ${sourcePost.instagramMediaId} via vision (confidence: ${result.confidence})`,
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
  ): Promise<{ productId: string; variantId: string | null; confidence: number } | null> {
    // Load linked media with images
    const linkedMedia = await this.mappingRepo
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.product_id IS NOT NULL')
      .andWhere('m.media_url IS NOT NULL')
      .orderBy('m.created_at', 'DESC')
      .limit(10)
      .getMany();

    if (linkedMedia.length === 0) return null;

    // Short-circuit: if the customer URL is exactly one of the linked media_urls,
    // we already know the match. Skips a vision call entirely. Useful when a
    // screenshot mapping was ingested verbatim, and for deterministic simulator runs.
    const exact = linkedMedia.find((m) => m.mediaUrl === customerImageUrl);
    if (exact) {
      this.logger.log(
        `Customer photo: exact URL match to media ${exact.instagramMediaId} → product ${exact.productId}`,
      );
      return {
        productId: exact.productId!,
        variantId: exact.variantId,
        confidence: 1.0,
      };
    }

    // Download customer image
    const customerDataUrl = await this.toBase64DataUrl(customerImageUrl);
    if (!customerDataUrl) {
      this.logger.warn('matchCustomerPhoto: could not download customer image');
      return null;
    }

    // Download candidate product images
    const candidateDataUrls = await Promise.all(
      linkedMedia.map((m) => this.toBase64DataUrl(m.mediaUrl!)),
    );
    const validMedia = linkedMedia.filter((_, i) => candidateDataUrls[i] !== null);
    const validUrls = candidateDataUrls.filter((u): u is string => u !== null);

    if (validMedia.length === 0) return null;

    try {
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
          text: `The first image is a screenshot sent by a customer. The next ${validMedia.length} images are product posts from the store (index 0 to ${validMedia.length - 1}). Does the customer's screenshot show the same product as any of the posts? Reply with JSON only: {"match": <index or -1 if no match>, "confidence": <0.0 to 1.0>}`,
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
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]) as { match: number; confidence: number };

      if (result.match >= 0 && result.match < validMedia.length && result.confidence >= 0.7) {
        const matched = validMedia[result.match];
        this.logger.log(
          `Customer photo matched to media ${matched.instagramMediaId} → product ${matched.productId} (confidence: ${result.confidence})`,
        );
        return {
          productId: matched.productId!,
          variantId: matched.variantId,
          confidence: result.confidence,
        };
      }

      this.logger.log(`Customer photo: no match (best: match=${result.match}, confidence=${result.confidence})`);
      return null;
    } catch (err) {
      this.logger.error(`matchCustomerPhoto vision call failed: ${err}`);
      return null;
    }
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

  private async matchSkusInCaptions(tenantId: string): Promise<number> {
    // Get unlinked mappings with captions
    const unlinked = await this.mappingRepo.find({
      where: { tenantId, productId: undefined as any },
    });

    const withCaptions = unlinked.filter(m => m.caption);
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
      .select(['v.id', 'v.sku', 'v.productId'])
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('v.active = true')
      .andWhere('v.sku IS NOT NULL')
      .getMany();

    const skuMap = new Map<string, { variantId: string | null; productId: string }>();
    // Product-level SKUs first (no variant)
    for (const p of products) {
      if (p.sku) skuMap.set(p.sku.toLowerCase(), { variantId: null, productId: p.id });
    }
    // Variant-level SKUs (override product if same SKU)
    for (const v of variants) {
      if (v.sku) skuMap.set(v.sku.toLowerCase(), { variantId: v.id, productId: v.productId });
    }

    let matched = 0;
    for (const mapping of withCaptions) {
      // Strategy 1: Regex pattern extraction (e.g. "Артикул: DM-1019")
      const extracted = this.extractSkus(mapping.caption!, patterns);
      let found = false;
      for (const sku of extracted) {
        const match = skuMap.get(sku.toLowerCase());
        if (match) {
          this.applySkuMatch(mapping, match, sku);
          matched++;
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
          this.applySkuMatch(mapping, match, word);
          matched++;
          break;
        }
      }
    }

    return matched;
  }

  private async applySkuMatch(
    mapping: InstagramMediaMapping,
    match: { variantId: string | null; productId: string },
    sku: string,
  ): Promise<void> {
    mapping.productId = match.productId;
    mapping.variantId = match.variantId;
    mapping.matchMethod = 'sku_from_caption';
    mapping.confirmed = true;
    await this.mappingRepo.save(mapping);
    this.logger.log(`SKU match: "${sku}" → product ${match.productId}${match.variantId ? ` variant ${match.variantId}` : ''}`);
  }
}
