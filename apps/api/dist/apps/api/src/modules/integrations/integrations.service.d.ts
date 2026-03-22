import { Repository } from 'typeorm';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
export declare class IntegrationsService {
    private readonly connectionRepo;
    private readonly syncJobRepo;
    constructor(connectionRepo: Repository<Connection>, syncJobRepo: Repository<SyncJob>);
    findAll(tenantId: string): Promise<Connection[]>;
    disconnect(id: string): Promise<void>;
    queueSyncJob(tenantId: string, connectionId: string, syncType: string, mode: string): Promise<SyncJob>;
    markJobRunning(jobId: string): Promise<void>;
    markJobDone(jobId: string, summary: Record<string, unknown>): Promise<void>;
    markJobFailed(jobId: string, error: string): Promise<void>;
}
