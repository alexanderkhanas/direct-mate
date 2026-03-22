import { ConnectionStatus, ConnectionType } from '@direct-mate/shared';
export declare class Connection {
    id: string;
    tenantId: string;
    type: ConnectionType;
    status: ConnectionStatus;
    externalAccountId: string | null;
    accessTokenEncrypted: string | null;
    refreshTokenEncrypted: string | null;
    metadata: Record<string, unknown> | null;
    lastSyncAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
