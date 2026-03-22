import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
import { ConnectionStatus, ConnectionType } from '@direct-mate/shared';
import { CryptoService } from '../../common/crypto.service';

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(Connection)
    private readonly connectionRepo: Repository<Connection>,
    @InjectRepository(SyncJob)
    private readonly syncJobRepo: Repository<SyncJob>,
    private readonly crypto: CryptoService,
  ) {}

  async connectInstagram(
    tenantId: string,
    pageId: string,
    accessToken: string,
    accountName?: string,
  ): Promise<Connection> {
    let conn = await this.connectionRepo.findOne({
      where: { tenantId, type: ConnectionType.Instagram },
    });

    const encrypted = this.crypto.encrypt(accessToken);

    if (conn) {
      await this.connectionRepo.update(conn.id, {
        externalAccountId: pageId,
        accessTokenEncrypted: encrypted,
        status: ConnectionStatus.Connected,
        metadata: accountName ? { accountName } : (conn.metadata ?? null),
      } as any);
      return this.connectionRepo.findOne({ where: { id: conn.id } }) as Promise<Connection>;
    }

    conn = this.connectionRepo.create({
      tenantId,
      type: ConnectionType.Instagram,
      status: ConnectionStatus.Connected,
      externalAccountId: pageId,
      accessTokenEncrypted: encrypted,
      metadata: accountName ? { accountName } : null,
    });
    return this.connectionRepo.save(conn);
  }

  async connectShopify(
    tenantId: string,
    shopDomain: string,
    accessToken: string,
    shopName?: string,
  ): Promise<Connection> {
    let conn = await this.connectionRepo.findOne({
      where: { tenantId, type: ConnectionType.Shopify },
    });

    const encrypted = this.crypto.encrypt(accessToken);

    if (conn) {
      await this.connectionRepo.update(conn.id, {
        externalAccountId: shopDomain,
        accessTokenEncrypted: encrypted,
        status: ConnectionStatus.Connected,
        metadata: shopName ? { shopName, shopDomain } : { shopDomain },
      } as any);
      return this.connectionRepo.findOne({ where: { id: conn.id } }) as Promise<Connection>;
    }

    conn = this.connectionRepo.create({
      tenantId,
      type: ConnectionType.Shopify,
      status: ConnectionStatus.Connected,
      externalAccountId: shopDomain,
      accessTokenEncrypted: encrypted,
      metadata: shopName ? { shopName, shopDomain } : { shopDomain },
    });
    return this.connectionRepo.save(conn);
  }

  async getDecryptedToken(connectionId: string): Promise<string> {
    const conn = await this.connectionRepo.findOne({ where: { id: connectionId } });
    if (!conn || !conn.accessTokenEncrypted) {
      throw new NotFoundException('Connection or token not found');
    }
    return this.crypto.decrypt(conn.accessTokenEncrypted);
  }

  async findAll(tenantId: string): Promise<Connection[]> {
    return this.connectionRepo.find({ where: { tenantId } });
  }

  async findByExternalAccountId(
    externalAccountId: string,
    type: ConnectionType,
  ): Promise<Connection | null> {
    return this.connectionRepo.findOne({
      where: { externalAccountId, type, status: ConnectionStatus.Connected },
    });
  }

  async disconnect(id: string): Promise<void> {
    const conn = await this.connectionRepo.findOne({ where: { id } });
    if (!conn) throw new NotFoundException('Connection not found');
    await this.connectionRepo.update(id, {
      status: ConnectionStatus.Disconnected,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
  }

  async queueSyncJob(
    tenantId: string,
    connectionId: string,
    syncType: string,
    mode: string,
  ): Promise<SyncJob> {
    const job = this.syncJobRepo.create({
      tenantId,
      connectionId,
      syncType: syncType as any,
      mode: mode as any,
    });
    return this.syncJobRepo.save(job);
  }

  async markJobRunning(jobId: string): Promise<void> {
    await this.syncJobRepo.update(jobId, { status: 'running' as any, startedAt: new Date() });
  }

  async markJobDone(jobId: string, summary: Record<string, unknown>): Promise<void> {
    await this.syncJobRepo.update(jobId, {
      status: 'success' as any,
      finishedAt: new Date(),
      summary,
    } as any);
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.syncJobRepo.update(jobId, {
      status: 'failed' as any,
      finishedAt: new Date(),
      errorMessage: error,
    });
  }

  async updateJobStatus(
    jobId: string,
    status: 'success' | 'failed',
    summary?: string,
    errorMessage?: string,
  ): Promise<void> {
    const job = await this.syncJobRepo.findOne({ where: { id: jobId } });
    if (!job) return;

    if (status === 'success') {
      await this.syncJobRepo.update(jobId, {
        status: 'success' as any,
        finishedAt: new Date(),
        summary: summary ? { text: summary } : null,
      } as any);

      if (job.connectionId) {
        await this.connectionRepo.update(job.connectionId, { lastSyncAt: new Date() });
      }
    } else {
      await this.syncJobRepo.update(jobId, {
        status: 'failed' as any,
        finishedAt: new Date(),
        errorMessage: errorMessage ?? null,
      });
    }
  }
}
