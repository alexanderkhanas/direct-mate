import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../common/db';
import { randomToken, tokenHash } from './oauth/pkce';

/**
 * `instagram` / `shopify`: a step Claude sends the owner to, one use, ten
 * minutes. `connect`: a link we send a prospect to allow reading their Direct
 * and connect Instagram (`connect.controller.ts`), valid for days; it works
 * until the store has Instagram connected.
 */
export type HandoffAction = 'instagram' | 'shopify' | 'connect';
export const HANDOFF_TTL_SECONDS = 600;

/**
 * Links for the steps that need a browser. A link from a chat can open where
 * the owner isn't signed in to the admin, so the page is public and the token
 * in the link authorizes exactly one action for one store, once.
 */
@Injectable()
export class HandoffService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async issue(
    tenantId: string,
    action: HandoffAction,
    ttlSeconds = HANDOFF_TTL_SECONDS,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const token = randomToken();
    await this.dataSource.query(
      `INSERT INTO handoff_tokens (token_hash, tenant_id, action, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [tokenHash(token), tenantId, action, ttlSeconds],
    );
    const admin = this.config.get<string>('admin.baseUrl') ?? 'http://localhost:5173';
    const page = action === 'connect' ? 'connect' : `claude/${action}`;
    return { url: `${admin}/${page}?t=${token}`, expiresInSeconds: ttlSeconds };
  }

  /** The store a link acts for, without spending it; undefined if it was used, has expired, or is for another action. */
  async peek(token: unknown, action: HandoffAction): Promise<string | undefined> {
    if (typeof token !== 'string' || !token) return undefined;
    const [row]: Array<{ tenant_id: string }> = await this.dataSource.query(
      `SELECT tenant_id FROM handoff_tokens
        WHERE token_hash = $1 AND action = $2 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash(token), action],
    );
    return row?.tenant_id;
  }

  /** The store a link acts for; undefined if it was used, has expired, or is for another action. */
  async consume(token: unknown, action: HandoffAction): Promise<string | undefined> {
    if (typeof token !== 'string' || !token) return undefined;
    const rows = returnedRows<{ tenant_id: string }>(
      await this.dataSource.query(
        `UPDATE handoff_tokens SET used_at = now()
          WHERE token_hash = $1 AND action = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING tenant_id`,
        [tokenHash(token), action],
      ),
    );
    return rows[0]?.tenant_id;
  }
}
