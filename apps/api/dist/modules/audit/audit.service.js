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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const audit_log_entity_1 = require("./entities/audit-log.entity");
const integration_event_entity_1 = require("./entities/integration-event.entity");
const shared_1 = require("@direct-mate/shared");
let AuditService = class AuditService {
    constructor(auditRepo, eventRepo) {
        this.auditRepo = auditRepo;
        this.eventRepo = eventRepo;
    }
    async log(params) {
        const entry = this.auditRepo.create({
            tenantId: params.tenantId,
            conversationId: params.conversationId,
            type: params.type,
            status: params.status ?? shared_1.AuditLogStatus.Success,
            details: params.details,
        });
        return this.auditRepo.save(entry);
    }
    async getConversationLogs(conversationId) {
        return this.auditRepo.find({
            where: { conversationId },
            order: { createdAt: 'ASC' },
        });
    }
    async recordIntegrationEvent(params) {
        const event = this.eventRepo.create({
            tenantId: params.tenantId,
            connectionId: params.connectionId,
            eventType: params.eventType,
            externalEventId: params.externalEventId,
            payload: params.payload,
        });
        return this.eventRepo.save(event);
    }
    async markEventProcessed(id) {
        await this.eventRepo.update(id, { processed: true, processedAt: new Date() });
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(audit_log_entity_1.AuditLog)),
    __param(1, (0, typeorm_1.InjectRepository)(integration_event_entity_1.IntegrationEvent)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], AuditService);
//# sourceMappingURL=audit.service.js.map