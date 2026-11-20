import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returnedRows } from '../../common/db';
import { randomToken, tokenHash } from './oauth/pkce';

export type HandoffAction = 'instagram' | 'shopify';
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

  async issue(tenantId: string, action: HandoffAction): Promise<{ url: string; expiresInSeconds: number }> {
    const token = randomToken();
    await this.dataSource.query(
      `INSERT INTO handoff_tokens (token_hash, tenant_id, action, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [tokenHash(token), tenantId, action, HANDOFF_TTL_SECONDS],
    );
    const admin = this.config.get<string>('admin.baseUrl') ?? 'http://localhost:5173';
    return { url: `${admin}/claude/${action}?t=${token}`, expiresInSeconds: HANDOFF_TTL_SECONDS };
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
