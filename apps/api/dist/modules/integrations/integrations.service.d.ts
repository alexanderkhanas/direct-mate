import { Repository } from 'typeorm';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
import { ConnectionType } from '@direct-mate/shared';
import { CryptoService } from '../../common/crypto.service';
export declare class IntegrationsService {
    private readonly connectionRepo;
    private readonly syncJobRepo;
    private readonly crypto;
    constructor(connectionRepo: Repository<Connection>, syncJobRepo: Repository<SyncJob>, crypto: CryptoService);
    connectInstagram(tenantId: string, pageId: string, accessToken: string, accountName?: string): Promise<Connection>;
    connectShopify(tenantId: string, shopDomain: string, accessToken: string, shopName?: string): Promise<Connection>;
    getDecryptedToken(connectionId: string): Promise<string>;
    findAll(tenantId: string): Promise<Connection[]>;
    findByExternalAccountId(externalAccountId: string, type: ConnectionType): Promise<Connection | null>;
    disconnect(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    queueSyncJob(tenantId: string, connectionId: string, syncType: string, mode: string): Promise<SyncJob>;
    markJobRunning(jobId: string): Promise<void>;
    markJobDone(jobId: string, summary: Record<string, unknown>): Promise<void>;
    markJobFailed(jobId: string, error: string): Promise<void>;
    updateJobStatus(jobId: string, status: 'success' | 'failed', summary?: string, errorMessage?: string): Promise<void>;
    private readonly ALLOWED_PURPOSES;
    resolveCredentials(dto: {
        connectionId: string;
        tenantId: string;
        platform: string;
        purpose: string;
    }): Promise<{
        type: string;
        shopDomain: any;
        accessToken: string;
        apiVersion: string;
        externalAccountId?: undefined;
        metadata?: undefined;
    } | {
        type: ConnectionType;
        externalAccountId: string | null;
        accessToken: string;
        metadata: Record<string, any>;
        shopDomain?: undefined;
        apiVersion?: undefined;
    }>;
}
