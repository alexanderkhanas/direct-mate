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
exports.IntegrationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const connection_entity_1 = require("./entities/connection.entity");
const sync_job_entity_1 = require("./entities/sync-job.entity");
const shared_1 = require("@direct-mate/shared");
let IntegrationsService = class IntegrationsService {
    constructor(connectionRepo, syncJobRepo) {
        this.connectionRepo = connectionRepo;
        this.syncJobRepo = syncJobRepo;
    }
    async findAll(tenantId) {
        return this.connectionRepo.find({ where: { tenantId } });
    }
    async disconnect(id) {
        const conn = await this.connectionRepo.findOne({ where: { id } });
        if (!conn)
            throw new common_1.NotFoundException('Connection not found');
        await this.connectionRepo.update(id, {
            status: shared_1.ConnectionStatus.Disconnected,
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
        });
    }
    async queueSyncJob(tenantId, connectionId, syncType, mode) {
        const job = this.syncJobRepo.create({
            tenantId,
            connectionId,
            syncType: syncType,
            mode: mode,
        });
        return this.syncJobRepo.save(job);
    }
    async markJobRunning(jobId) {
        await this.syncJobRepo.update(jobId, { status: 'running', startedAt: new Date() });
    }
    async markJobDone(jobId, summary) {
        await this.syncJobRepo.update(jobId, {
            status: 'success',
            finishedAt: new Date(),
            summary,
        });
    }
    async markJobFailed(jobId, error) {
        await this.syncJobRepo.update(jobId, {
            status: 'failed',
            finishedAt: new Date(),
            errorMessage: error,
        });
    }
};
exports.IntegrationsService = IntegrationsService;
exports.IntegrationsService = IntegrationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(connection_entity_1.Connection)),
    __param(1, (0, typeorm_1.InjectRepository)(sync_job_entity_1.SyncJob)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], IntegrationsService);
//# sourceMappingURL=integrations.service.js.map