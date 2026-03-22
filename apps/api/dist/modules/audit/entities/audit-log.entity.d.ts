import { AuditLogStatus, AuditLogType } from '@direct-mate/shared';
export declare class AuditLog {
    id: string;
    tenantId: string;
    conversationId: string | null;
    type: AuditLogType;
    status: AuditLogStatus;
    details: Record<string, unknown> | null;
    createdAt: Date;
}
