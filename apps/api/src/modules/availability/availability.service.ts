import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { StockBalance } from '../catalog/entities/stock-balance.entity';
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

  async check(tenantId: string, dto: CheckAvailabilityDto): Promise<AvailabilityResult> {
    const searchTerms = this.extractSearchTerms(dto.query);

    if (searchTerms.length === 0) {
      return { matchType: 'none', product: null, variant: null, stock: null };
    }

    // Try exact phrase match first, then individual word matches
    const searches = [
      searchTerms.join(' '),  // full phrase
      ...searchTerms,         // individual words
    ];

    let variant: ProductVariant | null = null;

    for (const term of searches) {
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

      variant = await qb.getOne();
      if (variant) break;
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
}
