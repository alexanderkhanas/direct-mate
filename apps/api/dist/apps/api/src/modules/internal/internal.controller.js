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
exports.InternalController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const internal_api_key_guard_1 = require("../../common/guards/internal-api-key.guard");
const integrations_service_1 = require("../integrations/integrations.service");
const sync_trigger_dto_1 = require("./dto/sync-trigger.dto");
const shared_1 = require("@direct-mate/shared");
let InternalController = class InternalController {
    constructor(integrationsService) {
        this.integrationsService = integrationsService;
    }
    async syncCatalog(dto) {
        const job = await this.integrationsService.queueSyncJob(dto.tenantId, dto.connectionId ?? '', shared_1.SyncType.Catalog, dto.mode);
        return { jobId: job.id, accepted: true };
    }
    async syncStock(dto) {
        const job = await this.integrationsService.queueSyncJob(dto.tenantId, dto.connectionId ?? '', shared_1.SyncType.Stock, dto.mode);
        return { jobId: job.id, accepted: true };
    }
};
exports.InternalController = InternalController;
__decorate([
    (0, common_1.Post)('sync/catalog'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sync_trigger_dto_1.SyncTriggerDto]),
    __metadata("design:returntype", Promise)
], InternalController.prototype, "syncCatalog", null);
__decorate([
    (0, common_1.Post)('sync/stock'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sync_trigger_dto_1.SyncTriggerDto]),
    __metadata("design:returntype", Promise)
], InternalController.prototype, "syncStock", null);
exports.InternalController = InternalController = __decorate([
    (0, swagger_1.ApiTags)('internal'),
    (0, common_1.UseGuards)(internal_api_key_guard_1.InternalApiKeyGuard),
    (0, common_1.Controller)('internal'),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService])
], InternalController);
//# sourceMappingURL=internal.controller.js.map