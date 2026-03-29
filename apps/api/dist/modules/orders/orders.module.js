"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const checkout_session_entity_1 = require("./entities/checkout-session.entity");
const checkout_item_entity_1 = require("./entities/checkout-item.entity");
const checkout_customer_info_entity_1 = require("./entities/checkout-customer-info.entity");
const order_entity_1 = require("./entities/order.entity");
const order_item_entity_1 = require("./entities/order-item.entity");
const product_entity_1 = require("../catalog/entities/product.entity");
const product_variant_entity_1 = require("../catalog/entities/product-variant.entity");
const tenant_settings_entity_1 = require("../tenants/entities/tenant-settings.entity");
const connection_entity_1 = require("../integrations/entities/connection.entity");
const orders_service_1 = require("./orders.service");
const checkout_service_1 = require("./checkout.service");
const orders_controller_1 = require("./orders.controller");
let OrdersModule = class OrdersModule {
};
exports.OrdersModule = OrdersModule;
exports.OrdersModule = OrdersModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                checkout_session_entity_1.CheckoutSession,
                checkout_item_entity_1.CheckoutItem,
                checkout_customer_info_entity_1.CheckoutCustomerInfo,
                order_entity_1.Order,
                order_item_entity_1.OrderItem,
                product_entity_1.Product,
                product_variant_entity_1.ProductVariant,
                tenant_settings_entity_1.TenantSettings,
                connection_entity_1.Connection,
            ]),
        ],
        controllers: [orders_controller_1.OrdersController],
        providers: [orders_service_1.OrdersService, checkout_service_1.CheckoutService],
        exports: [orders_service_1.OrdersService, checkout_service_1.CheckoutService],
    })
], OrdersModule);
//# sourceMappingURL=orders.module.js.map