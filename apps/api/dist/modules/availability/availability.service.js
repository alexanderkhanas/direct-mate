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
const FRESHNESS_MINUTES = 10;
let AvailabilityService = class AvailabilityService {
    constructor(variantRepo, stockRepo) {
        this.variantRepo = variantRepo;
        this.stockRepo = stockRepo;
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
        const rows = await this.variantRepo
            .createQueryBuilder('v')
            .innerJoin('v.product', 'p')
            .select('DISTINCT p.category', 'category')
            .where('p.tenant_id = :tenantId', { tenantId })
            .andWhere('p.status = :status', { status: 'active' })
            .andWhere('p.category IS NOT NULL')
            .getRawMany();
        return rows.map((r) => r.category).filter(Boolean);
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
        if (searchTerms.length === 0)
            return [];
        const fullPhrase = searchTerms.join(' ');
        let variants = [];
        variants = await this.searchAllByTitle(tenantId, fullPhrase);
        if (!variants.length) {
            for (const t of searchTerms) {
                variants = await this.searchAllByTitle(tenantId, t);
                if (variants.length)
                    break;
            }
        }
        if (!variants.length) {
            variants = await this.searchAllByCategory(tenantId, fullPhrase);
            if (!variants.length) {
                for (const t of searchTerms) {
                    variants = await this.searchAllByCategory(tenantId, t);
                    if (variants.length)
                        break;
                }
            }
        }
        if (!variants.length) {
            for (const t of searchTerms) {
                if (t.length < 4)
                    continue;
                variants = await this.searchAllByCategoryTrigram(tenantId, t);
                if (variants.length)
                    break;
            }
        }
        if (variants.length === 0)
            return [];
        const productMap = new Map();
        for (const v of variants) {
            const pid = v.product.id;
            if (!productMap.has(pid)) {
                productMap.set(pid, {
                    product: { id: pid, title: v.product.title },
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
            });
        }
        return Array.from(productMap.values()).slice(0, 5);
    }
    async searchAllByTitle(tenantId, term) {
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
    async searchAllByCategory(tenantId, term) {
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
    async searchAllByCategoryTrigram(tenantId, term) {
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
};
exports.AvailabilityService = AvailabilityService;
exports.AvailabilityService = AvailabilityService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_variant_entity_1.ProductVariant)),
    __param(1, (0, typeorm_1.InjectRepository)(stock_balance_entity_1.StockBalance)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], AvailabilityService);
//# sourceMappingURL=availability.service.js.map