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
const config_1 = require("@nestjs/config");
const typeorm_2 = require("typeorm");
const order_entity_1 = require("./entities/order.entity");
const order_item_entity_1 = require("./entities/order-item.entity");
const checkout_session_entity_1 = require("./entities/checkout-session.entity");
const checkout_item_entity_1 = require("./entities/checkout-item.entity");
const checkout_customer_info_entity_1 = require("./entities/checkout-customer-info.entity");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const connection_entity_1 = require("../integrations/entities/connection.entity");
const shared_1 = require("@direct-mate/shared");
const product_entity_1 = require("../catalog/entities/product.entity");
const product_variant_entity_1 = require("../catalog/entities/product-variant.entity");
let OrdersService = OrdersService_1 = class OrdersService {
    constructor(orderRepo, orderItemRepo, sessionRepo, checkoutItemRepo, customerInfoRepo, settingsRepo, connectionRepo, dataSource, config) {
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.sessionRepo = sessionRepo;
        this.checkoutItemRepo = checkoutItemRepo;
        this.customerInfoRepo = customerInfoRepo;
        this.settingsRepo = settingsRepo;
        this.connectionRepo = connectionRepo;
        this.dataSource = dataSource;
        this.config = config;
        this.logger = new common_1.Logger(OrdersService_1.name);
    }
    async createFromConversation(payload) {
        return this.dataSource.transaction(async (manager) => {
            const session = manager.create(checkout_session_entity_1.CheckoutSession, {
                tenantId: payload.tenantId,
                conversationId: payload.conversationId,
                customerId: payload.customerId,
                status: shared_1.CheckoutSessionStatus.ReadyForDraftOrder,
            });
            const savedSession = await manager.save(session);
            const customerInfo = manager.create(checkout_customer_info_entity_1.CheckoutCustomerInfo, {
                checkoutSessionId: savedSession.id,
                fullName: payload.customerInfo.fullName,
                phone: payload.customerInfo.phone,
                city: payload.customerInfo.city,
                branch: payload.customerInfo.deliveryBranch,
                paymentMethod: payload.customerInfo.paymentMethod ?? null,
                comment: payload.customerInfo.comment ?? null,
            });
            await manager.save(customerInfo);
            for (const item of payload.items) {
                const checkoutItem = manager.create(checkout_item_entity_1.CheckoutItem, {
                    checkoutSessionId: savedSession.id,
                    productId: item.productId,
                    variantId: item.variantId,
                    qty: item.quantity,
                    unitPrice: item.unitPrice,
                    currency: item.currency,
                });
                await manager.save(checkoutItem);
            }
            const total = payload.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
            const order = manager.create(order_entity_1.Order, {
                tenantId: payload.tenantId,
                checkoutSessionId: savedSession.id,
                customerId: payload.customerId,
                status: shared_1.OrderStatus.AwaitingManagerConfirmation,
                totalAmount: total,
                currency: payload.items[0]?.currency ?? 'UAH',
                source: payload.source,
                externalSyncStatus: 'none',
            });
            const savedOrder = await manager.save(order);
            for (const item of payload.items) {
                const orderItem = manager.create(order_item_entity_1.OrderItem, {
                    orderId: savedOrder.id,
                    productId: item.productId,
                    variantId: item.variantId,
                    qty: item.quantity,
                    unitPrice: item.unitPrice,
                    currency: item.currency,
                });
                await manager.save(orderItem);
            }
            await manager.update(checkout_session_entity_1.CheckoutSession, savedSession.id, {
                status: shared_1.CheckoutSessionStatus.DraftCreated,
            });
            this.notifyManager(savedOrder).catch((err) => this.logger.error(`Manager notification failed for order ${savedOrder.id}`, err));
            return savedOrder;
        });
    }
    async triggerExternalSync(order) {
        const connection = await this.connectionRepo.findOne({
            where: [
                {
                    tenantId: order.tenantId,
                    type: shared_1.ConnectionType.Shopify,
                    status: shared_1.ConnectionStatus.Connected,
                },
            ],
        });
        if (!connection) {
            this.logger.warn(`No connected store platform for tenant ${order.tenantId}, skipping external sync`);
            return;
        }
        const n8nWebhookUrl = this.config.get('n8n.orderSyncWebhookUrl');
        if (!n8nWebhookUrl) {
            this.logger.warn('n8n.orderSyncWebhookUrl not configured, skipping external sync');
            return;
        }
        const idempotencyKey = `order-${order.id}-sync-1`;
        const platform = connection.type;
        const orderItems = await this.dataSource
            .getRepository(order_item_entity_1.OrderItem)
            .find({ where: { orderId: order.id } });
        const items = [];
        for (const item of orderItems) {
            const variant = await this.dataSource
                .getRepository(product_variant_entity_1.ProductVariant)
                .findOne({ where: { id: item.variantId } });
            const product = await this.dataSource
                .getRepository(product_entity_1.Product)
                .findOne({ where: { id: item.productId } });
            items.push({
                externalVariantId: variant?.externalVariantId ?? '',
                title: product?.title ?? 'Unknown',
                quantity: item.qty,
                unitPrice: item.unitPrice,
            });
        }
        const checkoutInfo = order.checkoutSessionId
            ? await this.customerInfoRepo.findOne({
                where: { checkoutSessionId: order.checkoutSessionId },
            })
            : null;
        const backendBaseUrl = 'http://host.docker.internal:3000';
        const callbackUrl = `${backendBaseUrl}/internal/orders/${order.id}/sync-callback`;
        const resolveCredentialsUrl = `${backendBaseUrl}/internal/connections/resolve-credentials`;
        await this.orderRepo.update(order.id, {
            externalSyncStatus: 'pending',
            externalSyncTriggeredAt: new Date(),
        });
        try {
            const res = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: order.id,
                    connectionId: connection.id,
                    tenantId: order.tenantId,
                    platform,
                    idempotencyKey,
                    callbackUrl,
                    resolveCredentialsUrl,
                    order: {
                        items,
                        customer: {
                            fullName: checkoutInfo?.fullName ?? '',
                            phone: checkoutInfo?.phone ?? '',
                            email: '',
                            city: checkoutInfo?.city ?? '',
                            deliveryBranch: checkoutInfo?.branch ?? '',
                        },
                        note: `DirectMate order from Instagram DM`,
                    },
                }),
            });
            if (!res.ok) {
                const body = await res.text();
                this.logger.error(`n8n order sync webhook failed: ${res.status} — ${body}`);
            }
            else {
                this.logger.log(`External sync triggered for order ${order.id} on ${platform}`);
            }
        }
        catch (err) {
            this.logger.error(`External sync trigger failed for order ${order.id}`, err.message);
        }
    }
    async retrySync(orderId, tenantId) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, tenantId } });
        if (!order)
            throw new common_1.NotFoundException(`Order ${orderId} not found`);
        await this.orderRepo.update(orderId, { externalSyncStatus: 'none' });
        this.triggerExternalSync(order).catch(err => this.logger.error(`Retry sync failed for order ${orderId}`, err.message));
        return { ok: true };
    }
    async handleSyncCallback(orderId, callback) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) {
            throw new common_1.NotFoundException(`Order ${orderId} not found`);
        }
        if (order.externalSyncStatus === 'synced') {
            this.logger.log(`Order ${orderId} already synced, skipping callback`);
            return;
        }
        const expectedKey = `order-${order.id}-sync-1`;
        if (callback.idempotencyKey !== expectedKey) {
            this.logger.warn(`Idempotency key mismatch for order ${orderId}: expected ${expectedKey}, got ${callback.idempotencyKey}`);
            return;
        }
        if (callback.status === 'success') {
            await this.orderRepo.update(order.id, {
                externalSyncStatus: 'synced',
                externalOrderId: callback.externalOrderId ?? null,
                externalOrderMetadata: {
                    externalOrderUrl: callback.externalOrderUrl,
                    ...callback.metadata,
                },
                externalSyncCompletedAt: new Date(),
            });
            this.logger.log(`Order ${orderId} synced to ${callback.platform}, external ID: ${callback.externalOrderId}`);
        }
        else {
            await this.orderRepo.update(order.id, {
                externalSyncStatus: 'failed',
                externalOrderMetadata: {
                    error: callback.error,
                    ...callback.metadata,
                },
                externalSyncCompletedAt: new Date(),
            });
            this.logger.error(`Order ${orderId} sync failed on ${callback.platform}: ${callback.error?.message ?? 'unknown error'}`);
        }
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
        const settings = await this.settingsRepo.findOne({
            where: { tenantId: order.tenantId },
        });
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
        const orders = await this.orderRepo.find({
            where: { tenantId },
            relations: ['items'],
            order: { createdAt: 'DESC' },
        });
        return Promise.all(orders.map((order) => this.enrichOrder(order)));
    }
    async findById(id) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: ['items'],
        });
        if (!order)
            throw new common_1.NotFoundException(`Order ${id} not found`);
        return this.enrichOrder(order);
    }
    async updateStatus(id, tenantId, status) {
        const order = await this.orderRepo.findOne({
            where: { id, tenantId },
        });
        if (!order)
            throw new common_1.NotFoundException(`Order ${id} not found`);
        order.status = status;
        const saved = await this.orderRepo.save(order);
        if (status === shared_1.OrderStatus.Confirmed) {
            this.triggerExternalSync(saved).catch((err) => this.logger.error(`External sync failed for order ${saved.id}`, err.message));
        }
        return saved;
    }
    async enrichOrder(order) {
        let customer = null;
        if (order.checkoutSessionId) {
            const info = await this.customerInfoRepo.findOne({
                where: { checkoutSessionId: order.checkoutSessionId },
            });
            if (info) {
                customer = {
                    fullName: info.fullName,
                    phone: info.phone,
                    city: info.city,
                    branch: info.branch,
                };
            }
        }
        const enrichedItems = await Promise.all((order.items ?? []).map(async (item) => {
            const product = await this.dataSource
                .getRepository(product_entity_1.Product)
                .findOne({ where: { id: item.productId } });
            const variant = await this.dataSource
                .getRepository(product_variant_entity_1.ProductVariant)
                .findOne({ where: { id: item.variantId } });
            const variantParts = [variant?.color, variant?.size].filter(Boolean);
            return {
                id: item.id,
                productId: item.productId,
                variantId: item.variantId,
                qty: item.qty,
                unitPrice: item.unitPrice,
                currency: item.currency,
                productTitle: product?.title ?? null,
                variantTitle: variantParts.length > 0 ? variantParts.join(' / ') : null,
            };
        }));
        return {
            id: order.id,
            tenantId: order.tenantId,
            status: order.status,
            totalAmount: order.totalAmount,
            currency: order.currency,
            source: order.source,
            externalOrderId: order.externalOrderId,
            externalSyncStatus: order.externalSyncStatus,
            externalOrderMetadata: order.externalOrderMetadata,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            customer,
            items: enrichedItems,
        };
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = OrdersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(order_entity_1.Order)),
    __param(1, (0, typeorm_1.InjectRepository)(order_item_entity_1.OrderItem)),
    __param(2, (0, typeorm_1.InjectRepository)(checkout_session_entity_1.CheckoutSession)),
    __param(3, (0, typeorm_1.InjectRepository)(checkout_item_entity_1.CheckoutItem)),
    __param(4, (0, typeorm_1.InjectRepository)(checkout_customer_info_entity_1.CheckoutCustomerInfo)),
    __param(5, (0, typeorm_1.InjectRepository)(tenant_settings_entity_1.TenantSettings)),
    __param(6, (0, typeorm_1.InjectRepository)(connection_entity_1.Connection)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource,
        config_1.ConfigService])
], OrdersService);
//# sourceMappingURL=orders.service.js.map