import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { StockBalance } from './entities/stock-balance.entity';
import { SearchProductsDto } from './dto/search-products.dto';
import { ProductStatus } from '@direct-mate/shared';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(StockBalance)
    private readonly stockRepo: Repository<StockBalance>,
  ) {}

  async searchProducts(tenantId: string, dto: SearchProductsDto) {
    const qb = this.variantRepo
      .createQueryBuilder('v')
      .innerJoin('v.product', 'p')
      .leftJoin('v.stockBalance', 's')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .andWhere('v.active = true')
      .select([
        'p.id AS "productId"',
        'v.id AS "variantId"',
        'p.title AS "title"',
        'v.size AS "size"',
        'v.color AS "color"',
        'v.price AS "price"',
        'v.currency AS "currency"',
        'COALESCE(s.available_qty, 0) - COALESCE(s.reserved_qty, 0) - COALESCE(s.pending_checkout_qty, 0) AS "effectiveAvailable"',
      ]);

    if (dto.q) {
      qb.andWhere('p.title ILIKE :q', { q: `%${dto.q}%` });
    }
    if (dto.size) {
      qb.andWhere('v.size ILIKE :size', { size: dto.size });
    }
    if (dto.color) {
      qb.andWhere('v.color ILIKE :color', { color: dto.color });
    }

    qb.limit(dto.limit ?? 20);

    return qb.getRawMany();
  }

  async upsertProduct(
    tenantId: string,
    data: Partial<Product> & { externalProductId: string },
  ): Promise<Product> {
    const existing = await this.productRepo.findOne({
      where: { tenantId, externalProductId: data.externalProductId },
    });
    if (existing) {
      await this.productRepo.update(existing.id, { ...data, tenantId } as any);
      return this.productRepo.findOneOrFail({ where: { id: existing.id } });
    }
    const product = this.productRepo.create({ ...data, tenantId });
    return this.productRepo.save(product);
  }

  async upsertVariant(
    productId: string,
    data: Partial<ProductVariant> & { externalVariantId: string },
  ): Promise<ProductVariant> {
    const existing = await this.variantRepo.findOne({
      where: { productId, externalVariantId: data.externalVariantId },
    });
    if (existing) {
      await this.variantRepo.update(existing.id, { ...data, productId } as any);
      return this.variantRepo.findOneOrFail({ where: { id: existing.id } });
    }
    const variant = this.variantRepo.create({ ...data, productId });
    return this.variantRepo.save(variant);
  }

  async listProducts(tenantId: string, q?: string) {
    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.variants', 'v', 'v.active = true')
      .leftJoinAndSelect('v.stockBalance', 's')
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .orderBy('p.title', 'ASC');

    if (q) {
      qb.andWhere('p.title ILIKE :q', { q: `%${q}%` });
    }

    const products = await qb.getMany();

    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      title: p.title,
      category: p.category,
      variantCount: p.variants?.length ?? 0,
      updatedAt: p.updatedAt,
      variants: (p.variants ?? []).map((v) => ({
        id: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        price: v.price,
        currency: v.currency,
        effectiveAvailable:
          (v.stockBalance?.availableQty ?? 0) -
          (v.stockBalance?.reservedQty ?? 0) -
          (v.stockBalance?.pendingCheckoutQty ?? 0),
        lastSyncedAt: v.stockBalance?.lastSyncedAt ?? null,
      })),
    }));
  }

  async upsertStockBalance(
    variantId: string,
    availableQty: number,
  ): Promise<StockBalance> {
    const existing = await this.stockRepo.findOne({ where: { variantId } });
    if (existing) {
      await this.stockRepo.update(existing.id, {
        availableQty,
        lastSyncedAt: new Date(),
      });
      return this.stockRepo.findOneOrFail({ where: { id: existing.id } });
    }
    const stock = this.stockRepo.create({
      variantId,
      availableQty,
      lastSyncedAt: new Date(),
    });
    return this.stockRepo.save(stock);
  }

  /**
   * Bulk import products with variants and stock from a connector (n8n).
   * Idempotent: upserts by externalProductId / externalVariantId.
   */
  async importCatalog(
    tenantId: string,
    products: Array<{
      externalProductId: string;
      title: string;
      description?: string;
      category?: string;
      brand?: string;
      status?: string;
      variants: Array<{
        externalVariantId: string;
        sku?: string;
        size?: string;
        color?: string;
        price: number;
        currency?: string;
        inventoryQty?: number;
      }>;
    }>,
  ): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const p of products) {
      try {
        const product = await this.upsertProduct(tenantId, {
          externalProductId: p.externalProductId,
          title: p.title,
          description: p.description ?? null,
          category: p.category ?? null,
          brand: p.brand ?? null,
          status: (p.status as ProductStatus) ?? ProductStatus.Active,
        });

        const isNew =
          product.createdAt.getTime() === product.updatedAt.getTime() ||
          product.updatedAt.getTime() - product.createdAt.getTime() < 100;

        if (isNew) created++;
        else updated++;

        for (const v of p.variants) {
          try {
            const variant = await this.upsertVariant(product.id, {
              externalVariantId: v.externalVariantId,
              sku: v.sku ?? null,
              size: v.size ?? null,
              color: v.color ?? null,
              price: v.price,
              currency: v.currency ?? 'UAH',
            });

            if (v.inventoryQty !== undefined && v.inventoryQty !== null) {
              await this.upsertStockBalance(variant.id, v.inventoryQty);
            }
          } catch (err: any) {
            errors.push(`variant ${v.externalVariantId}: ${err.message}`);
          }
        }
      } catch (err: any) {
        errors.push(`product ${p.externalProductId}: ${err.message}`);
        skipped++;
      }
    }

    // Cleanup: mark products as inactive if not in this sync batch
    const syncedExternalIds = products.map(p => p.externalProductId);
    if (syncedExternalIds.length > 0) {
      const deactivated = await this.productRepo
        .createQueryBuilder()
        .update()
        .set({ status: ProductStatus.Archived })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('status = :active', { active: ProductStatus.Active })
        .andWhere('external_product_id IS NOT NULL')
        .andWhere('external_product_id NOT IN (:...ids)', { ids: syncedExternalIds })
        .execute();

      if (deactivated.affected) {
        this.logger.log(`Catalog cleanup: deactivated ${deactivated.affected} stale products`);
      }
    }

    this.logger.log(
      `Catalog import: created=${created} updated=${updated} skipped=${skipped} errors=${errors.length}`,
    );
    return { created, updated, skipped, errors };
  }

  /**
   * Bulk stock update from a connector (n8n).
   * Matches variants by externalVariantId within a tenant.
   */
  async importStock(
    tenantId: string,
    items: Array<{ externalVariantId: string; availableQty: number }>,
  ): Promise<{ processed: number; updated: number; skipped: number; errors: string[] }> {
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        const variant = await this.variantRepo
          .createQueryBuilder('v')
          .innerJoin('v.product', 'p')
          .where('p.tenantId = :tenantId', { tenantId })
          .andWhere('v.externalVariantId = :extId', { extId: item.externalVariantId })
          .getOne();

        if (!variant) {
          skippedCount++;
          continue;
        }

        await this.upsertStockBalance(variant.id, item.availableQty);
        updatedCount++;
      } catch (err: any) {
        errors.push(`variant ${item.externalVariantId}: ${err.message}`);
      }
    }

    this.logger.log(
      `Stock import: processed=${items.length} updated=${updatedCount} skipped=${skippedCount} errors=${errors.length}`,
    );
    return { processed: items.length, updated: updatedCount, skipped: skippedCount, errors };
  }
}
