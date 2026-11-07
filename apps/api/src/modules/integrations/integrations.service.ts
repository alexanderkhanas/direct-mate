import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
import { TelegramConnectToken } from '../notifications/entities/telegram-connect-token.entity';
import { ConnectionStatus, ConnectionType } from '@direct-mate/shared';
import { CryptoService } from '../../common/crypto.service';
import { GRAPH_API } from '../../common/meta-graph';

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
    tokenExpiresAt: Date | null = null,
  ): Promise<Connection> {
    // Webhooks route by account id, so an account feeds one tenant. Another
    // tenant still connected to it would win the lookup half the time and
    // answer with its own catalog and a stale token.
    const { affected } = await this.connectionRepo.update(
      { type: ConnectionType.Instagram, externalAccountId: pageId, status: ConnectionStatus.Connected, tenantId: Not(tenantId) },
      { status: ConnectionStatus.Disconnected, accessTokenEncrypted: null, refreshTokenEncrypted: null },
    );
    if (affected) {
      this.logger.warn(`Instagram account ${pageId} moved to tenant ${tenantId}: disconnected it from ${affected} other tenant(s)`);
    }

    const encrypted = this.crypto.encrypt(accessToken);

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

  async findAllByType(type: ConnectionType): Promise<Array<{
    id: string;
    tenantId: string;
    externalAccountId: string | null;
    metadata: Record<string, unknown> | null;
    lastSyncAt: Date | null;
  }>> {
    const connections = await this.connectionRepo.find({
      where: { type, status: ConnectionStatus.Connected },
    });
    return connections.map(c => ({
      id: c.id,
      tenantId: c.tenantId,
      externalAccountId: c.externalAccountId,
      metadata: c.metadata,
      lastSyncAt: c.lastSyncAt,
    }));
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

  /**
   * Exchanges the login code for a Business Integration System User access
   * token, with the Meta app's ID and secret (not the Instagram app's).
   * Whether it expires is set on the login configuration, so `expiresAt` is
   * null when Meta returns no `expires_in`.
   */
  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
    const params = new URLSearchParams({
      client_id: this.config.get<string>('meta.appId') ?? '',
      client_secret: this.config.get<string>('meta.appSecret') ?? '',
      redirect_uri: this.config.get<string>('meta.oauthRedirectUri') ?? '',
      code,
    });

    const res = await fetch(`${GRAPH_API}/oauth/access_token?${params}`);
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Code exchange failed: ${res.status} — ${errBody}`);
    }

    const data = await res.json() as { access_token: string; expires_in?: number };
    return {
      accessToken: data.access_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  }

  /**
   * The Instagram accounts the client shared at login. The id is the one
   * webhooks put in `entry.id`. The username is a nicety: a failed lookup
   * leaves it unset rather than failing the connect.
   */
  async getAssignedInstagramAccounts(token: string): Promise<Array<{ id: string; username?: string }>> {
    const res = await fetch(`${GRAPH_API}/me/assigned_instagram_accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Assigned Instagram accounts lookup failed: ${res.status} — ${await res.text()}`);
    }
    const body = await res.json() as { data?: Array<{ id: string | number }> };

    return Promise.all(
      (body.data ?? []).map(async ({ id }) => {
        try {
          const profile = await fetch(`${GRAPH_API}/${id}?fields=username`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (profile.ok) {
            const { username } = await profile.json() as { username?: string };
            return { id: String(id), username };
          }
        } catch { /* non-critical */ }
        return { id: String(id) };
      }),
    );
  }

  /**
   * Subscribes the app to the account's webhooks. Unified Login connections
   * get no notifications until this is called, once per account.
   */
  async subscribeToWebhooks(igAccountId: string, token: string): Promise<void> {
    const res = await fetch(`${GRAPH_API}/${igAccountId}/subscribed_apps?subscribed_fields=messages,comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = res.ok ? await res.json() as { success?: boolean } : null;
    if (!body?.success) {
      throw new Error(`Webhook subscription failed for ${igAccountId}: ${res.status}${body ? '' : ` — ${await res.text()}`}`);
    }
  }

  // ─── Instagram token expiry ─────────────────────────────────────

  /**
   * Unified Login tokens have no refresh grant: an expiring one means the
   * store has to connect again. Kept on the n8n schedule so that need shows
   * up in the logs a week ahead, in the shape the workflow already reads.
   */
  async reportExpiringTokens(): Promise<{ refreshed: number; failed: number; expiring: number }> {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiring = await this.connectionRepo.find({
      where: {
        type: ConnectionType.Instagram,
        status: ConnectionStatus.Connected,
        tokenExpiresAt: LessThan(sevenDaysFromNow),
      },
    });

    for (const conn of expiring) {
      this.logger.warn(
        `Instagram token for tenant ${conn.tenantId} (connection ${conn.id}) expires ${conn.tokenExpiresAt?.toISOString()} — the store must reconnect`,
      );
    }
    return { refreshed: 0, failed: 0, expiring: expiring.length };
  }
}
