import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../../common/db';
import { SetupEventsService } from '../setup-events.service';
import { pkceMatches, randomToken, tokenHash } from './pkce';

export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 90 * 24 * 3600;
const REQUEST_TTL_S = 600;
const CODE_TTL_S = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

/** Why an owner's «Allow» didn't go through; the consent page has a line for each. */
export type ApproveProblem = 'expired' | 'wrong_browser' | 'not_owner' | 'store_unavailable';

/** An RFC 6749 token-endpoint error. */
export class OAuthError extends Error {
  constructor(
    readonly error: 'invalid_grant' | 'invalid_client' | 'invalid_target' | 'invalid_request',
    description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Who an access token acts for. */
export interface McpIdentity {
  tenantId: string;
  userId: string;
  grantId: string;
}

/**
 * DirectMate as the OAuth 2.1 authorization server for its MCP endpoint:
 * clients register themselves, the owner allows one on the admin's consent
 * page, and the client holds a one-hour access token plus a rotating refresh
 * token. Every single-use value is consumed with one atomic UPDATE.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly events: SetupEventsService,
  ) {}

  private get production(): boolean {
    const env = this.config.get<string>('nodeEnv');
    return env !== 'development' && env !== 'test';
  }

  // ─── Clients ─────────────────────────────────────────────────────

  async registerClient(clientName: string, redirectUris: string[]): Promise<OAuthClient> {
    const clientId = randomToken(16);
    await this.dataSource.query(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)`, [
      clientId,
      clientName,
      JSON.stringify(redirectUris),
    ]);
    return { clientId, clientName, redirectUris };
  }

  async client(clientId: unknown): Promise<OAuthClient | undefined> {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 200) return undefined;
    const [row]: Array<{ client_id: string; client_name: string; redirect_uris: string[] }> = await this.dataSource.query(
      `SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = $1`,
      [clientId],
    );
    return row && { clientId: row.client_id, clientName: row.client_name, redirectUris: row.redirect_uris };
  }

  // ─── A sign-in: request → the owner allows it → code ─────────────

  /** Start a sign-in. `browserToken` goes into a cookie: only that browser can allow the request. */
  async createRequest(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string | null;
    resource: string | null;
  }): Promise<{ id: string; browserToken: string }> {
    const browserToken = randomToken();
    const [row]: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO oauth_requests (client_id, redirect_uri, code_challenge, state, resource, browser_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7)) RETURNING id`,
      [input.clientId, input.redirectUri, input.codeChallenge, input.state, input.resource, tokenHash(browserToken), REQUEST_TTL_S],
    );
    return { id: row.id, browserToken };
  }

  /** What the consent page shows; undefined once the request is allowed, denied or expired. */
  async requestInfo(id: string): Promise<{ clientName: string; redirectHost: string } | undefined> {
    if (!UUID.test(id)) return undefined;
    const [row]: Array<{ client_name: string; redirect_uri: string }> = await this.dataSource.query(
      `SELECT c.client_name, r.redirect_uri FROM oauth_requests r JOIN oauth_clients c ON c.client_id = r.client_id
        WHERE r.id = $1 AND r.tenant_id IS NULL AND r.used_at IS NULL AND r.expires_at > now()`,
      [id],
    );
    return row && { clientName: row.client_name, redirectHost: new URL(row.redirect_uri).host };
  }

  /**
   * The owner pressed «Allow». The user comes from the database, not from the
   * JWT's claims: an impersonation token carries the owner's role, and a
   * superadmin's tenant can be swapped by a header.
   */
  async approve(
    id: string,
    userId: string,
    browserToken: string | undefined,
  ): Promise<{ redirectTo: string } | { problem: ApproveProblem }> {
    if (!UUID.test(id) || !UUID.test(userId)) return { problem: 'expired' };
    const [user]: Array<{ tenant_id: string; role: string; is_active: boolean; tenant_active: boolean; is_demo: boolean }> =
      await this.dataSource.query(
        `SELECT u.tenant_id, u.role, u.is_active, t.is_active AS tenant_active, t.is_demo
           FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
        [userId],
      );
    if (!user || !user.is_active || user.role !== 'owner') return { problem: 'not_owner' };
    // A demo store is shared by everyone who opens the demo; locally it is what there is to test with.
    if (!user.tenant_active || (user.is_demo && this.production)) return { problem: 'store_unavailable' };

    // In development the API (behind a tunnel) and the admin are different sites, so the cookie never arrives.
    const bound = this.production || !!browserToken;
    const code = randomToken();
    const rows = returnedRows<{ redirect_uri: string; state: string | null }>(
      await this.dataSource.query(
        `UPDATE oauth_requests
            SET tenant_id = $2, user_id = $3, code_hash = $4, code_expires_at = now() + make_interval(secs => $5)
          WHERE id = $1 AND tenant_id IS NULL AND used_at IS NULL AND expires_at > now()
            AND ($6::text IS NULL OR browser_hash = $6)
        RETURNING redirect_uri, state`,
        [id, user.tenant_id, userId, tokenHash(code), CODE_TTL_S, bound ? tokenHash(browserToken ?? '') : null],
      ),
    );
    if (rows.length === 0) {
      const stillOpen = await this.requestInfo(id);
      return { problem: stillOpen ? 'wrong_browser' : 'expired' };
    }
    await this.events.record(user.tenant_id, 'authorized');
    return { redirectTo: this.callback(rows[0].redirect_uri, rows[0].state, { code }) };
  }

  /** The owner pressed «Cancel»: the request is closed and the client is told. */
  async deny(id: string): Promise<{ redirectTo: string } | undefined> {
    if (!UUID.test(id)) return undefined;
    const rows = returnedRows<{ redirect_uri: string; state: string | null }>(
      await this.dataSource.query(
        `UPDATE oauth_requests SET used_at = now()
          WHERE id = $1 AND tenant_id IS NULL AND used_at IS NULL AND expires_at > now()
        RETURNING redirect_uri, state`,
        [id],
      ),
    );
    return rows[0] && { redirectTo: this.callback(rows[0].redirect_uri, rows[0].state, { error: 'access_denied' }) };
  }

  /** Where to send the browser back: the client's redirect with our answer, its `state`, and who we are. */
  callback(redirectUri: string, state: string | null, params: Record<string, string>): string {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (state) url.searchParams.set('state', state);
    url.searchParams.set('iss', this.config.get<string>('mcp.publicUrl') ?? '');
    return url.toString();
  }

  // ─── Tokens ──────────────────────────────────────────────────────

  async exchangeCode(input: {
    client: OAuthClient;
    code: unknown;
    redirectUri: unknown;
    resource: unknown;
    codeVerifier: unknown;
  }): Promise<TokenPair> {
    if (typeof input.code !== 'string' || !input.code) throw new OAuthError('invalid_request', 'code is required');
    // The code is spent by this, whether or not the checks below pass.
    const rows = returnedRows<{
      client_id: string;
      redirect_uri: string;
      resource: string | null;
      code_challenge: string;
      tenant_id: string;
      user_id: string;
    }>(
      await this.dataSource.query(
        `UPDATE oauth_requests SET used_at = now()
          WHERE code_hash = $1 AND used_at IS NULL AND code_expires_at > now()
        RETURNING client_id, redirect_uri, resource, code_challenge, tenant_id, user_id`,
        [tokenHash(input.code)],
      ),
    );
    const request = rows[0];
    if (!request || request.client_id !== input.client.clientId) {
      throw new OAuthError('invalid_grant', 'Code is invalid, used or expired');
    }
    if (input.redirectUri !== request.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
    if (input.resource !== undefined && input.resource !== (request.resource ?? this.config.get<string>('mcp.publicUrl') + '/mcp')) {
      throw new OAuthError('invalid_target', 'Wrong resource');
    }
    if (!pkceMatches(input.codeVerifier, request.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');

    const [grant]: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO mcp_grants (tenant_id, user_id, client_id, client_name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [request.tenant_id, request.user_id, input.client.clientId, input.client.clientName],
    );
    return this.issue(grant.id);
  }

  async refresh(client: OAuthClient, refreshToken: unknown): Promise<TokenPair> {
    if (typeof refreshToken !== 'string' || !refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
    const hash = tokenHash(refreshToken);
    const rows = returnedRows<{ grant_id: string }>(
      await this.dataSource.query(
        `UPDATE mcp_tokens SET used_at = now()
          WHERE token_hash = $1 AND kind = 'refresh' AND used_at IS NULL AND expires_at > now()
        RETURNING grant_id`,
        [hash],
      ),
    );
    if (rows.length === 0) {
      // A refresh token presented twice: one of the two holders is not the client. End the grant.
      const [spent]: Array<{ grant_id: string }> = await this.dataSource.query(
        `SELECT grant_id FROM mcp_tokens WHERE token_hash = $1 AND kind = 'refresh' AND used_at IS NOT NULL`,
        [hash],
      );
      if (spent) {
        await this.revokeGrant(spent.grant_id);
        this.logger.warn(`Refresh token reuse: grant ${spent.grant_id} revoked`);
      }
      throw new OAuthError('invalid_grant', 'Refresh token is invalid, used or expired');
    }
    const [grant]: Array<{ id: string }> = await this.dataSource.query(
      `SELECT g.id FROM mcp_grants g ${VALID_GRANT_JOIN} WHERE g.id = $1 AND g.client_id = $2 ${VALID_GRANT_WHERE}`,
      [rows[0].grant_id, client.clientId],
    );
    if (!grant) throw new OAuthError('invalid_grant', 'This connection is no longer allowed');
    return this.issue(grant.id);
  }

  private async issue(grantId: string): Promise<TokenPair> {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    await this.dataSource.query(
      `INSERT INTO mcp_tokens (token_hash, grant_id, kind, expires_at) VALUES
         ($1, $3, 'access', now() + make_interval(secs => $4)),
         ($2, $3, 'refresh', now() + make_interval(secs => $5))`,
      [tokenHash(accessToken), tokenHash(refreshToken), grantId, ACCESS_TTL_S, REFRESH_TTL_S],
    );
    return { accessToken, refreshToken };
  }

  /**
   * Who an access token acts for. Checked against the store on every call:
   * a revoked grant, a deactivated user, an owner who is no longer one, or a
   * closed store all stop working at once, not when the token runs out.
   */
  async identify(accessToken: string): Promise<McpIdentity | undefined> {
    const [row]: Array<{ id: string; tenant_id: string; user_id: string }> = await this.dataSource.query(
      `SELECT g.id, g.tenant_id, g.user_id
         FROM mcp_tokens k JOIN mcp_grants g ON g.id = k.grant_id ${VALID_GRANT_JOIN}
        WHERE k.token_hash = $1 AND k.kind = 'access' AND k.expires_at > now() ${VALID_GRANT_WHERE}`,
      [tokenHash(accessToken)],
    );
    if (!row) return undefined;
    void this.dataSource
      .query(
        `UPDATE mcp_grants SET last_used_at = now()
          WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
        [row.id],
      )
      .catch(() => undefined);
    return { tenantId: row.tenant_id, userId: row.user_id, grantId: row.id };
  }

  // ─── Grants ──────────────────────────────────────────────────────

  async grants(tenantId: string): Promise<Array<{ id: string; clientName: string; createdAt: Date; lastUsedAt: Date | null }>> {
    const rows: Array<{ id: string; client_name: string; created_at: Date; last_used_at: Date | null }> = await this.dataSource.query(
      `SELECT id, client_name, created_at, last_used_at FROM mcp_grants
        WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map((r) => ({ id: r.id, clientName: r.client_name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  }

  /** `tenantId` when an owner revokes from the admin: only their own store's grants. */
  async revokeGrant(grantId: string, tenantId?: string): Promise<boolean> {
    if (!UUID.test(grantId)) return false;
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE mcp_grants SET revoked_at = now()
          WHERE id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR tenant_id = $2) RETURNING id`,
        [grantId, tenantId ?? null],
      ),
    );
    if (rows.length > 0) await this.dataSource.query(`DELETE FROM mcp_tokens WHERE grant_id = $1`, [grantId]);
    return rows.length > 0;
  }

  /** Expired tokens, finished sign-ins, hand-off links, and clients that never completed a sign-in. */
  @Cron('17 4 * * *')
  async cleanup(): Promise<void> {
    if (this.config.get<boolean>('mcp.enabled') !== true) return;
    try {
      await this.dataSource.query(`DELETE FROM mcp_tokens WHERE expires_at < now() - interval '1 day'`);
      await this.dataSource.query(`DELETE FROM oauth_requests WHERE expires_at < now() - interval '1 day'`);
      await this.dataSource.query(`DELETE FROM handoff_tokens WHERE expires_at < now() - interval '1 day'`);
      await this.dataSource.query(
        `DELETE FROM oauth_clients c
          WHERE c.created_at < now() - interval '7 days'
            AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.client_id AND g.revoked_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM oauth_requests r WHERE r.client_id = c.client_id)`,
      );
    } catch (err) {
      this.logger.warn(`OAuth cleanup failed: ${(err as Error).message}`);
    }
  }
}

/** A grant still stands: not revoked, its user active and still the owner of that store, the store open. */
const VALID_GRANT_JOIN = `JOIN users u ON u.id = g.user_id JOIN tenants t ON t.id = g.tenant_id`;
const VALID_GRANT_WHERE = `AND g.revoked_at IS NULL AND u.is_active AND u.role = 'owner' AND u.tenant_id = g.tenant_id AND t.is_active`;
