"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var CatalogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const product_entity_1 = require("./entities/product.entity");
const product_variant_entity_1 = require("./entities/product-variant.entity");
const product_media_entity_1 = require("./entities/product-media.entity");
const stock_balance_entity_1 = require("./entities/stock-balance.entity");
const category_entity_1 = require("./entities/category.entity");
const image_hash_service_1 = require("./image-hash.service");
const image_embedding_service_1 = require("./image-embedding.service");
const shared_1 = require("@direct-mate/shared");
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
];
const VARIANT_DIFF_FIELDS = [
    'sku',
    'barcode',
    'size',
    'color',
    'price',
    'salePrice',
    'currency',
];
let CatalogService = CatalogService_1 = class CatalogService {
    constructor(productRepo, variantRepo, stockRepo, mediaRepo, categoryRepo, dataSource, imageHashService, imageEmbeddingService) {
        this.productRepo = productRepo;
        this.variantRepo = variantRepo;
        this.stockRepo = stockRepo;
        this.mediaRepo = mediaRepo;
        this.categoryRepo = categoryRepo;
        this.dataSource = dataSource;
        this.imageHashService = imageHashService;
        this.imageEmbeddingService = imageEmbeddingService;
        this.logger = new common_1.Logger(CatalogService_1.name);
    }
    async searchProducts(tenantId, dto) {
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
    async upsertProduct(tenantId, data) {
        const existing = await this.productRepo.findOne({
            where: { tenantId, externalProductId: data.externalProductId },
        });
        if (existing) {
            await this.productRepo.update(existing.id, { ...data, tenantId });
            return this.productRepo.findOneOrFail({ where: { id: existing.id } });
        }
        const product = this.productRepo.create({ ...data, tenantId });
        return this.productRepo.save(product);
    }
    async upsertVariant(productId, data) {
        const existing = await this.variantRepo.findOne({
            where: { productId, externalVariantId: data.externalVariantId },
        });
        if (existing) {
            await this.variantRepo.update(existing.id, { ...data, productId });
            return this.variantRepo.findOneOrFail({ where: { id: existing.id } });
        }
        const variant = this.variantRepo.create({ ...data, productId });
        return this.variantRepo.save(variant);
    }
    async listProducts(tenantId, q) {
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
            const colorImageMap = new Map();
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
                updatedAt: p.updatedAt,
                lastSyncedAt: p.lastSyncedAt ?? p.updatedAt,
                variants: (p.variants ?? []).map((v) => ({
                    id: v.id,
                    sku: v.sku,
                    size: v.size,
                    color: v.color,
                    price: v.price,
                    currency: v.currency,
                    imageUrl: v.imageUrl ?? (v.color ? colorImageMap.get(v.color.toLowerCase()) : null) ?? productImageUrl,
                    effectiveAvailable: (v.stockBalance?.availableQty ?? 0) -
                        (v.stockBalance?.reservedQty ?? 0) -
                        (v.stockBalance?.pendingCheckoutQty ?? 0),
                    lastSyncedAt: v.lastSyncedAt ?? v.stockBalance?.lastSyncedAt ?? null,
                })),
            };
        });
    }
    async upsertStockBalance(variantId, availableQty) {
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
    async importCatalog(tenantId, products) {
        return this.dataSource.transaction(async (mgr) => this.importCatalogTx(mgr, tenantId, products));
    }
    async importCatalogTx(mgr, tenantId, products) {
        const errors = [];
        let productsCreated = 0;
        let productsUpdated = 0;
        let variantsCreated = 0;
        let variantsUpdated = 0;
        let categoriesCreated = 0;
        const allCategoryNames = new Set();
        for (const p of products) {
            for (const name of p.categories ?? []) {
                if (name && name.trim())
                    allCategoryNames.add(name.trim());
            }
        }
        const categoryByLower = await this.upsertCategories(mgr, tenantId, allCategoryNames, (delta) => {
            categoriesCreated += delta;
        });
        const incomingExternalIds = products.map((p) => p.externalProductId);
        const existingProductsRaw = incomingExternalIds.length
            ? await mgr.find(product_entity_1.Product, {
                where: {
                    tenantId,
                    externalProductId: (0, typeorm_2.In)(incomingExternalIds),
                },
            })
            : [];
        const existingByExternal = new Map();
        for (const ep of existingProductsRaw) {
            if (ep.externalProductId)
                existingByExternal.set(ep.externalProductId, ep);
        }
        let savepointSeq = 0;
        for (const p of products) {
            const sp = `sp_p_${savepointSeq++}`;
            await mgr.query(`SAVEPOINT ${sp}`);
            try {
                const existing = existingByExternal.get(p.externalProductId);
                const desired = this.toProductRow(tenantId, p);
                let productId;
                if (!existing) {
                    const inserted = await mgr.save(product_entity_1.Product, mgr.create(product_entity_1.Product, desired));
                    productId = inserted.id;
                    productsCreated++;
                }
                else {
                    productId = existing.id;
                    if (this.diffProduct(existing, desired)) {
                        await mgr.update(product_entity_1.Product, existing.id, this.pickProductUpdate(desired));
                        productsUpdated++;
                    }
                }
                const vCounts = await this.upsertVariants(mgr, tenantId, productId, p.variants ?? []);
                variantsCreated += vCounts.created;
                variantsUpdated += vCounts.updated;
                for (const e of vCounts.errors)
                    errors.push(`product ${p.externalProductId}: ${e}`);
                for (const v of p.variants ?? []) {
                    if (v.inventoryQty === undefined || v.inventoryQty === null)
                        continue;
                    const qty = Math.max(0, v.inventoryQty);
                    await this.upsertStockBalanceTx(mgr, productId, v.externalVariantId, qty);
                }
                await this.syncProductCategories(mgr, productId, (p.categories ?? [])
                    .map((n) => categoryByLower.get(n.trim().toLowerCase()))
                    .filter((c) => !!c));
                if (p.images !== undefined) {
                    await mgr.delete(product_media_entity_1.ProductMedia, { productId });
                    const rows = this.collectImageRows(p);
                    const [phashes, embeddings] = await Promise.all([
                        Promise.all(rows.map((img) => this.imageHashService.hashFromUrl(img.url))),
                        Promise.all(rows.map((img) => this.imageEmbeddingService.embedFromUrl(img.url))),
                    ]);
                    for (let i = 0; i < rows.length; i++) {
                        const emb = embeddings[i];
                        await mgr.save(product_media_entity_1.ProductMedia, mgr.create(product_media_entity_1.ProductMedia, {
                            productId,
                            ...rows[i],
                            phash: phashes[i],
                            clipEmbedding: emb
                                ? this.imageEmbeddingService.serializeEmbedding(emb)
                                : null,
                        }));
                    }
                }
                await mgr.query(`UPDATE products SET last_synced_at = NOW() WHERE id = $1`, [productId]);
                await mgr.query(`RELEASE SAVEPOINT ${sp}`);
            }
            catch (err) {
                await mgr.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                const detail = err?.driverError?.detail ?? err?.detail;
                const code = err?.driverError?.code ?? err?.code;
                const parts = [err.message, detail, code ? `[${code}]` : null].filter(Boolean);
                errors.push(`product ${p.externalProductId}: ${parts.join(' — ')}`);
            }
        }
        let productsArchived = 0;
        if (incomingExternalIds.length > 0) {
            const archived = await mgr
                .createQueryBuilder()
                .update(product_entity_1.Product)
                .set({ status: shared_1.ProductStatus.Archived })
                .where('tenant_id = :tenantId', { tenantId })
                .andWhere('status = :active', { active: shared_1.ProductStatus.Active })
                .andWhere('external_product_id IS NOT NULL')
                .andWhere('external_product_id NOT IN (:...ids)', { ids: incomingExternalIds })
                .execute();
            productsArchived = archived.affected ?? 0;
        }
        this.logger.log(`Catalog import: created=${productsCreated} updated=${productsUpdated} ` +
            `archived=${productsArchived} variantsCreated=${variantsCreated} ` +
            `variantsUpdated=${variantsUpdated} categoriesCreated=${categoriesCreated} ` +
            `errors=${errors.length}`);
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
    async upsertCategories(mgr, tenantId, names, onCreate) {
        const map = new Map();
        if (names.size === 0)
            return map;
        const existing = await mgr.find(category_entity_1.Category, { where: { tenantId } });
        const existingByLower = new Map();
        for (const c of existing)
            existingByLower.set(c.name.toLowerCase(), c);
        const toInsert = [];
        for (const name of names) {
            const lower = name.toLowerCase();
            const hit = existingByLower.get(lower);
            if (hit) {
                map.set(lower, hit);
            }
            else {
                toInsert.push(mgr.create(category_entity_1.Category, { tenantId, name }));
            }
        }
        if (toInsert.length > 0) {
            const saved = await mgr.save(category_entity_1.Category, toInsert);
            for (const c of saved)
                map.set(c.name.toLowerCase(), c);
            onCreate(saved.length);
        }
        return map;
    }
    toProductRow(tenantId, p) {
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
            status: p.status ?? shared_1.ProductStatus.Active,
            searchKeywords: p.searchKeywords ?? null,
        };
    }
    firstSalePriceFromVariants(p) {
        const sales = (p.variants ?? [])
            .map((v) => v.salePrice)
            .filter((n) => typeof n === 'number' && n > 0);
        return sales.length > 0 ? Math.min(...sales) : null;
    }
    diffProduct(existing, desired) {
        for (const key of PRODUCT_DIFF_FIELDS) {
            const e = existing[key];
            const d = desired[key];
            if (this.normalizedNeq(e, d))
                return true;
        }
        return false;
    }
    normalizedNeq(a, b) {
        if (a === null || a === undefined)
            return !(b === null || b === undefined);
        if (b === null || b === undefined)
            return true;
        if (typeof a === 'number' || typeof b === 'number') {
            const na = typeof a === 'number' ? a : parseFloat(String(a));
            const nb = typeof b === 'number' ? b : parseFloat(String(b));
            return na !== nb;
        }
        return String(a) !== String(b);
    }
    pickProductUpdate(desired) {
        const out = {};
        for (const key of PRODUCT_DIFF_FIELDS) {
            out[key] = desired[key];
        }
        return out;
    }
    async upsertVariants(mgr, tenantId, productId, incoming) {
        const errors = [];
        let created = 0;
        let updated = 0;
        const externalIds = incoming
            .map((v) => v.externalVariantId)
            .filter((x) => !!x);
        const existing = externalIds.length
            ? await mgr.find(product_variant_entity_1.ProductVariant, {
                where: { tenantId, externalVariantId: (0, typeorm_2.In)(externalIds) },
            })
            : [];
        const existingByExternal = new Map();
        for (const ev of existing) {
            if (ev.externalVariantId)
                existingByExternal.set(ev.externalVariantId, ev);
        }
        let variantSpSeq = 0;
        for (const v of incoming) {
            const sp = `sp_v_${productId.replace(/-/g, '')}_${variantSpSeq++}`;
            await mgr.query(`SAVEPOINT ${sp}`);
            try {
                const desired = {
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
                    ...(v.imageUrl !== undefined ? { imageUrl: v.imageUrl } : {}),
                };
                const ex = existingByExternal.get(v.externalVariantId);
                if (!ex) {
                    await mgr.save(product_variant_entity_1.ProductVariant, mgr.create(product_variant_entity_1.ProductVariant, { ...desired, lastSyncedAt: new Date() }));
                    created++;
                }
                else {
                    const productMoved = ex.productId !== productId;
                    if (productMoved || this.diffVariant(ex, desired)) {
                        await mgr.update(product_variant_entity_1.ProductVariant, ex.id, desired);
                        updated++;
                    }
                    await mgr.query(`UPDATE product_variants SET last_synced_at = NOW() WHERE id = $1`, [ex.id]);
                }
                await mgr.query(`RELEASE SAVEPOINT ${sp}`);
            }
            catch (err) {
                await mgr.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                const detail = err?.driverError?.detail ?? err?.detail;
                const code = err?.driverError?.code ?? err?.code;
                const parts = [err.message, detail, code ? `[${code}]` : null].filter(Boolean);
                errors.push(`variant ${v.externalVariantId}: ${parts.join(' — ')}`);
            }
        }
        return { created, updated, errors };
    }
    diffVariant(existing, desired) {
        for (const key of VARIANT_DIFF_FIELDS) {
            if (this.normalizedNeq(existing[key], desired[key]))
                return true;
        }
        return false;
    }
    async syncProductCategories(mgr, productId, desired) {
        const desiredIds = new Set(desired.map((c) => c.id));
        const existing = await mgr.query(`SELECT category_id FROM product_categories WHERE product_id = $1`, [productId]);
        const existingIds = new Set(existing.map((r) => r.category_id));
        const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));
        const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));
        if (toAdd.length > 0) {
            const placeholders = toAdd.map((_, i) => `($1, $${i + 2})`).join(',');
            await mgr.query(`INSERT INTO product_categories (product_id, category_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`, [productId, ...toAdd]);
        }
        if (toRemove.length > 0) {
            await mgr.query(`DELETE FROM product_categories WHERE product_id = $1 AND category_id = ANY($2::uuid[])`, [productId, toRemove]);
        }
    }
    collectImageRows(p) {
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
    async upsertStockBalanceTx(mgr, productId, externalVariantId, availableQty) {
        const variant = await mgr.findOne(product_variant_entity_1.ProductVariant, {
            where: { productId, externalVariantId },
        });
        if (!variant)
            return;
        const existing = await mgr.findOne(stock_balance_entity_1.StockBalance, { where: { variantId: variant.id } });
        if (existing) {
            if (existing.availableQty !== availableQty) {
                await mgr.update(stock_balance_entity_1.StockBalance, existing.id, {
                    availableQty,
                    lastSyncedAt: new Date(),
                });
            }
        }
        else {
            await mgr.save(stock_balance_entity_1.StockBalance, mgr.create(stock_balance_entity_1.StockBalance, {
                variantId: variant.id,
                availableQty,
                lastSyncedAt: new Date(),
            }));
        }
    }
    async importStock(tenantId, items) {
        let updatedCount = 0;
        let skippedCount = 0;
        const errors = [];
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
            }
            catch (err) {
                errors.push(`variant ${item.externalVariantId}: ${err.message}`);
            }
        }
        this.logger.log(`Stock import: processed=${items.length} updated=${updatedCount} skipped=${skippedCount} errors=${errors.length}`);
        return { processed: items.length, updated: updatedCount, skipped: skippedCount, errors };
    }
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = CatalogService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __param(1, (0, typeorm_1.InjectRepository)(product_variant_entity_1.ProductVariant)),
    __param(2, (0, typeorm_1.InjectRepository)(stock_balance_entity_1.StockBalance)),
    __param(3, (0, typeorm_1.InjectRepository)(product_media_entity_1.ProductMedia)),
    __param(4, (0, typeorm_1.InjectRepository)(category_entity_1.Category)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        image_hash_service_1.ImageHashService,
        image_embedding_service_1.ImageEmbeddingService])
], CatalogService);
//# sourceMappingURL=catalog.service.js.map