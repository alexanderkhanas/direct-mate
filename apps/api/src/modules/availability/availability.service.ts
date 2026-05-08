import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { StockBalance } from '../catalog/entities/stock-balance.entity';
import { ProductMedia } from '../catalog/entities/product-media.entity';
import { CheckAvailabilityDto } from './dto/check-availability.dto';

const FRESHNESS_MINUTES = 10;

export interface AvailabilityResult {
  matchType: 'exact' | 'partial' | 'none';
  product: { id: string; title: string } | null;
  variant: {
    id: string;
    sku: string | null;
    size: string | null;
    color: string | null;
    price: number;
    currency: string;
  } | null;
  stock: {
    availableQty: number;
    reservedQty: number;
    pendingCheckoutQty: number;
    effectiveAvailable: number;
    lastSyncedAt: Date | null;
    isFresh: boolean;
  } | null;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(ProductVariant)
    private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(StockBalance)
    private readonly stockRepo: Repository<StockBalance>,
    @InjectRepository(ProductMedia)
    private readonly mediaRepo: Repository<ProductMedia>,
    private readonly dataSource: DataSource,
  ) {}

  private extractSearchTerms(text: string): string[] {
    // Remove common stop words and short words, keep potential product names
    const stopWords = new Set([
      'хочу', 'мені', 'потрібно', 'потрібна', 'можна', 'є', 'чи', 'що', 'як',
      'будь', 'ласка', 'дайте', 'покажіть', 'скільки', 'коштує', 'ціна',
      'want', 'need', 'have', 'the', 'can', 'get', 'show', 'how', 'much',
      'порадьте', 'порекомендуйте', 'підкажіть', 'замовити', 'купити',
    ]);
    return text
      .toLowerCase()
      .replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Get distinct product categories for a tenant (used as AI context).
   *
   * Sources from BOTH the new `categories` M2M table (populated by
   * Torgsoft import) AND the legacy denormalized `products.category`
   * column (used by demo seed builders), deduped.
   *
   * TODO: Remove UNION fallback once demo seed builders populate
   * the categories M2M table.
   */
  async getCategories(tenantId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT name FROM (
         SELECT name FROM categories WHERE tenant_id = $1
         UNION
         SELECT category AS name FROM products
          WHERE tenant_id = $1
            AND category IS NOT NULL
            AND status = 'active'
       ) c
       ORDER BY name`,
      [tenantId],
    );
    return rows.map((r: { name: string }) => r.name).filter(Boolean);
  }

  async check(tenantId: string, dto: CheckAvailabilityDto): Promise<AvailabilityResult> {
    const searchTerms = this.extractSearchTerms(dto.query);

    if (searchTerms.length === 0) {
      return { matchType: 'none', product: null, variant: null, stock: null };
    }

    const fullPhrase = searchTerms.join(' ');

    // Strategy 1: ILIKE on title (exact phrase, then individual words)
    let variant = await this.searchByTitle(tenantId, fullPhrase, dto);
    if (!variant) {
      for (const term of searchTerms) {
        variant = await this.searchByTitle(tenantId, term, dto);
        if (variant) break;
      }
    }

    // Strategy 2: ILIKE on category
    if (!variant) {
      variant = await this.searchByCategory(tenantId, fullPhrase, dto);
      if (!variant) {
        for (const term of searchTerms) {
          variant = await this.searchByCategory(tenantId, term, dto);
          if (variant) break;
        }
      }
    }

    // Strategy 3: Trigram fuzzy search on title (catches олійка→олія, тоналка→тональна)
    if (!variant) {
      variant = await this.searchByTrigram(tenantId, fullPhrase, dto);
    }

    // Strategy 4: Trigram on category
    if (!variant) {
      variant = await this.searchByTrigram(tenantId, fullPhrase, dto);
    }

    if (!variant) {
      return { matchType: 'none', product: null, variant: null, stock: null };
    }

    const stock = variant.stockBalance;
    const effectiveAvailable = stock
      ? stock.availableQty - stock.reservedQty - stock.pendingCheckoutQty
      : 0;

    const isFresh = stock?.lastSyncedAt
      ? Date.now() - stock.lastSyncedAt.getTime() < FRESHNESS_MINUTES * 60 * 1000
      : false;

    const matchType = dto.size && dto.color ? 'exact' : 'partial';

    return {
      matchType,
      product: { id: variant.product.id, title: variant.product.title },
      variant: {
        id: variant.id,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        price: Number(variant.price),
        currency: variant.currency,
      },
      stock: {
        availableQty: stock?.availableQty ?? 0,
        reservedQty: stock?.reservedQty ?? 0,
        pendingCheckoutQty: stock?.pendingCheckoutQty ?? 0,
        effectiveAvailable,
        lastSyncedAt: stock?.lastSyncedAt ?? null,
        isFresh,
      },
    };
  }

  private async searchByTitle(
    tenantId: string,
    term: string,
    dto: CheckAvailabilityDto,
  ): Promise<ProductVariant | null> {
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('p.title ILIKE :q', { q: `%${term}%` });
    if (dto.size) qb.andWhere('v.size ILIKE :size', { size: dto.size });
    if (dto.color) qb.andWhere('v.color ILIKE :color', { color: dto.color });
    return qb.getOne();
  }

  private async searchByCategory(
    tenantId: string,
    term: string,
    dto: CheckAvailabilityDto,
  ): Promise<ProductVariant | null> {
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('p.category ILIKE :q', { q: `%${term}%` });
    if (dto.size) qb.andWhere('v.size ILIKE :size', { size: dto.size });
    if (dto.color) qb.andWhere('v.color ILIKE :color', { color: dto.color });
    return qb.getOne();
  }

  private async searchByTrigram(
    tenantId: string,
    term: string,
    dto: CheckAvailabilityDto,
  ): Promise<ProductVariant | null> {
    if (term.length < 4) return null;
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .addSelect('similarity(p.category, :q)', 'sim')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('similarity(p.category, :q) > 0.3', { q: term })
      .orderBy('sim', 'DESC')
      .setParameter('q', term);
    if (dto.size) qb.andWhere('v.size ILIKE :size', { size: dto.size });
    if (dto.color) qb.andWhere('v.color ILIKE :color', { color: dto.color });
    return qb.getOne();
  }

  /**
   * Search for all matching products with all their variants.
   */
  async checkAll(
    tenantId: string,
    dto: CheckAvailabilityDto,
  ): Promise<
    Array<{
      product: { id: string; title: string; imageUrl?: string | null; category?: string | null };
      variants: Array<{
        id: string;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
        effectiveAvailable: number;
        imageUrl: string | null;
      }>;
    }>
  > {
    const searchTerms = this.extractSearchTerms(dto.query);
    const fullPhrase = searchTerms.join(' ');

    let variants: ProductVariant[] = [];

    // Priority 0: classifier-extracted category routes through the
    // M2M (categories + product_categories) for an exact match. When
    // both `category` and keywords are present, narrow the M2M result
    // set in-memory by case-insensitive title `includes` on each
    // keyword. When category is the only signal (no keywords), return
    // the M2M results directly.
    if (dto.category) {
      variants = await this.searchAllByCategoryName(tenantId, dto.category);
      if (variants.length && searchTerms.length > 0) {
        const lowerTerms = searchTerms.map((t) => t.toLowerCase());
        const narrowed = variants.filter((v) => {
          const title = (v.product?.title ?? '').toLowerCase();
          return lowerTerms.some((t) => title.includes(t));
        });
        if (narrowed.length > 0) variants = narrowed;
      }
    }

    // Without category and without keywords there's nothing to search.
    if (!variants.length && searchTerms.length === 0) return [];

    // Priority 1: ILIKE on title (most precise) — only when M2M didn't fire.
    if (!variants.length) {
      variants = await this.searchAllByTitle(tenantId, fullPhrase);
      if (!variants.length) {
        for (const t of searchTerms) {
          variants = await this.searchAllByTitle(tenantId, t);
          if (variants.length) break;
        }
      }
    }

    // Priority 2: ILIKE on description.
    if (!variants.length) {
      variants = await this.searchAllByDescription(tenantId, fullPhrase);
      if (!variants.length) {
        for (const t of searchTerms) {
          variants = await this.searchAllByDescription(tenantId, t);
          if (variants.length) break;
        }
      }
    }

    if (variants.length === 0) return [];

    // Group by product
    const results = this.groupVariantsByProduct(variants);

    // Load first image for each product
    await this.loadProductImages(results);

    return results.slice(0, 5);
  }

  private async searchAllByTitle(tenantId: string, term: string): Promise<ProductVariant[]> {
    // Two-step: first cap the PRODUCT set (so each surfaced product
    // carries its full variant matrix), then load all active variants
    // for those products. The naive `.take(N)` on the variant query
    // truncates mid-matrix and the engine then renders incomplete
    // size/color info (e.g., a 5-size product appears with one size).
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('v.active = true')
      .andWhere(
        `v.product_id IN (
           SELECT pp.id FROM products pp
            WHERE pp.tenant_id = :tenantId
              AND pp.status = 'active'
              AND pp.title ILIKE :q
            ORDER BY pp.last_synced_at DESC NULLS LAST
            LIMIT 10
         )`,
        { tenantId, q: `%${term}%` },
      )
      .getMany();
  }

  /**
   * Match products by exact (case-insensitive) category name through
   * the `categories` + `product_categories` M2M, with a fallback to
   * the legacy denormalized `products.category` column for tenants
   * that don't populate the M2M (demo seed builders).
   *
   * Replaces the prior `searchAllByCategory` / `searchAllByCategoryTrigram`
   * pair, both of which substring-matched on `products.category` and
   * produced false positives like "Верхній одяг" matching
   * "комплект домашнього одягу" because "одяг" is a substring of
   * "одягу".
   */
  private async searchAllByCategoryName(
    tenantId: string,
    categoryName: string,
  ): Promise<ProductVariant[]> {
    // Two-step: cap PRODUCTS, then load full variant matrix. See note
    // on searchAllByTitle.
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('v.active = true')
      .andWhere(
        `v.product_id IN (
           SELECT pp.id FROM products pp
            WHERE pp.tenant_id = :tenantId
              AND pp.status = 'active'
              AND (
                EXISTS (
                  SELECT 1 FROM product_categories pc
                   INNER JOIN categories c ON c.id = pc.category_id
                   WHERE pc.product_id = pp.id AND lower(c.name) = lower(:cat)
                ) OR lower(pp.category) = lower(:cat)
              )
            ORDER BY pp.last_synced_at DESC NULLS LAST
            LIMIT 10
         )`,
        { tenantId, cat: categoryName },
      )
      .getMany();
  }

  private async searchAllByDescription(tenantId: string, term: string): Promise<ProductVariant[]> {
    // Two-step: cap PRODUCTS, then load full variant matrix. See note
    // on searchAllByTitle.
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('v.active = true')
      .andWhere(
        `v.product_id IN (
           SELECT pp.id FROM products pp
            WHERE pp.tenant_id = :tenantId
              AND pp.status = 'active'
              AND pp.description ILIKE :q
            ORDER BY pp.last_synced_at DESC NULLS LAST
            LIMIT 10
         )`,
        { tenantId, q: `%${term}%` },
      )
      .getMany();
  }

  /**
   * Find all variants for a product by ID, returning the same ProductSearchResult[]
   * format used by checkAll(). Used for media-linked product resolution.
   */
  async findAllByProductId(
    productId: string,
    variantId?: string,
  ): Promise<
    Array<{
      product: { id: string; title: string; imageUrl?: string | null; category?: string | null };
      variants: Array<{
        id: string;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
        effectiveAvailable: number;
        imageUrl: string | null;
      }>;
    }>
  > {
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.id = :productId', { productId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true');

    if (variantId) {
      qb.andWhere('v.id = :variantId', { variantId });
    }

    const variants = await qb.take(20).getMany();
    if (variants.length === 0) return [];

    const results = this.groupVariantsByProduct(variants);
    await this.loadProductImages(results);
    return results;
  }

  async getByProductId(
    productId: string,
    variantId?: string,
  ): Promise<{
    title: string;
    variant: { size: string | null; color: string | null; price: number; currency: string } | null;
    stock: number;
  } | null> {
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.id = :productId', { productId });

    if (variantId) {
      qb.andWhere('v.id = :variantId', { variantId });
    }

    const variant = await qb.getOne();
    if (!variant) return null;

    const stock = variant.stockBalance;
    const effectiveAvailable = stock
      ? stock.availableQty - stock.reservedQty - stock.pendingCheckoutQty
      : 0;

    return {
      title: variant.product.title,
      variant: {
        size: variant.size,
        color: variant.color,
        price: Number(variant.price),
        currency: variant.currency,
      },
      stock: effectiveAvailable,
    };
  }

  // ─── Shared helpers ────────────────────────────────────────────

  private groupVariantsByProduct(variants: ProductVariant[]): Array<{
    product: { id: string; title: string; imageUrl?: string | null };
    variants: Array<{
      id: string;
      size: string | null;
      color: string | null;
      price: number;
      currency: string;
      effectiveAvailable: number;
      imageUrl: string | null;
    }>;
  }> {
    const productMap = new Map<string, {
      product: { id: string; title: string; imageUrl?: string | null; category?: string | null };
      variants: Array<{
        id: string;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
        effectiveAvailable: number;
        imageUrl: string | null;
      }>;
    }>();

    for (const v of variants) {
      const pid = v.product.id;
      if (!productMap.has(pid)) {
        productMap.set(pid, {
          product: { id: pid, title: v.product.title, imageUrl: null, category: v.product.category ?? null },
          variants: [],
        });
      }
      const stock = v.stockBalance;
      const effectiveAvailable = stock
        ? stock.availableQty - stock.reservedQty - stock.pendingCheckoutQty
        : 0;
      productMap.get(pid)!.variants.push({
        id: v.id,
        size: v.size,
        color: v.color,
        price: Number(v.price),
        currency: v.currency,
        effectiveAvailable,
        imageUrl: v.imageUrl ?? null,
      });
    }

    return Array.from(productMap.values());
  }

  /**
   * Load the first image (by sort_order) for each product, AND apply
   * color-keyed variant images.
   *
   * Per-variant images for the demo seed live in `product_media` rows tagged
   * `(product_id, color)` — the dedicated `product_variants.image_url` column
   * is unused in the seed path. This method mirrors the resolution chain in
   * `catalog.service.ts:107-141` so the reply engine receives the same
   * per-variant URLs that the admin catalog listing does.
   */
  private async loadProductImages(
    results: Array<{
      product: { id: string; imageUrl?: string | null };
      variants: Array<{ color: string | null; imageUrl: string | null }>;
    }>,
  ): Promise<void> {
    const productIds = results.map((r) => r.product.id);
    if (productIds.length === 0) return;

    const [productImages, variantImages] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT ON (product_id) product_id, url
         FROM product_media
         WHERE product_id = ANY($1)
         ORDER BY product_id, sort_order ASC`,
        [productIds],
      ) as Promise<Array<{ product_id: string; url: string }>>,
      this.dataSource.query(
        `SELECT product_id, color, url, sort_order
         FROM product_media
         WHERE product_id = ANY($1) AND color IS NOT NULL
         ORDER BY product_id, sort_order ASC`,
        [productIds],
      ) as Promise<Array<{ product_id: string; color: string; url: string }>>,
    ]);

    const productImageMap = new Map(productImages.map((i) => [i.product_id, i.url]));

    // Per-product map: colorLowercase → first matching url (sort_order ASC).
    const colorImageMap = new Map<string, Map<string, string>>();
    for (const row of variantImages) {
      if (!colorImageMap.has(row.product_id)) {
        colorImageMap.set(row.product_id, new Map());
      }
      const m = colorImageMap.get(row.product_id)!;
      const key = row.color.toLowerCase();
      if (!m.has(key)) m.set(key, row.url);
    }

    for (const r of results) {
      r.product.imageUrl = productImageMap.get(r.product.id) ?? null;
      const productColorMap = colorImageMap.get(r.product.id);
      // 3-tier fallback per variant, mirroring catalog.service.ts:134 exactly:
      //   variant.imageUrl ?? colorImageMap[v.color] ?? product.imageUrl ?? null
      // The product-level fallback ensures multi-color products with partial
      // color-tagged seed coverage still emit one distinct image per variant
      // (e.g., Zara midi: Brown has color tag, White shares product image).
      for (const v of r.variants) {
        if (v.imageUrl) continue;
        const colorMatch = v.color ? productColorMap?.get(v.color.toLowerCase()) : undefined;
        v.imageUrl = colorMatch ?? r.product.imageUrl ?? null;
      }
    }
  }
}
