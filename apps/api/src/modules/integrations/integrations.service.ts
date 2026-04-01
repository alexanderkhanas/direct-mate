import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
import { TelegramConnectToken } from '../notifications/entities/telegram-connect-token.entity';
import { ConnectionStatus, ConnectionType } from '@direct-mate/shared';
import { CryptoService } from '../../common/crypto.service';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(Connection)
    private readonly connectionRepo: Repository<Connection>,
    @InjectRepository(SyncJob)
    private readonly syncJobRepo: Repository<SyncJob>,
    @InjectRepository(TelegramConnectToken)
    private readonly connectTokenRepo: Repository<TelegramConnectToken>,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async connectInstagram(
    tenantId: string,
    pageId: string,
    accessToken: string,
    accountName?: string,
  ): Promise<Connection> {
    // Exchange short-lived token for long-lived (60 days)
    let finalToken = accessToken;
    let tokenExpiresAt: Date | null = null;

    try {
      const exchanged = await this.exchangeForLongLivedToken(accessToken);
      finalToken = exchanged.token;
      tokenExpiresAt = exchanged.expiresAt;
      this.logger.log(`Instagram token exchanged: expires ${tokenExpiresAt.toISOString()}`);
    } catch (err) {
      this.logger.warn(`Token exchange failed, using original token: ${(err as Error).message}`);
    }

    const encrypted = this.crypto.encrypt(finalToken);

    let conn = await this.connectionRepo.findOne({
      where: { tenantId, type: ConnectionType.Instagram },
    });

    if (conn) {
      await this.connectionRepo.update(conn.id, {
        externalAccountId: pageId,
        accessTokenEncrypted: encrypted,
        tokenExpiresAt,
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
      tokenExpiresAt,
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

  async findById(id: string): Promise<Connection | null> {
    return this.connectionRepo.findOne({ where: { id } });
  }

  async findByExternalAccountId(
    externalAccountId: string,
    type: ConnectionType,
  ): Promise<Connection | null> {
    return this.connectionRepo.findOne({
      where: { externalAccountId, type, status: ConnectionStatus.Connected },
    });
  }

  async disconnect(id: string, tenantId: string): Promise<void> {
    const conn = await this.connectionRepo.findOne({ where: { id, tenantId } });
    if (!conn) throw new NotFoundException('Connection not found');
    await this.connectionRepo.update(id, {
      status: ConnectionStatus.Disconnected,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const conn = await this.connectionRepo.findOne({ where: { id, tenantId } });
    if (!conn) throw new NotFoundException('Connection not found');
    await this.connectionRepo.delete(id);
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

  // ─── Resolve credentials (server-to-server) ─────────────────

  private readonly ALLOWED_PURPOSES = ['create_order', 'sync_catalog', 'sync_stock', 'health_check'];

  async resolveCredentials(dto: {
    connectionId: string;
    tenantId: string;
    platform: string;
    purpose: string;
  }) {
    // Validate purpose
    if (!this.ALLOWED_PURPOSES.includes(dto.purpose)) {
      throw new BadRequestException(`Invalid purpose: ${dto.purpose}`);
    }

    // Load connection
    const connection = await this.connectionRepo.findOne({
      where: { id: dto.connectionId },
    });

    if (!connection) {
      throw new NotFoundException(`Connection ${dto.connectionId} not found`);
    }

    // Validate tenant ownership
    if (connection.tenantId !== dto.tenantId) {
      throw new ForbiddenException('Connection does not belong to tenant');
    }

    // Validate platform matches
    if (connection.type !== dto.platform) {
      throw new BadRequestException(`Platform mismatch: connection is ${connection.type}, requested ${dto.platform}`);
    }

    // Validate connection is active
    if (connection.status !== ConnectionStatus.Connected) {
      throw new BadRequestException(`Connection is not active (status: ${connection.status})`);
    }

    // Decrypt and return minimal credentials
    const accessToken = connection.accessTokenEncrypted
      ? this.crypto.decrypt(connection.accessTokenEncrypted)
      : '';

    const metadata = (connection.metadata ?? {}) as Record<string, any>;

    if (dto.platform === 'shopify') {
      return {
        type: 'shopify',
        shopDomain: metadata.shopDomain ?? connection.externalAccountId,
        accessToken,
        apiVersion: '2024-07',
      };
    }

    // Generic fallback for other platforms
    return {
      type: connection.type,
      externalAccountId: connection.externalAccountId,
      accessToken,
      metadata,
    };
  }

  // ─── Instagram OAuth ─────────────────────────────────────────────

  async createOAuthState(tenantId: string): Promise<string> {
    const token = crypto.randomBytes(16).toString('hex');
    await this.connectTokenRepo.save(this.connectTokenRepo.create({
      tenantId,
      token,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    }));
    return token;
  }

  async validateOAuthState(state: string): Promise<string | null> {
    const record = await this.connectTokenRepo.findOne({
      where: { token: state, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (!record) return null;

    record.usedAt = new Date();
    await this.connectTokenRepo.save(record);
    return record.tenantId;
  }

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; userId: string }> {
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const redirectUri = this.config.get<string>('meta.oauthRedirectUri');

    const body = new URLSearchParams({
      client_id: appId ?? '',
      client_secret: appSecret ?? '',
      grant_type: 'authorization_code',
      redirect_uri: redirectUri ?? '',
      code,
    });

    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Code exchange failed: ${res.status} — ${errBody}`);
    }

    const data = await res.json() as { access_token: string; user_id: number };
    return { accessToken: data.access_token, userId: String(data.user_id) };
  }

  // ─── Instagram token exchange & refresh ─────────────────────────

  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ token: string; expiresAt: Date }> {
    const appSecret = this.config.get<string>('meta.appSecret');
    if (!appSecret) throw new Error('META_APP_SECRET not configured');

    const url = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortLivedToken}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token exchange failed: ${res.status} — ${body}`);
    }

    const data = await res.json() as { access_token: string; token_type: string; expires_in: number };
    return {
      token: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async refreshLongLivedToken(connectionId: string): Promise<void> {
    const conn = await this.connectionRepo.findOne({ where: { id: connectionId } });
    if (!conn || !conn.accessTokenEncrypted) {
      throw new NotFoundException('Connection not found or no token');
    }

    const currentToken = this.crypto.decrypt(conn.accessTokenEncrypted);
    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Token refresh failed for connection ${connectionId}: ${res.status} — ${body}`);
      throw new Error(`Token refresh failed: ${res.status}`);
    }

    const data = await res.json() as { access_token: string; token_type: string; expires_in: number };
    const encrypted = this.crypto.encrypt(data.access_token);
    const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);

    await this.connectionRepo.update(connectionId, {
      accessTokenEncrypted: encrypted,
      tokenExpiresAt,
    } as any);

    this.logger.log(`Token refreshed for connection ${connectionId}, expires ${tokenExpiresAt.toISOString()}`);
  }

  async refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiring = await this.connectionRepo.find({
      where: {
        type: ConnectionType.Instagram,
        status: ConnectionStatus.Connected,
        tokenExpiresAt: LessThan(sevenDaysFromNow),
      },
    });

    let refreshed = 0;
    let failed = 0;

    for (const conn of expiring) {
      try {
        await this.refreshLongLivedToken(conn.id);
        refreshed++;
      } catch (err) {
        this.logger.error(`Failed to refresh token for connection ${conn.id}`, (err as Error).message);
        failed++;
      }
    }

    this.logger.log(`Token refresh: ${refreshed} refreshed, ${failed} failed out of ${expiring.length} expiring`);
    return { refreshed, failed };
  }
}
