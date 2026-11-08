import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CryptoService } from '../../../common/crypto.service';
import { GRAPH_API } from '../../../common/meta-graph';

/**
 * Meta's throttling codes. 4 is the app-level budget the messages edge uses
 * (docs/v2-agent/ig-conversation-history.md); the others are Graph's user,
 * page and Instagram business-use-case limits. All of them mean "stop for an
 * hour", never "the import failed".
 */
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80002]);
const TIMEOUT_MS = 15_000;

/** The app's hourly budget ran out (code 4): stop reading and come back in an hour. */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/** Any other Graph failure; `status` 0 means the request never got an answer. */
export class GraphRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null = null,
  ) {
    super(message);
    this.name = 'GraphRequestError';
  }
}

export interface InstagramAccount {
  /** The Instagram account id (`connections.external_account_id`): the shop's side of every message. */
  accountId: string;
  token: string;
  /** When the store connected DirectMate: shop messages before it were written by a person. */
  connectedAt: Date;
}

export interface GraphParticipant {
  id: string;
  username?: string;
  name?: string;
}

export interface GraphConversation {
  id: string;
  updated_time?: string;
  participants?: { data?: GraphParticipant[] };
}

export interface GraphMessage {
  id: string;
  created_time: string;
  from?: { id: string; username?: string };
  message?: string;
}

/**
 * The `x-app-usage` header: the share of the app's hourly budget used, as the
 * highest of `call_count`, `total_time` and `total_cputime` (percent). Null
 * when the call didn't report it (the conversation list doesn't).
 */
export function parseAppUsage(header: string | null): number | null {
  if (!header) return null;
  try {
    const usage = JSON.parse(header) as Record<string, unknown>;
    const values = ['call_count', 'total_time', 'total_cputime'].map((k) => Number(usage[k])).filter((n) => Number.isFinite(n));
    return values.length > 0 ? Math.max(...values) : null;
  } catch {
    return null;
  }
}

/**
 * Read-only Graph calls for the Instagram history import: the conversation
 * list and each conversation's latest messages, with what each call cost.
 */
@Injectable()
export class GraphHistoryClient {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly crypto: CryptoService,
  ) {}

  /** The store's connected Instagram account, or null when it has none. */
  async account(tenantId: string): Promise<InstagramAccount | null> {
    const [row]: Array<{ external_account_id: string | null; access_token_encrypted: string | null; created_at: Date }> =
      await this.dataSource.query(
        `SELECT external_account_id, access_token_encrypted, created_at FROM connections
          WHERE tenant_id = $1 AND type = 'instagram' AND status = 'connected'
          ORDER BY created_at DESC LIMIT 1`,
        [tenantId],
      );
    if (!row?.external_account_id || !row.access_token_encrypted) return null;
    return {
      accountId: row.external_account_id,
      token: this.crypto.decrypt(row.access_token_encrypted),
      connectedAt: new Date(row.created_at),
    };
  }

  /** One page of conversations, newest first. `after` is the previous page's cursor. */
  async conversations(
    account: InstagramAccount,
    after?: string | null,
  ): Promise<{ conversations: GraphConversation[]; next: string | null; usage: number | null }> {
    const params = new URLSearchParams({ platform: 'instagram', fields: 'id,updated_time,participants', limit: '25' });
    if (after) params.set('after', after);
    const { body, usage } = await this.get<{ data?: GraphConversation[]; paging?: { next?: string; cursors?: { after?: string } } }>(
      account,
      `/${account.accountId}/conversations?${params}`,
    );
    return {
      conversations: body.data ?? [],
      next: body.paging?.next ? (body.paging.cursors?.after ?? null) : null,
      usage,
    };
  }

  /** A conversation's 20 latest messages, newest first. This is the call that spends the app's budget. */
  async messages(account: InstagramAccount, conversationId: string): Promise<{ messages: GraphMessage[]; usage: number | null }> {
    const fields = encodeURIComponent('messages.limit(20){id,created_time,from,message}');
    const { body, usage } = await this.get<{ messages?: { data?: GraphMessage[] } }>(account, `/${conversationId}?fields=${fields}`);
    return { messages: body.messages?.data ?? [], usage };
  }

  private async get<T>(account: InstagramAccount, path: string): Promise<{ body: T; usage: number | null }> {
    let res: Response;
    try {
      res = await fetch(`${GRAPH_API}${path}`, {
        headers: { Authorization: `Bearer ${account.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new GraphRequestError(`Graph request failed: ${(err as Error).message}`, 0);
    }
    const usage = parseAppUsage(res.headers.get('x-app-usage'));
    const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
    if (!res.ok || !body || body.error) {
      const code = typeof body?.error?.code === 'number' ? body.error.code : null;
      const message = body?.error?.message ?? `HTTP ${res.status}`;
      if (code !== null && THROTTLE_CODES.has(code)) throw new RateLimitedError(message, code);
      throw new GraphRequestError(message, res.status, code);
    }
    return { body, usage };
  }
}
