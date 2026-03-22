import { AuditService } from './audit.service';
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    getConversationLogs(id: string): Promise<import("./entities/audit-log.entity").AuditLog[]>;
}
