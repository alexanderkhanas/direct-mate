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
exports.CheckoutCustomerInfo = void 0;
const typeorm_1 = require("typeorm");
const checkout_session_entity_1 = require("./checkout-session.entity");
let CheckoutCustomerInfo = class CheckoutCustomerInfo {
};
exports.CheckoutCustomerInfo = CheckoutCustomerInfo;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], CheckoutCustomerInfo.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', unique: true }),
    __metadata("design:type", String)
], CheckoutCustomerInfo.prototype, "checkoutSessionId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "fullName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "phone", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "city", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "deliveryProvider", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "branch", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "paymentMethod", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CheckoutCustomerInfo.prototype, "comment", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CheckoutCustomerInfo.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CheckoutCustomerInfo.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => checkout_session_entity_1.CheckoutSession, (s) => s.customerInfo, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'checkout_session_id' }),
    __metadata("design:type", checkout_session_entity_1.CheckoutSession)
], CheckoutCustomerInfo.prototype, "checkoutSession", void 0);
exports.CheckoutCustomerInfo = CheckoutCustomerInfo = __decorate([
    (0, typeorm_1.Entity)('checkout_customer_info')
], CheckoutCustomerInfo);
//# sourceMappingURL=checkout-customer-info.entity.js.map