import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Connection } from './entities/connection.entity';
import { SyncJob } from './entities/sync-job.entity';
import { TelegramConnectToken } from '../notifications/entities/telegram-connect-token.entity';
import { ConnectionStatus, ConnectionType } from '@direct-mate/shared';
import { CryptoService } from '../../common/crypto.service';
import { GRAPH_API, IG_GRAPH_API, type InstagramLoginMethod } from '../../common/meta-graph';
import type { IgAccount } from './ig-account';

/**
 * What Instagram Login asks for. Comments are granted only once Meta approves
 * the permission, or to people with a role on the app; without them the
 * account is subscribed to messages alone.
 */
const INSTAGRAM_LOGIN_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];
/** An Instagram Login token's life, and when it is renewed. */
const INSTAGRAM_TOKEN_DAYS = 60;
const INSTAGRAM_REFRESH_WITHIN_DAYS = 10;
const DAY_SECONDS = 24 * 60 * 60;

/** A connection as the admin sees it: tokens stay on the server, even encrypted. */
export type PublicConnection = Omit<Connection, 'accessTokenEncrypted' | 'refreshTokenEncrypted'>;

export function withoutTokens(connection: Connection): PublicConnection {
  const { accessTokenEncrypted: _access, refreshTokenEncrypted: _refresh, ...rest } = connection;
  return rest;
}

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
    loginMethod: InstagramLoginMethod = 'unified',
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
        loginMethod,
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
      loginMethod,
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

  /** The store's connections for the admin, without their (encrypted) tokens. */
  async findAll(tenantId: string): Promise<PublicConnection[]> {
    const connections = await this.connectionRepo.find({ where: { tenantId } });
    return connections.map(withoutTokens);
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

  /** The login new connections use (`INSTAGRAM_LOGIN_METHOD`); existing connections keep theirs. */
  loginMethod(): InstagramLoginMethod {
    return this.config.get<string>('meta.loginMethod') === 'unified' ? 'unified' : 'instagram';
  }

  /**
   * The login page for connecting this store's Instagram account: Instagram's
   * own (instagram.com) or Meta's Unified Login (facebook.com), by
   * `loginMethod()`. `state` carries the one-time token, the admin page the
   * callback returns to, and the method (`ig` / `fb`); Meta returns it as given.
   */
  async instagramLoginUrl(tenantId: string, returnTo: 'onboarding' | 'connections' | 'claude'): Promise<string> {
    const method = this.loginMethod();
    const redirectUri = this.config.get<string>('meta.oauthRedirectUri');
    const appId = this.config.get<string>(method === 'instagram' ? 'meta.instagramAppId' : 'meta.appId');
    const configId = this.config.get<string>('meta.loginConfigId');
    if (!appId || !redirectUri || (method === 'unified' && !configId)) {
      throw new BadRequestException('Instagram OAuth not configured');
    }
    // Saved in telegram_connect_tokens (reused): one use, ten minutes.
    const token = await this.createOAuthState(tenantId);
    const state = `${token}.${returnTo}.${method === 'instagram' ? 'ig' : 'fb'}`;

    if (method === 'instagram') {
      // `force_reauth`: the owner signs in to the shop's account rather than
      // whichever account the browser already has open.
      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: INSTAGRAM_LOGIN_SCOPES.join(','),
        state,
        force_reauth: 'true',
      });
      return `https://www.instagram.com/oauth/authorize?${params}`;
    }

    // The Unified Login URL from the App Dashboard. The configuration carries
    // the permissions, so no scopes here. Its `display=popup` is dropped: the
    // admin opens this as a full page.
    const params = new URLSearchParams({
      client_id: appId,
      config_id: configId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      override_default_response_type: 'true',
      state,
      prompt: 'login',
    });
    return `https://www.facebook.com/dialog/oauth?${params}`;
  }

  /**
   * Finishes a login the callback received: the code becomes a token, the
   * account is found and subscribed to webhooks, and the connection is saved.
   * A reason the owner can act on comes back as data; anything else throws.
   */
  async completeInstagramLogin(
    tenantId: string,
    code: string,
    method: InstagramLoginMethod,
  ): Promise<{ ok: true; accountId: string } | { ok: false; reason: 'no_account' | 'multiple_accounts' | 'subscribe_failed' }> {
    let account: IgAccount;
    let username: string | undefined;
    let expiresAt: Date | null;

    if (method === 'instagram') {
      const exchanged = await this.exchangeInstagramCode(code);
      const profile = await this.instagramProfile(exchanged.accessToken);
      account = { igAccountId: profile.userId, token: exchanged.accessToken, api: IG_GRAPH_API };
      username = profile.username;
      expiresAt = exchanged.expiresAt;
    } else {
      const exchanged = await this.exchangeCodeForToken(code);
      // One token can cover several accounts; a tenant is one account. Picking
      // one for the store could wire the wrong account, so ask them to
      // reconnect sharing just one.
      const accounts = await this.getAssignedInstagramAccounts(exchanged.accessToken);
      if (accounts.length !== 1) {
        const reason = accounts.length === 0 ? 'no_account' : 'multiple_accounts';
        this.logger.warn(`Instagram OAuth for tenant ${tenantId}: ${accounts.length} accounts shared — ${reason}`);
        return { ok: false, reason };
      }
      account = { igAccountId: accounts[0].id, token: exchanged.accessToken, api: GRAPH_API };
      username = accounts[0].username;
      expiresAt = exchanged.expiresAt;
    }

    try {
      await this.subscribeToWebhooks(account);
    } catch (err) {
      // Saving now would show a connected account that never hears a message.
      this.logger.error(`Instagram OAuth for tenant ${tenantId}`, (err as Error).message);
      return { ok: false, reason: 'subscribe_failed' };
    }

    // The account id is what webhooks put in entry.id.
    await this.connectInstagram(tenantId, account.igAccountId, account.token, username, expiresAt, method);
    return { ok: true, accountId: account.igAccountId };
  }

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
   * Instagram Login: the code becomes a short-lived token at instagram.com,
   * then a 60-day one. A connection is never saved with the short-lived token,
   * which would stop working within the hour.
   */
  private async exchangeInstagramCode(code: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const clientSecret = this.config.get<string>('meta.instagramAppSecret') ?? '';
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.get<string>('meta.instagramAppId') ?? '',
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: this.config.get<string>('meta.oauthRedirectUri') ?? '',
        // Instagram appends `#_` to the code in the redirect; a copied code may still carry it.
        code: code.replace(/#_$/, ''),
      }),
    });
    if (!res.ok) throw new Error(`Instagram code exchange failed: ${res.status} — ${await res.text()}`);
    const short = (await res.json()) as { access_token?: string; data?: Array<{ access_token?: string }> };
    const shortToken = short.access_token ?? short.data?.[0]?.access_token;
    if (!shortToken) throw new Error('Instagram code exchange returned no token');

    const params = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: clientSecret, access_token: shortToken });
    const longRes = await fetch(`https://graph.instagram.com/access_token?${params}`);
    if (!longRes.ok) throw new Error(`Instagram long-lived token exchange failed: ${longRes.status} — ${await longRes.text()}`);
    const long = (await longRes.json()) as { access_token?: string; expires_in?: number };
    if (!long.access_token) throw new Error('Instagram long-lived token exchange returned no token');
    return { accessToken: long.access_token, expiresAt: new Date(Date.now() + (long.expires_in ?? INSTAGRAM_TOKEN_DAYS * DAY_SECONDS) * 1000) };
  }

  /**
   * The account behind an Instagram Login token. `user_id` is the professional
   * account id that webhooks put in `entry.id`; the login's own user id is a
   * different one, so a missing `user_id` fails the connect instead of saving
   * an account no webhook would ever reach. The id is read from the raw text:
   * it is longer than a JS number holds exactly, and Instagram has sent it
   * unquoted before, which `JSON.parse` would round to another account's id.
   */
  private async instagramProfile(token: string): Promise<{ userId: string; username?: string }> {
    const res = await fetch(`${IG_GRAPH_API}/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Instagram profile lookup failed: ${res.status} — ${text}`);
    const userId = /"user_id"\s*:\s*"?(\d+)/.exec(text)?.[1];
    if (!userId) throw new Error('Instagram profile has no user_id');
    const { username } = JSON.parse(text) as { username?: string };
    return { userId, username };
  }

  /**
   * Subscribes the app to the account's webhooks; neither login delivers any
   * until this is called, once per account. Comments need a permission real
   * accounts may not have granted, so when Meta refuses them the account is
   * subscribed to messages alone. Throws only when messages fail too.
   */
  async subscribeToWebhooks(account: IgAccount): Promise<{ comments: boolean }> {
    const subscribe = async (fields: string): Promise<void> => {
      const res = await fetch(`${account.api}/${account.igAccountId}/subscribed_apps?subscribed_fields=${fields}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${account.token}` },
      });
      const body = res.ok ? ((await res.json()) as { success?: boolean }) : null;
      if (!body?.success) {
        throw new Error(`Webhook subscription (${fields}) failed for ${account.igAccountId}: ${res.status}${body ? '' : ` — ${await res.text()}`}`);
      }
    };
    try {
      await subscribe('messages,comments');
      return { comments: true };
    } catch (err) {
      this.logger.warn(`${(err as Error).message}. Subscribing to messages alone: comments won't be answered for this account`);
    }
    await subscribe('messages');
    return { comments: false };
  }

  // ─── Instagram token expiry ─────────────────────────────────────

  /**
   * Instagram Login tokens last 60 days and are renewed here, daily, once
   * fewer than 10 days are left (by then a token is well past the 24 hours
   * Meta asks before a renewal). A token already expired can't be renewed:
   * its connection is marked `error` and the store connects again. Unified
   * Login tokens have no renewal; an expiring one is only logged.
   */
  async refreshInstagramTokens(): Promise<{ refreshed: number; failed: number; expired: number; expiring: number }> {
    const now = Date.now();
    const due = await this.connectionRepo.find({
      where: {
        type: ConnectionType.Instagram,
        status: ConnectionStatus.Connected,
        tokenExpiresAt: LessThan(new Date(now + INSTAGRAM_REFRESH_WITHIN_DAYS * DAY_SECONDS * 1000)),
      },
    });

    let refreshed = 0;
    let failed = 0;
    let expired = 0;
    let expiring = 0;
    for (const conn of due) {
      if (conn.loginMethod !== 'instagram') {
        expiring++;
        this.logger.warn(
          `Instagram token for tenant ${conn.tenantId} (connection ${conn.id}) expires ${conn.tokenExpiresAt?.toISOString()} — the store must reconnect`,
        );
        continue;
      }
      if (!conn.accessTokenEncrypted || (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= now)) {
        expired++;
        await this.connectionRepo.update(conn.id, { status: ConnectionStatus.Error });
        this.logger.warn(`Instagram token for tenant ${conn.tenantId} (connection ${conn.id}) expired — the store must reconnect`);
        continue;
      }
      try {
        const token = this.crypto.decrypt(conn.accessTokenEncrypted);
        const res = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`);
        if (!res.ok) throw new Error(`${res.status} — ${await res.text()}`);
        const body = (await res.json()) as { access_token?: string; expires_in?: number };
        if (!body.access_token) throw new Error('no token in the response');
        await this.connectionRepo.update(conn.id, {
          accessTokenEncrypted: this.crypto.encrypt(body.access_token),
          tokenExpiresAt: new Date(Date.now() + (body.expires_in ?? INSTAGRAM_TOKEN_DAYS * DAY_SECONDS) * 1000),
        });
        refreshed++;
      } catch (err) {
        failed++;
        this.logger.error(`Renewing the Instagram token for tenant ${conn.tenantId} (connection ${conn.id}) failed: ${(err as Error).message}`);
      }
    }
    if (due.length) this.logger.log(`Instagram tokens: ${refreshed} renewed, ${failed} failed, ${expired} expired, ${expiring} Unified expiring`);
    return { refreshed, failed, expired, expiring };
  }

  /** Daily. Off with INSTAGRAM_TOKEN_REFRESH_WORKER_ENABLED=false (the CLI scripts do that). */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async refreshTokensDaily(): Promise<void> {
    if (!this.config.get<boolean>('instagram.tokenRefreshWorkerEnabled')) return;
    await this.refreshInstagramTokens().catch((err) => this.logger.error(`Instagram token renewal failed: ${(err as Error).message}`));
  }
}
