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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvailabilityService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const product_variant_entity_1 = require("../catalog/entities/product-variant.entity");
const stock_balance_entity_1 = require("../catalog/entities/stock-balance.entity");
const product_media_entity_1 = require("../catalog/entities/product-media.entity");
const FRESHNESS_MINUTES = 10;
let AvailabilityService = class AvailabilityService {
    constructor(variantRepo, stockRepo, mediaRepo, dataSource) {
        this.variantRepo = variantRepo;
        this.stockRepo = stockRepo;
        this.mediaRepo = mediaRepo;
        this.dataSource = dataSource;
    }
    extractSearchTerms(text) {
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
    async getCategories(tenantId) {
        const rows = await this.dataSource.query(`SELECT DISTINCT name FROM (
         SELECT name FROM categories WHERE tenant_id = $1
         UNION
         SELECT category AS name FROM products
          WHERE tenant_id = $1
            AND category IS NOT NULL
            AND status = 'active'
       ) c
       ORDER BY name`, [tenantId]);
        return rows.map((r) => r.name).filter(Boolean);
    }
    async check(tenantId, dto) {
        const searchTerms = this.extractSearchTerms(dto.query);
        if (searchTerms.length === 0) {
            return { matchType: 'none', product: null, variant: null, stock: null };
        }
        const fullPhrase = searchTerms.join(' ');
        let variant = await this.searchByTitle(tenantId, fullPhrase, dto);
        if (!variant) {
            for (const term of searchTerms) {
                variant = await this.searchByTitle(tenantId, term, dto);
                if (variant)
                    break;
            }
        }
        if (!variant) {
            variant = await this.searchByCategory(tenantId, fullPhrase, dto);
            if (!variant) {
                for (const term of searchTerms) {
                    variant = await this.searchByCategory(tenantId, term, dto);
                    if (variant)
                        break;
                }
            }
        }
        if (!variant) {
            variant = await this.searchByTrigram(tenantId, fullPhrase, dto);
        }
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
    async searchByTitle(tenantId, term, dto) {
        const qb = this.variantRepo
            .createQueryBuilder('v')
            .innerJoinAndSelect('v.product', 'p')
            .leftJoinAndSelect('v.stockBalance', 's')
            .where('p.tenant_id = :tenantId', { tenantId })
            .andWhere('p.status = :status', { status: 'active' })
            .andWhere('v.active = true')
            .andWhere('p.title ILIKE :q', { q: `%${term}%` });
        if (dto.size)
            qb.andWhere('v.size ILIKE :size', { size: dto.size });
        if (dto.color)
            qb.andWhere('v.color ILIKE :color', { color: dto.color });
        return qb.getOne();
    }
    async searchByCategory(tenantId, term, dto) {
        const qb = this.variantRepo
            .createQueryBuilder('v')
            .innerJoinAndSelect('v.product', 'p')
            .leftJoinAndSelect('v.stockBalance', 's')
            .where('p.tenant_id = :tenantId', { tenantId })
            .andWhere('p.status = :status', { status: 'active' })
            .andWhere('v.active = true')
            .andWhere('p.category ILIKE :q', { q: `%${term}%` });
        if (dto.size)
            qb.andWhere('v.size ILIKE :size', { size: dto.size });
        if (dto.color)
            qb.andWhere('v.color ILIKE :color', { color: dto.color });
        return qb.getOne();
    }
    async searchByTrigram(tenantId, term, dto) {
        if (term.length < 4)
            return null;
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
        if (dto.size)
            qb.andWhere('v.size ILIKE :size', { size: dto.size });
        if (dto.color)
            qb.andWhere('v.color ILIKE :color', { color: dto.color });
        return qb.getOne();
    }
    async checkAll(tenantId, dto) {
        const searchTerms = this.extractSearchTerms(dto.query);
        const fullPhrase = searchTerms.join(' ');
        let variants = [];
        if (dto.category) {
            variants = await this.searchAllByCategoryName(tenantId, dto.category, searchTerms);
        }
        if (!variants.length && searchTerms.length === 0)
            return [];
        if (!variants.length) {
            variants = await this.searchAllByTitle(tenantId, fullPhrase);
            if (!variants.length) {
                for (const t of searchTerms) {
                    variants = await this.searchAllByTitle(tenantId, t);
                    if (variants.length)
                        break;
                }
            }
        }
        if (!variants.length) {
            variants = await this.searchAllByDescription(tenantId, fullPhrase);
            if (!variants.length) {
                for (const t of searchTerms) {
                    variants = await this.searchAllByDescription(tenantId, t);
                    if (variants.length)
                        break;
                }
            }
        }
        if (variants.length === 0)
            return [];
        const results = this.groupVariantsByProduct(variants);
        await this.loadProductImages(results);
        return results.slice(0, 5);
    }
    async searchAllByTitle(tenantId, term) {
        return this.variantRepo
            .createQueryBuilder('v')
            .innerJoinAndSelect('v.product', 'p')
            .leftJoinAndSelect('v.stockBalance', 's')
            .where('v.active = true')
            .andWhere(`v.product_id IN (
           SELECT pp.id FROM products pp
            WHERE pp.tenant_id = :tenantId
              AND pp.status = 'active'
              AND (
                pp.title ILIKE :q
                OR pp.search_keywords ILIKE :q
              )
            ORDER BY pp.last_synced_at DESC NULLS LAST
            LIMIT 10
         )`, { tenantId, q: `%${term}%` })
            .getMany();
    }
    async searchAllByCategoryName(tenantId, categoryName, searchTerms = []) {
        const params = { tenantId, cat: categoryName };
        let termsSql = '';
        if (searchTerms.length > 0) {
            const lowered = searchTerms
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
                .map((t) => t.toLowerCase());
            if (lowered.length > 0) {
                params.terms = lowered;
                termsSql = `
              AND NOT EXISTS (
                SELECT 1 FROM unnest(ARRAY[:...terms]::text[]) AS term
                 WHERE NOT (
                   lower(pp.title) LIKE '%' || term || '%'
                   OR lower(coalesce(pp.search_keywords, '')) LIKE '%' || term || '%'
                 )
              )`;
            }
        }
        return this.variantRepo
            .createQueryBuilder('v')
            .innerJoinAndSelect('v.product', 'p')
            .leftJoinAndSelect('v.stockBalance', 's')
            .where('v.active = true')
            .andWhere(`v.product_id IN (
           SELECT pp.id FROM products pp
            WHERE pp.tenant_id = :tenantId
              AND pp.status = 'active'
              AND (
                EXISTS (
                  SELECT 1 FROM product_categories pc
                   INNER JOIN categories c ON c.id = pc.category_id
                   WHERE pc.product_id = pp.id AND lower(c.name) = lower(:cat)
                ) OR lower(pp.category) = lower(:cat)
              )${termsSql}
            ORDER BY pp.last_synced_at DESC NULLS LAST
            LIMIT 10
         )`, params)
            .getMany();
    }
    async searchAllByDescription(tenantId, term) {
        return this.variantRepo
            .createQueryBuilder('v')
            .innerJoinAndSelect('v.product', 'p')
            .leftJoinAndSelect('v.stockBalance', 's')
            .where('v.active = true')
            .andWhere(`v.product_id IN (
           SELECT pp.id FROM products pp
            WHERE pp.tenant_id = :tenantId
              AND pp.status = 'active'
              AND pp.description ILIKE :q
            ORDER BY pp.last_synced_at DESC NULLS LAST
            LIMIT 10
         )`, { tenantId, q: `%${term}%` })
            .getMany();
    }
    async findAllByProductId(productId, variantId) {
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
        if (variants.length === 0)
            return [];
        const results = this.groupVariantsByProduct(variants);
        await this.loadProductImages(results);
        return results;
    }
    async getByProductId(productId, variantId) {
        const qb = this.variantRepo
            .createQueryBuilder('v')
            .innerJoinAndSelect('v.product', 'p')
            .leftJoinAndSelect('v.stockBalance', 's')
            .where('p.id = :productId', { productId });
        if (variantId) {
            qb.andWhere('v.id = :variantId', { variantId });
        }
        const variant = await qb.getOne();
        if (!variant)
            return null;
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
    groupVariantsByProduct(variants) {
        const productMap = new Map();
        for (const v of variants) {
            const pid = v.product.id;
            if (!productMap.has(pid)) {
                productMap.set(pid, {
                    product: {
                        id: pid,
                        title: v.product.title,
                        imageUrl: null,
                        category: v.product.category ?? null,
                        searchKeywords: v.product.searchKeywords ?? null,
                    },
                    variants: [],
                });
            }
            const stock = v.stockBalance;
            const effectiveAvailable = stock
                ? stock.availableQty - stock.reservedQty - stock.pendingCheckoutQty
                : 0;
            productMap.get(pid).variants.push({
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
    async loadProductImages(results) {
        const productIds = results.map((r) => r.product.id);
        if (productIds.length === 0)
            return;
        const [productImages, variantImages] = await Promise.all([
            this.dataSource.query(`SELECT DISTINCT ON (product_id) product_id, url
         FROM product_media
         WHERE product_id = ANY($1)
         ORDER BY product_id, sort_order ASC`, [productIds]),
            this.dataSource.query(`SELECT product_id, color, url, sort_order
         FROM product_media
         WHERE product_id = ANY($1) AND color IS NOT NULL
         ORDER BY product_id, sort_order ASC`, [productIds]),
        ]);
        const productImageMap = new Map(productImages.map((i) => [i.product_id, i.url]));
        const colorImageMap = new Map();
        for (const row of variantImages) {
            if (!colorImageMap.has(row.product_id)) {
                colorImageMap.set(row.product_id, new Map());
            }
            const m = colorImageMap.get(row.product_id);
            const key = row.color.toLowerCase();
            if (!m.has(key))
                m.set(key, row.url);
        }
        for (const r of results) {
            r.product.imageUrl = productImageMap.get(r.product.id) ?? null;
            const productColorMap = colorImageMap.get(r.product.id);
            for (const v of r.variants) {
                if (v.imageUrl)
                    continue;
                const colorMatch = v.color ? productColorMap?.get(v.color.toLowerCase()) : undefined;
                v.imageUrl = colorMatch ?? r.product.imageUrl ?? null;
            }
        }
    }
};
exports.AvailabilityService = AvailabilityService;
exports.AvailabilityService = AvailabilityService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_variant_entity_1.ProductVariant)),
    __param(1, (0, typeorm_1.InjectRepository)(stock_balance_entity_1.StockBalance)),
    __param(2, (0, typeorm_1.InjectRepository)(product_media_entity_1.ProductMedia)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], AvailabilityService);
//# sourceMappingURL=availability.service.js.map