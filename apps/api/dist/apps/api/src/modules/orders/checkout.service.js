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
exports.CheckoutService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const checkout_session_entity_1 = require("./entities/checkout-session.entity");
const checkout_item_entity_1 = require("./entities/checkout-item.entity");
const checkout_customer_info_entity_1 = require("./entities/checkout-customer-info.entity");
const product_variant_entity_1 = require("../catalog/entities/product-variant.entity");
const shared_1 = require("@direct-mate/shared");
let CheckoutService = class CheckoutService {
    constructor(sessionRepo, itemRepo, infoRepo, variantRepo) {
        this.sessionRepo = sessionRepo;
        this.itemRepo = itemRepo;
        this.infoRepo = infoRepo;
        this.variantRepo = variantRepo;
    }
    async start(tenantId, dto) {
        const variant = await this.variantRepo.findOne({
            where: { id: dto.variantId },
            relations: ['product'],
        });
        if (!variant)
            throw new common_1.NotFoundException('Variant not found');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        const session = this.sessionRepo.create({
            tenantId,
            conversationId: dto.conversationId,
            customerId: dto.customerId,
            status: shared_1.CheckoutSessionStatus.CollectingCustomerInfo,
            expiresAt,
        });
        const saved = await this.sessionRepo.save(session);
        const item = this.itemRepo.create({
            checkoutSessionId: saved.id,
            productId: variant.productId,
            variantId: variant.id,
            qty: dto.qty,
            unitPrice: Number(variant.price),
            currency: variant.currency,
        });
        await this.itemRepo.save(item);
        return saved;
    }
    async saveCustomerInfo(checkoutId, dto) {
        const session = await this.sessionRepo.findOne({ where: { id: checkoutId } });
        if (!session)
            throw new common_1.NotFoundException('Checkout session not found');
        if (session.status === shared_1.CheckoutSessionStatus.DraftCreated) {
            throw new common_1.BadRequestException('Draft order already created');
        }
        const existing = await this.infoRepo.findOne({ where: { checkoutSessionId: checkoutId } });
        if (existing) {
            await this.infoRepo.update(existing.id, { ...dto });
        }
        else {
            const info = this.infoRepo.create({ checkoutSessionId: checkoutId, ...dto });
            await this.infoRepo.save(info);
        }
        await this.sessionRepo.update(session.id, {
            status: shared_1.CheckoutSessionStatus.ReadyForDraftOrder,
        });
        return this.sessionRepo.findOneOrFail({ where: { id: checkoutId } });
    }
    async findById(id) {
        const session = await this.sessionRepo.findOne({
            where: { id },
            relations: ['items', 'customerInfo'],
        });
        if (!session)
            throw new common_1.NotFoundException('Checkout session not found');
        return session;
    }
};
exports.CheckoutService = CheckoutService;
exports.CheckoutService = CheckoutService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(checkout_session_entity_1.CheckoutSession)),
    __param(1, (0, typeorm_1.InjectRepository)(checkout_item_entity_1.CheckoutItem)),
    __param(2, (0, typeorm_1.InjectRepository)(checkout_customer_info_entity_1.CheckoutCustomerInfo)),
    __param(3, (0, typeorm_1.InjectRepository)(product_variant_entity_1.ProductVariant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], CheckoutService);
//# sourceMappingURL=checkout.service.js.map