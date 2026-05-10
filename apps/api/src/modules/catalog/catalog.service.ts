import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductMedia } from './entities/product-media.entity';
import { StockBalance } from './entities/stock-balance.entity';
import { Category } from './entities/category.entity';
import { SearchProductsDto } from './dto/search-products.dto';
import { ImageHashService } from './image-hash.service';
import { ImageEmbeddingService } from './image-embedding.service';
import { ProductStatus } from '@direct-mate/shared';

/**
 * Shape of a product as it arrives at importCatalog. Mirrors
 * ImportProductDto + ImportVariantDto from the controller's DTO,
 * minus class-validator decorators (which only run at the HTTP edge).
 */
export interface ImportProductInput {
  externalProductId: string;
  title: string;
  description?: string | null;
  /** Legacy single-category text. categories[] takes precedence when present. */
  category?: string | null;
  categories?: string[];
  brand?: string | null;
  material?: string | null;
  gender?: 'male' | 'female' | 'unisex' | 'kids' | null;
  season?: string | null;
  modelName?: string | null;
  /**
   * AI-enriched search blob produced at sync time (n8n Normalize step).
   * Ukrainian-heavy text mixing color synonyms, garment terms, style
   * tags. Stored verbatim on `products.search_keywords`. Connectors
   * that don't run normalization (or older n8n versions) omit this
   * field — the column stays NULL and search falls back to title/
   * description as before.
   */
  searchKeywords?: string | null;
  /** Single image URL (Torgsoft style). Coexists with images[] for legacy connectors. */
  image?: string;
  status?: string;
  variants: Array<{
    externalVariantId: string;
    sku?: string;
    barcode?: string | null;
    size?: string | null;
    color?: string | null;
    price: number;
    salePrice?: number | null;
    currency?: string;
    inventoryQty?: number;
    imageUrl?: string;
  }>;
  images?: Array<{
    url: string;
    color?: string;
    sortOrder?: number;
  }>;
}

export interface ImportCatalogResult {
  productsCreated: number;
  productsUpdated: number;
  productsArchived: number;
  variantsCreated: number;
  variantsUpdated: number;
  categoriesCreated: number;
  errors: string[];
}

// Fields on Product that the sync owns + diffs against incoming payload.
const PRODUCT_DIFF_FIELDS = [
  'title',
  'description',
  'category',
  'brand',
  'material',
  'gender',
  'season',
  'salePrice',
  'modelName',
  'status',
  'searchKeywords',
] as const;

