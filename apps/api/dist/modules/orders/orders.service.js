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
var OrdersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const order_entity_1 = require("./entities/order.entity");
const order_item_entity_1 = require("./entities/order-item.entity");
const checkout_session_entity_1 = require("./entities/checkout-session.entity");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const shared_1 = require("@direct-mate/shared");
let OrdersService = OrdersService_1 = class OrdersService {
    constructor(orderRepo, orderItemRepo, sessionRepo, settingsRepo) {
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.sessionRepo = sessionRepo;
        this.settingsRepo = settingsRepo;
        this.logger = new common_1.Logger(OrdersService_1.name);
    }
    async createDraft(checkoutSessionId) {
        const session = await this.sessionRepo.findOne({
            where: { id: checkoutSessionId },
            relations: ['items', 'customerInfo'],
        });
        if (!session)
            throw new common_1.NotFoundException('Checkout session not found');
        if (session.status !== shared_1.CheckoutSessionStatus.ReadyForDraftOrder) {
            throw new common_1.BadRequestException(`Session status is ${session.status}, expected ready_for_draft_order`);
        }
        if (!session.customerInfo) {
            throw new common_1.BadRequestException('Customer info is required before creating draft order');
        }
        const total = session.items.reduce((sum, i) => sum + Number(i.unitPrice) * i.qty, 0);
        const order = this.orderRepo.create({
            tenantId: session.tenantId,
            checkoutSessionId: session.id,
            customerId: session.customerId,
            status: shared_1.OrderStatus.AwaitingManagerConfirmation,
            totalAmount: total,
            currency: session.items[0]?.currency ?? 'UAH',
        });
        const saved = await this.orderRepo.save(order);
        for (const item of session.items) {
            const oi = this.orderItemRepo.create({
                orderId: saved.id,
                productId: item.productId,
                variantId: item.variantId,
                qty: item.qty,
                unitPrice: item.unitPrice,
                currency: item.currency,
            });
            await this.orderItemRepo.save(oi);
        }
        await this.sessionRepo.update(session.id, {
            status: shared_1.CheckoutSessionStatus.DraftCreated,
        });
        this.notifyManager(saved).catch((err) => this.logger.error(`Manager notification failed for order ${saved.id}`, err));
        return saved;
    }
    async notifyManager(order) {
        const settings = await this.settingsRepo.findOne({ where: { tenantId: order.tenantId } });
        const webhookUrl = settings?.aiSettings?.notificationWebhookUrl;
        if (!webhookUrl)
            return;
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId: order.id,
                customerId: order.customerId,
                conversationId: order.checkoutSessionId,
                totalAmount: order.totalAmount,
                status: order.status,
            }),
        });
        if (!res.ok) {
            throw new Error(`Webhook responded with ${res.status}`);
        }
    }
    async findAll(tenantId) {
        return this.orderRepo.find({
            where: { tenantId },
            relations: ['items'],
            order: { createdAt: 'DESC' },
        });
    }
    async findById(id) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: ['items'],
        });
        if (!order)
            throw new common_1.NotFoundException(`Order ${id} not found`);
        return order;
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = OrdersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(1, (0, typeorm_1.InjectRepository)(order_item_entity_1.OrderItem)),
    __param(2, (0, typeorm_1.InjectRepository)(checkout_session_entity_1.CheckoutSession)),
    __param(3, (0, typeorm_1.InjectRepository)(tenant_settings_entity_1.TenantSettings)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], OrdersService);
//# sourceMappingURL=orders.service.js.map