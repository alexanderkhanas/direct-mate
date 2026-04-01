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
exports.OrdersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const internal_api_key_guard_1 = require("../../common/guards/internal-api-key.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const orders_service_1 = require("./orders.service");
const checkout_service_1 = require("./checkout.service");
const start_checkout_dto_1 = require("./dto/start-checkout.dto");
const customer_info_dto_1 = require("./dto/customer-info.dto");
const sync_callback_dto_1 = require("./dto/sync-callback.dto");
let OrdersController = class OrdersController {
    constructor(ordersService, checkoutService) {
        this.ordersService = ordersService;
        this.checkoutService = checkoutService;
    }
    startCheckout(user, dto) {
        return this.checkoutService.start(user.tenantId, dto);
    }
    saveCustomerInfo(id, dto) {
        return this.checkoutService.saveCustomerInfo(id, dto);
    }
    createDraft(body) {
        return this.ordersService.createDraft(body.checkoutSessionId);
    }
    listOrders(user) {
        return this.ordersService.findAll(user.tenantId);
    }
    getOrder(user, id) {
        return this.ordersService.findById(id, user.tenantId);
    }
    updateStatus(user, id, body) {
        return this.ordersService.updateStatus(id, user.tenantId, body.status);
    }
    retrySync(user, id) {
        return this.ordersService.retrySync(id, user.tenantId);
    }
    handleSyncCallback(orderId, callback) {
        return this.ordersService.handleSyncCallback(orderId, callback);
    }
};
exports.OrdersController = OrdersController;
__decorate([
    (0, common_1.Post)('checkout/start'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, start_checkout_dto_1.StartCheckoutDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "startCheckout", null);
__decorate([
    (0, common_1.Patch)('checkout/:id/customer-info'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, customer_info_dto_1.CustomerInfoDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "saveCustomerInfo", null);
__decorate([
    (0, common_1.Post)('orders/draft'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "createDraft", null);
__decorate([
    (0, common_1.Get)('orders'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "listOrders", null);
__decorate([
    (0, common_1.Get)('orders/:id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "getOrder", null);
__decorate([
    (0, common_1.Patch)('orders/:id/status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "updateStatus", null);
__decorate([
    (0, common_1.Post)('orders/:id/retry-sync'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "retrySync", null);
__decorate([
    (0, common_1.Post)('internal/orders/:id/sync-callback'),
    (0, common_1.UseGuards)(internal_api_key_guard_1.InternalApiKeyGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, sync_callback_dto_1.SyncCallbackDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "handleSyncCallback", null);
exports.OrdersController = OrdersController = __decorate([
    (0, swagger_1.ApiTags)('orders'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [orders_service_1.OrdersService,
        checkout_service_1.CheckoutService])
], OrdersController);
//# sourceMappingURL=orders.controller.js.map