// Fields on ProductVariant that the sync owns + diffs against incoming.
const VARIANT_DIFF_FIELDS = [
  'sku',
  'barcode',
  'size',
  'color',
  'price',
  'salePrice',
  'currency',
] as const;

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
    @InjectRepository(ProductMedia)
    private readonly mediaRepo: Repository<ProductMedia>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    private readonly dataSource: DataSource,
    private readonly imageHashService: ImageHashService,
    private readonly imageEmbeddingService: ImageEmbeddingService,
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
    data: Partial<ProductVariant> & { externalVariantId: string; tenantId: string },
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
      .leftJoinAndSelect('p.media', 'm')
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('p.status = :status', { status: 'active' })
      .orderBy('p.title', 'ASC')
      .addOrderBy('m.sortOrder', 'ASC');

    if (q) {
      qb.andWhere('p.title ILIKE :q', { q: `%${q}%` });
    }

    const products = await qb.getMany();

    return products.map((p) => {
      // Build a map of color → image URL from product media
      const colorImageMap = new Map<string, string>();
      const sortedMedia = (p.media ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
      const productImageUrl = sortedMedia[0]?.url ?? null;
      for (const m of sortedMedia) {
        if (m.color && !colorImageMap.has(m.color.toLowerCase())) {
          colorImageMap.set(m.color.toLowerCase(), m.url);
        }
      }

      return {
        id: p.id,
        sku: p.sku,
        title: p.title,
        category: p.category,
        imageUrl: productImageUrl,
        variantCount: p.variants?.length ?? 0,
        // updatedAt = "last column changed"; lastSyncedAt = "last seen
        // in connector feed". UI shows the latter (freshness signal).
        updatedAt: p.updatedAt,
        lastSyncedAt: p.lastSyncedAt ?? p.updatedAt,
        variants: (p.variants ?? []).map((v) => ({
          id: v.id,
          sku: v.sku,
          size: v.size,
          color: v.color,
          price: v.price,
          currency: v.currency,
          // Variant image: prefer variant's own imageUrl, then color-matched media, then product image
          imageUrl: v.imageUrl ?? (v.color ? colorImageMap.get(v.color.toLowerCase()) : null) ?? productImageUrl,
          effectiveAvailable:
            (v.stockBalance?.availableQty ?? 0) -
            (v.stockBalance?.reservedQty ?? 0) -
            (v.stockBalance?.pendingCheckoutQty ?? 0),
          // Per-variant freshness from the variant row itself, not from
          // stock_balances (which only ticks on qty changes).
          lastSyncedAt: v.lastSyncedAt ?? v.stockBalance?.lastSyncedAt ?? null,
        })),
      };
    });
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
   * Bulk upsert products + variants + stock + categories from a connector
   * (n8n / Torgsoft). Idempotent diff-based: same payload twice produces
   * zero writes.
   *
   * Pipeline (single transaction):
   *   1. Resolve incoming category names → category rows (insert new ones)
   *   2. SELECT existing products by (tenant, external_product_id), diff
   *      against incoming, INSERT new + UPDATE only changed
   *   3. Per product: diff variants by external_variant_id, INSERT new +
   *      UPDATE only changed
   *   4. Per product: replace product_categories junction rows to match
   *      incoming category set
   *   5. Per product: replace product_media if incoming `images` set
   *   6. Per variant: upsert stock balance when inventoryQty present
   *   7. Archive: products with this tenant marked active in DB but not in
   *      incoming payload → status='archived'
   *
   * (1)–(6) run inside a single TX so a partial failure rolls back. (7)
   * runs inside the same TX too — archival should not happen if the
   * upsert fails halfway.
   */
  async importCatalog(
    tenantId: string,
    products: ImportProductInput[],
  ): Promise<ImportCatalogResult> {
    return this.dataSource.transaction(async (mgr) =>
      this.importCatalogTx(mgr, tenantId, products),
    );
  }

  private async importCatalogTx(
    mgr: EntityManager,
    tenantId: string,
    products: ImportProductInput[],
  ): Promise<ImportCatalogResult> {
    const errors: string[] = [];
    let productsCreated = 0;
    let productsUpdated = 0;
    let variantsCreated = 0;
    let variantsUpdated = 0;
    let categoriesCreated = 0;

    // ── 1. Categories ──────────────────────────────────────────────────
    const allCategoryNames = new Set<string>();
    for (const p of products) {
      for (const name of p.categories ?? []) {
        if (name && name.trim()) allCategoryNames.add(name.trim());
      }
    }
    const categoryByLower = await this.upsertCategories(
      mgr,
      tenantId,
      allCategoryNames,
      (delta) => {
        categoriesCreated += delta;
      },
    );

    // ── 2. Products: load existing for diff ────────────────────────────
    const incomingExternalIds = products.map((p) => p.externalProductId);
    const existingProductsRaw = incomingExternalIds.length
      ? await mgr.find(Product, {
          where: {
            tenantId,
            externalProductId: In(incomingExternalIds),
          },
        })
      : [];
    const existingByExternal = new Map<string, Product>();
    for (const ep of existingProductsRaw) {
      if (ep.externalProductId) existingByExternal.set(ep.externalProductId, ep);
    }

    // ── 3. Per-product upsert + dependent rows ─────────────────────────
    // SAVEPOINT per product: a failed row only rolls its own statements
    // back, so the outer txn stays healthy and Postgres does not poison
    // every subsequent command with "current transaction is aborted".
    let savepointSeq = 0;
    for (const p of products) {
      const sp = `sp_p_${savepointSeq++}`;
      await mgr.query(`SAVEPOINT ${sp}`);
      try {
        const existing = existingByExternal.get(p.externalProductId);
        const desired = this.toProductRow(tenantId, p);

        let productId: string;
        if (!existing) {
          const inserted = await mgr.save(Product, mgr.create(Product, desired));
          productId = inserted.id;
          productsCreated++;
        } else {
          productId = existing.id;
          if (this.diffProduct(existing, desired)) {
            // `as any` mirrors the existing upsertProduct cast — TypeORM's
            // QueryDeepPartialEntity is strict about jsonb columns and
            // rejects our flat Partial<Product> shape.
            await mgr.update(Product, existing.id, this.pickProductUpdate(desired) as any);
            productsUpdated++;
          }
        }

        // 3a. Variants
        const vCounts = await this.upsertVariants(mgr, tenantId, productId, p.variants ?? []);
        variantsCreated += vCounts.created;
        variantsUpdated += vCounts.updated;
        for (const e of vCounts.errors) errors.push(`product ${p.externalProductId}: ${e}`);

        // 3b. Stock (per variant, only when inventoryQty set).
        // Negative qty (Torgsoft oversold/backorder convention) → 0 so
        // downstream availability queries see a clean "out of stock"
        // signal rather than negative numbers.
        for (const v of p.variants ?? []) {
          if (v.inventoryQty === undefined || v.inventoryQty === null) continue;
          const qty = Math.max(0, v.inventoryQty);
          await this.upsertStockBalanceTx(mgr, productId, v.externalVariantId, qty);
        }

        // 3c. product_categories junction — replace to match input
        await this.syncProductCategories(
          mgr,
          productId,
          (p.categories ?? [])
            .map((n) => categoryByLower.get(n.trim().toLowerCase()))
            .filter((c): c is Category => !!c),
        );

        // 3d. product_media — replace whenever the connector explicitly
        // sends an `images` field, even if it's an empty array. n8n's
        // FTP-existence filter is authoritative: an empty list means
        // "we checked the source and there are no real photos for this
        // product, drop any stale rows". Treat the absence of the
        // `images` field (`undefined`) as "no signal" so legacy
        // connectors that don't pipe images through don't get wiped.
        //
        // Each new row gets a 64-bit dHash + a 512-dim CLIP embedding
        // computed inline. pHash powers the deterministic exact-match
        // shortcut (Stage 1 of customer-photo lookup); CLIP embedding
        // powers semantic candidate retrieval (Stage 2). A failed
        // download / decode for either path stores NULL on that column —
        // the row still works as a catalog image, just isn't matchable
        // along the failed dimension. We compute both in parallel so
        // a slow CLIP pass doesn't compound a slow pHash pass.
        if (p.images !== undefined) {
          await mgr.delete(ProductMedia, { productId });
          const rows = this.collectImageRows(p);
          const [phashes, embeddings] = await Promise.all([
            Promise.all(
              rows.map((img) => this.imageHashService.hashFromUrl(img.url)),
            ),
            Promise.all(
              rows.map((img) =>
                this.imageEmbeddingService.embedFromUrl(img.url),
              ),
            ),
          ]);
          for (let i = 0; i < rows.length; i++) {
            const emb = embeddings[i];
            await mgr.save(
              ProductMedia,
              mgr.create(ProductMedia, {
                productId,
                ...rows[i],
                phash: phashes[i],
                clipEmbedding: emb
                  ? this.imageEmbeddingService.serializeEmbedding(emb)
                  : null,
              }),
            );
          }
        }

        // 3e. last_synced_at — bumped unconditionally on every successful
        // touch, independent of `updated_at`. The diff-skip optimization
        // above means `updated_at` only ticks when a real field changed;
        // this column tracks "last seen in feed" for the UI.
        await mgr.query(
          `UPDATE products SET last_synced_at = NOW() WHERE id = $1`,
          [productId],
        );
        await mgr.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (err: any) {
        await mgr.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        const detail = (err as any)?.driverError?.detail ?? (err as any)?.detail;
        const code = (err as any)?.driverError?.code ?? (err as any)?.code;
        const parts = [err.message, detail, code ? `[${code}]` : null].filter(Boolean);
        errors.push(`product ${p.externalProductId}: ${parts.join(' — ')}`);
      }
    }

    // ── 4. Archive products no longer in payload ───────────────────────
    let productsArchived = 0;
    if (incomingExternalIds.length > 0) {
      const archived = await mgr
        .createQueryBuilder()
        .update(Product)
        .set({ status: ProductStatus.Archived })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('status = :active', { active: ProductStatus.Active })
        .andWhere('external_product_id IS NOT NULL')
        .andWhere('external_product_id NOT IN (:...ids)', { ids: incomingExternalIds })
        .execute();
      productsArchived = archived.affected ?? 0;
    }

    this.logger.log(
      `Catalog import: created=${productsCreated} updated=${productsUpdated} ` +
        `archived=${productsArchived} variantsCreated=${variantsCreated} ` +
        `variantsUpdated=${variantsUpdated} categoriesCreated=${categoriesCreated} ` +
        `errors=${errors.length}`,
    );

    return {
      productsCreated,
      productsUpdated,
      productsArchived,
      variantsCreated,
      variantsUpdated,
      categoriesCreated,
      errors,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  /**
   * Upsert tenant categories by lowercase name. Returns map keyed by
   * lower(name) so callers can resolve incoming product → category row.
   * Inserts new rows in bulk; existing rows pass through untouched.
   */
  private async upsertCategories(
    mgr: EntityManager,
    tenantId: string,
    names: Set<string>,
    onCreate: (delta: number) => void,
  ): Promise<Map<string, Category>> {
    const map = new Map<string, Category>();
    if (names.size === 0) return map;

    const existing = await mgr.find(Category, { where: { tenantId } });
    const existingByLower = new Map<string, Category>();
    for (const c of existing) existingByLower.set(c.name.toLowerCase(), c);

    const toInsert: Category[] = [];
    for (const name of names) {
      const lower = name.toLowerCase();
      const hit = existingByLower.get(lower);
      if (hit) {
        map.set(lower, hit);
      } else {
        toInsert.push(mgr.create(Category, { tenantId, name }));
      }
    }

    if (toInsert.length > 0) {
      const saved = await mgr.save(Category, toInsert);
      for (const c of saved) map.set(c.name.toLowerCase(), c);
      onCreate(saved.length);
    }

    return map;
  }

  private toProductRow(
    tenantId: string,
    p: ImportProductInput,
  ): Partial<Product> & { externalProductId: string; tenantId: string; title: string } {
    // Denormalize first category into legacy `category` column for
    // back-compat with listProducts() and any other reader. Falls back
    // to the legacy `category` field on the input for older connectors.
    const firstCategory = p.categories?.find((s) => s && s.trim())?.trim() ?? null;
    return {
      tenantId,
      externalProductId: p.externalProductId,
      title: p.title,
      description: p.description ?? null,
      category: firstCategory ?? p.category ?? null,
      brand: p.brand ?? null,
      material: p.material ?? null,
      gender: p.gender ?? null,
      season: p.season ?? null,
      salePrice: this.firstSalePriceFromVariants(p),
      modelName: p.modelName ?? null,
      status: (p.status as ProductStatus) ?? ProductStatus.Active,
      searchKeywords: p.searchKeywords ?? null,
    };
  }

  private firstSalePriceFromVariants(p: ImportProductInput): number | null {
    // Product-level salePrice is not in the wire schema (it lives on
    // variants). We surface the minimum non-null variant salePrice on
    // the product row as a denormalized "from" price for cheap
    // discount-aware listing queries. NULL when no variant has a sale.
    const sales = (p.variants ?? [])
      .map((v) => v.salePrice)
      .filter((n): n is number => typeof n === 'number' && n > 0);
    return sales.length > 0 ? Math.min(...sales) : null;
  }

  private diffProduct(existing: Product, desired: Partial<Product>): boolean {
    for (const key of PRODUCT_DIFF_FIELDS) {
      const e = (existing as any)[key];
      const d = (desired as any)[key];
      if (this.normalizedNeq(e, d)) return true;
    }
    return false;
  }

  /**
   * Numeric NUMERIC columns come back as strings from PG. Normalize
   * both sides before equality comparison so "24" === 24 and
   * null === undefined.
   */
  private normalizedNeq(a: unknown, b: unknown): boolean {
    if (a === null || a === undefined) return !(b === null || b === undefined);
    if (b === null || b === undefined) return true;
    if (typeof a === 'number' || typeof b === 'number') {
      const na = typeof a === 'number' ? a : parseFloat(String(a));
      const nb = typeof b === 'number' ? b : parseFloat(String(b));
      return na !== nb;
    }
    return String(a) !== String(b);
  }

  private pickProductUpdate(desired: Partial<Product>): Partial<Product> {
    const out: Partial<Product> = {};
    for (const key of PRODUCT_DIFF_FIELDS) {
      (out as any)[key] = (desired as any)[key];
    }
    return out;
  }

  private async upsertVariants(
    mgr: EntityManager,
    tenantId: string,
    productId: string,
    incoming: ImportProductInput['variants'],
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    // Look up existing variants tenant-wide by external_variant_id, NOT by
    // product_id. Source-of-truth identifier (Torgsoft GoodID, Shopify
    // variant id) is unique per tenant and can legitimately move between
    // products when the upstream catalog reshapes — e.g. n8n's merge step
    // collapses three same-name+same-price Articuls into one canonical
    // product, and the variants of the two non-canonical siblings need to
    // re-attach to the canonical product_id rather than collide on the
    // (tenant_id, barcode) unique index.
    const externalIds = incoming
      .map((v) => v.externalVariantId)
      .filter((x): x is string => !!x);
    const existing = externalIds.length
      ? await mgr.find(ProductVariant, {
          where: { tenantId, externalVariantId: In(externalIds) },
        })
      : [];
    const existingByExternal = new Map<string, ProductVariant>();
    for (const ev of existing) {
      if (ev.externalVariantId) existingByExternal.set(ev.externalVariantId, ev);
    }

    // SAVEPOINT per variant: see note on the per-product loop. A bad
    // row otherwise poisons the outer txn and turns the real error into
    // the generic "transaction is aborted" message at commit time.
    let variantSpSeq = 0;
    for (const v of incoming) {
      const sp = `sp_v_${productId.replace(/-/g, '')}_${variantSpSeq++}`;
      await mgr.query(`SAVEPOINT ${sp}`);
      try {
        const desired: Partial<ProductVariant> = {
          tenantId,
          productId,
          externalVariantId: v.externalVariantId,
          sku: v.sku ?? null,
          barcode: v.barcode ?? null,
          size: v.size ?? null,
          color: v.color ?? null,
          price: v.price,
          salePrice: v.salePrice ?? null,
          currency: v.currency ?? 'UAH',
          // Don't wipe imageUrl when input omits it (legacy connector
          // doesn't always send variant-level images).
          ...(v.imageUrl !== undefined ? { imageUrl: v.imageUrl } : {}),
        };

        const ex = existingByExternal.get(v.externalVariantId);
        if (!ex) {
          await mgr.save(
            ProductVariant,
            mgr.create(ProductVariant, { ...desired, lastSyncedAt: new Date() }),
          );
          created++;
        } else {
          // productId is not in VARIANT_DIFF_FIELDS but a variant may
          // legitimately move products on a re-shaping sync — diff it
          // explicitly so the UPDATE fires and the variant re-attaches
          // to the canonical product, freeing the (tenant_id, barcode)
          // slot that's otherwise locked on the old product row.
          const productMoved = ex.productId !== productId;
          if (productMoved || this.diffVariant(ex, desired)) {
            // See note on Product update above re: `as any`.
            await mgr.update(ProductVariant, ex.id, desired as any);
            updated++;
          }
          // Bump last_synced_at unconditionally on every successful
          // touch so per-variant freshness reflects the latest sync,
          // not the latest field-change.
          await mgr.query(
            `UPDATE product_variants SET last_synced_at = NOW() WHERE id = $1`,
            [ex.id],
          );
        }
        await mgr.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (err: any) {
        await mgr.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        const detail = (err as any)?.driverError?.detail ?? (err as any)?.detail;
        const code = (err as any)?.driverError?.code ?? (err as any)?.code;
        const parts = [err.message, detail, code ? `[${code}]` : null].filter(Boolean);
        errors.push(`variant ${v.externalVariantId}: ${parts.join(' — ')}`);
      }
    }

    return { created, updated, errors };
  }

  private diffVariant(existing: ProductVariant, desired: Partial<ProductVariant>): boolean {
    for (const key of VARIANT_DIFF_FIELDS) {
      if (this.normalizedNeq((existing as any)[key], (desired as any)[key])) return true;
    }
    return false;
  }

  private async syncProductCategories(
    mgr: EntityManager,
    productId: string,
    desired: Category[],
  ): Promise<void> {
    // junction has no entity; raw query is fine. PK = (product_id,
    // category_id) with cascade delete from both sides.
    const desiredIds = new Set(desired.map((c) => c.id));
    const existing: Array<{ category_id: string }> = await mgr.query(
      `SELECT category_id FROM product_categories WHERE product_id = $1`,
      [productId],
    );
    const existingIds = new Set(existing.map((r) => r.category_id));

    const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));

    if (toAdd.length > 0) {
      // Multi-row VALUES INSERT — single round-trip.
      const placeholders = toAdd.map((_, i) => `($1, $${i + 2})`).join(',');
      await mgr.query(
        `INSERT INTO product_categories (product_id, category_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        [productId, ...toAdd],
      );
    }
    if (toRemove.length > 0) {
      await mgr.query(
        `DELETE FROM product_categories WHERE product_id = $1 AND category_id = ANY($2::uuid[])`,
        [productId, toRemove],
      );
    }
  }

  private collectImageRows(p: ImportProductInput): Array<{
    url: string;
    color: string | null;
    sortOrder: number;
  }> {
    if (p.images && p.images.length > 0) {
      return p.images.map((img, i) => ({
        url: img.url,
        color: img.color ?? null,
        sortOrder: img.sortOrder ?? i,
      }));
    }
    if (p.image) {
      return [{ url: p.image, color: null, sortOrder: 0 }];
    }
    return [];
  }

  private async upsertStockBalanceTx(
    mgr: EntityManager,
    productId: string,
    externalVariantId: string,
    availableQty: number,
  ): Promise<void> {
    const variant = await mgr.findOne(ProductVariant, {
      where: { productId, externalVariantId },
    });
    if (!variant) return;

    const existing = await mgr.findOne(StockBalance, { where: { variantId: variant.id } });
    if (existing) {
      // Only fire the UPDATE when qty actually changed — keeps idempotent
      // re-syncs as quiet as possible (also avoids touching last_synced_at
      // on no-op runs).
      if (existing.availableQty !== availableQty) {
        await mgr.update(StockBalance, existing.id, {
          availableQty,
          lastSyncedAt: new Date(),
        });
      }
    } else {
      await mgr.save(
        StockBalance,
        mgr.create(StockBalance, {
          variantId: variant.id,
          availableQty,
          lastSyncedAt: new Date(),
        }),
      );
    }
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
