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
   */
  async getCategories(tenantId: string): Promise<string[]> {
    const rows = await this.variantRepo
      .createQueryBuilder('v')
      .innerJoin('v.product', 'p')
      .select('DISTINCT p.category', 'category')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('p.category IS NOT NULL')
      .getRawMany();
    return rows.map((r: any) => r.category).filter(Boolean);
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
      product: { id: string; title: string; imageUrl?: string | null };
      variants: Array<{
        id: string;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
        effectiveAvailable: number;
      }>;
    }>
  > {
    const searchTerms = this.extractSearchTerms(dto.query);
    if (searchTerms.length === 0) return [];

    const fullPhrase = searchTerms.join(' ');

    // Try all search strategies in priority order, stop at first match
    let variants: ProductVariant[] = [];

    // Priority 1: ILIKE on title (most precise)
    variants = await this.searchAllByTitle(tenantId, fullPhrase);
    if (!variants.length) {
      for (const t of searchTerms) {
        variants = await this.searchAllByTitle(tenantId, t);
        if (variants.length) break;
      }
    }

    // Priority 2: ILIKE on description
    if (!variants.length) {
      variants = await this.searchAllByDescription(tenantId, fullPhrase);
      if (!variants.length) {
        for (const t of searchTerms) {
          variants = await this.searchAllByDescription(tenantId, t);
          if (variants.length) break;
        }
      }
    }

    // Priority 3: ILIKE on category
    if (!variants.length) {
      variants = await this.searchAllByCategory(tenantId, fullPhrase);
      if (!variants.length) {
        for (const t of searchTerms) {
          variants = await this.searchAllByCategory(tenantId, t);
          if (variants.length) break;
        }
      }
    }

    // Priority 4: Trigram on category only (NOT title — title trigram is too noisy)
    // with a higher threshold (0.3)
    if (!variants.length) {
      for (const t of searchTerms) {
        if (t.length < 4) continue; // skip short words for trigram
        variants = await this.searchAllByCategoryTrigram(tenantId, t);
        if (variants.length) break;
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
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('p.title ILIKE :q', { q: `%${term}%` })
      .take(20)
      .getMany();
  }

  private async searchAllByCategory(tenantId: string, term: string): Promise<ProductVariant[]> {
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('p.category ILIKE :q', { q: `%${term}%` })
      .take(20)
      .getMany();
  }

  private async searchAllByCategoryTrigram(tenantId: string, term: string): Promise<ProductVariant[]> {
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .addSelect('similarity(p.category, :q)', 'sim')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('similarity(p.category, :q) > 0.3', { q: term })
      .orderBy('sim', 'DESC')
      .setParameter('q', term)
      .take(20)
      .getMany();
  }

  private async searchAllByDescription(tenantId: string, term: string): Promise<ProductVariant[]> {
    return this.variantRepo
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.product', 'p')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .andWhere('p.description ILIKE :q', { q: `%${term}%` })
      .take(20)
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
      product: { id: string; title: string; imageUrl?: string | null };
      variants: Array<{
        id: string;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
        effectiveAvailable: number;
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
    }>;
  }> {
    const productMap = new Map<string, {
      product: { id: string; title: string; imageUrl?: string | null };
      variants: Array<{
        id: string;
        size: string | null;
        color: string | null;
        price: number;
        currency: string;
        effectiveAvailable: number;
      }>;
    }>();

    for (const v of variants) {
      const pid = v.product.id;
      if (!productMap.has(pid)) {
        productMap.set(pid, {
          product: { id: pid, title: v.product.title, imageUrl: null },
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
      });
    }

    return Array.from(productMap.values());
  }

  /** Load the first image (by sort_order) for each product in the results */
  private async loadProductImages(
    results: Array<{ product: { id: string; imageUrl?: string | null } }>,
  ): Promise<void> {
    const productIds = results.map((r) => r.product.id);
    if (productIds.length === 0) return;

    // Single query: get the first image per product, ordered by sort_order
    const images = await this.dataSource.query(
      `SELECT DISTINCT ON (product_id) product_id, url
       FROM product_media
       WHERE product_id = ANY($1)
       ORDER BY product_id, sort_order ASC`,
      [productIds],
    ) as Array<{ product_id: string; url: string }>;

    const imageMap = new Map(images.map((i) => [i.product_id, i.url]));
    for (const r of results) {
      r.product.imageUrl = imageMap.get(r.product.id) ?? null;
    }
  }
}
