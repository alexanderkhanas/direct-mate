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
const catalog_service_1 = require("../catalog/catalog.service");
const sync_trigger_dto_1 = require("./dto/sync-trigger.dto");
const sync_job_status_dto_1 = require("./dto/sync-job-status.dto");
const catalog_import_dto_1 = require("./dto/catalog-import.dto");
const stock_import_dto_1 = require("./dto/stock-import.dto");
const shared_1 = require("@direct-mate/shared");
let InternalController = class InternalController {
    constructor(integrationsService, catalogService) {
        this.integrationsService = integrationsService;
        this.catalogService = catalogService;
    }
    async verifyConnectionOwnership(connectionId, tenantId) {
        if (!connectionId)
            return;
        const conn = await this.integrationsService.findById(connectionId);
        if (!conn || conn.tenantId !== tenantId) {
            throw new common_1.ForbiddenException('Connection does not belong to the specified tenant');
        }
    }
    async syncCatalog(dto) {
        if (dto.connectionId) {
            await this.verifyConnectionOwnership(dto.connectionId, dto.tenantId);
        }
        const job = await this.integrationsService.queueSyncJob(dto.tenantId, dto.connectionId ?? '', shared_1.SyncType.Catalog, dto.mode);
        return { jobId: job.id, accepted: true };
    }
    async syncStock(dto) {
        if (dto.connectionId) {
            await this.verifyConnectionOwnership(dto.connectionId, dto.tenantId);
        }
        const job = await this.integrationsService.queueSyncJob(dto.tenantId, dto.connectionId ?? '', shared_1.SyncType.Stock, dto.mode);
        return { jobId: job.id, accepted: true };
    }
    async catalogImport(dto) {
        await this.verifyConnectionOwnership(dto.connectionId, dto.tenantId);
        const job = await this.integrationsService.queueSyncJob(dto.tenantId, dto.connectionId, shared_1.SyncType.Catalog, 'full');
        await this.integrationsService.markJobRunning(job.id);
        try {
            const result = await this.catalogService.importCatalog(dto.tenantId, dto.products);
            await this.integrationsService.markJobDone(job.id, result);
            return { success: true, jobId: job.id, ...result };
        }
        catch (err) {
            await this.integrationsService.markJobFailed(job.id, err.message);
            return { success: false, jobId: job.id, error: err.message };
        }
    }
    async stockImport(dto) {
        await this.verifyConnectionOwnership(dto.connectionId, dto.tenantId);
        const job = await this.integrationsService.queueSyncJob(dto.tenantId, dto.connectionId, shared_1.SyncType.Stock, 'full');
        await this.integrationsService.markJobRunning(job.id);
        try {
            const result = await this.catalogService.importStock(dto.tenantId, dto.items);
            await this.integrationsService.markJobDone(job.id, result);
            return { success: true, jobId: job.id, ...result };
        }
        catch (err) {
            await this.integrationsService.markJobFailed(job.id, err.message);
            return { success: false, jobId: job.id, error: err.message };
        }
    }
    async updateSyncJob(id, dto) {
        await this.integrationsService.updateJobStatus(id, dto.status, dto.summary, dto.errorMessage);
        return { updated: true };
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
__decorate([
    (0, common_1.Post)('sync/catalog-import'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [catalog_import_dto_1.CatalogImportDto]),
    __metadata("design:returntype", Promise)
], InternalController.prototype, "catalogImport", null);
__decorate([
    (0, common_1.Post)('sync/stock-import'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [stock_import_dto_1.StockImportDto]),
    __metadata("design:returntype", Promise)
], InternalController.prototype, "stockImport", null);
__decorate([
    (0, common_1.Patch)('sync/jobs/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, sync_job_status_dto_1.SyncJobStatusDto]),
    __metadata("design:returntype", Promise)
], InternalController.prototype, "updateSyncJob", null);
exports.InternalController = InternalController = __decorate([
    (0, swagger_1.ApiTags)('internal'),
    (0, common_1.UseGuards)(internal_api_key_guard_1.InternalApiKeyGuard),
    (0, common_1.Controller)('internal'),
    __metadata("design:paramtypes", [integrations_service_1.IntegrationsService,
        catalog_service_1.CatalogService])
], InternalController);
//# sourceMappingURL=internal.controller.js.map