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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckoutSession = void 0;
const typeorm_1 = require("typeorm");
const shared_1 = require("@direct-mate/shared");
const checkout_item_entity_1 = require("./checkout-item.entity");
const checkout_customer_info_entity_1 = require("./checkout-customer-info.entity");
let CheckoutSession = class CheckoutSession {
};
exports.CheckoutSession = CheckoutSession;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], CheckoutSession.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], CheckoutSession.prototype, "tenantId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], CheckoutSession.prototype, "conversationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], CheckoutSession.prototype, "customerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', default: shared_1.CheckoutSessionStatus.CollectingCustomerInfo }),
    __metadata("design:type", String)
], CheckoutSession.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", Object)
], CheckoutSession.prototype, "reservationId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], CheckoutSession.prototype, "expiresAt", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CheckoutSession.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CheckoutSession.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => checkout_item_entity_1.CheckoutItem, (i) => i.checkoutSession),
    __metadata("design:type", Array)
], CheckoutSession.prototype, "items", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => checkout_customer_info_entity_1.CheckoutCustomerInfo, (info) => info.checkoutSession),
    __metadata("design:type", checkout_customer_info_entity_1.CheckoutCustomerInfo)
], CheckoutSession.prototype, "customerInfo", void 0);
exports.CheckoutSession = CheckoutSession = __decorate([
    (0, typeorm_1.Entity)('checkout_sessions')
], CheckoutSession);
//# sourceMappingURL=checkout-session.entity.js.map