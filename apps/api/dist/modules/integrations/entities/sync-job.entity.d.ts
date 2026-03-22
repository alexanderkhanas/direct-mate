import { SyncJobStatus, SyncMode, SyncType } from '@direct-mate/shared';
export declare class SyncJob {
    id: string;
    tenantId: string;
    connectionId: string | null;
    syncType: SyncType;
    mode: SyncMode;
    status: SyncJobStatus;
    startedAt: Date | null;
    finishedAt: Date | null;
    summary: Record<string, unknown> | null;
    errorMessage: string | null;
    createdAt: Date;
}
