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
exports.CatalogService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const product_entity_1 = require("./entities/product.entity");
const product_variant_entity_1 = require("./entities/product-variant.entity");
const stock_balance_entity_1 = require("./entities/stock-balance.entity");
let CatalogService = class CatalogService {
    constructor(productRepo, variantRepo, stockRepo) {
        this.productRepo = productRepo;
        this.variantRepo = variantRepo;
        this.stockRepo = stockRepo;
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
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_entity_1.Product)),
    __param(1, (0, typeorm_1.InjectRepository)(product_variant_entity_1.ProductVariant)),
    __param(2, (0, typeorm_1.InjectRepository)(stock_balance_entity_1.StockBalance)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], CatalogService);
//# sourceMappingURL=catalog.service.js.map