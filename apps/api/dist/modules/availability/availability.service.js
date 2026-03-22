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
    async check(tenantId, dto) {
        const searchTerms = this.extractSearchTerms(dto.query);
        if (searchTerms.length === 0) {
            return { matchType: 'none', product: null, variant: null, stock: null };
        }
        const searches = [
            searchTerms.join(' '),
            ...searchTerms,
        ];
        let variant = null;
        for (const term of searches) {
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
            variant = await qb.getOne();
            if (variant)
                break;
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