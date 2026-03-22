import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { IntegrationEvent } from './entities/integration-event.entity';
import { AuditLogStatus, AuditLogType } from '@direct-mate/shared';
export interface LogParams {
    tenantId: string;
    conversationId?: string;
    type: AuditLogType;
    status?: AuditLogStatus;
    details?: Record<string, unknown>;
}
export declare class AuditService {
    private readonly auditRepo;
    private readonly eventRepo;
    constructor(auditRepo: Repository<AuditLog>, eventRepo: Repository<IntegrationEvent>);
    log(params: LogParams): Promise<AuditLog>;
    getConversationLogs(conversationId: string): Promise<AuditLog[]>;
    recordIntegrationEvent(params: {
        tenantId: string;
        connectionId?: string;
        eventType: string;
        externalEventId?: string;
        payload?: Record<string, unknown>;
    }): Promise<IntegrationEvent>;
    markEventProcessed(id: string): Promise<void>;
}
