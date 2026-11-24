import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CryptoService } from '../../../common/crypto.service';
import { graphApi, isInstagramLoginMethod } from '../../../common/meta-graph';
import { DEFAULT_MESSAGES_PER_CONVERSATION } from './history-limits';

/**
 * Meta's throttling codes. 4 is the app-level budget the messages edge uses
 * (docs/v2-agent/ig-conversation-history.md); the others are Graph's user,
 * page and Instagram business-use-case limits. All of them mean "stop for an
 * hour", never "the import failed".
 */
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80002]);
const TIMEOUT_MS = 15_000;
/** Instagram Login allows 2 conversation calls a second per account. */
const PER_MESSAGE_GAP_MS = 500;
/**
 * Meta's largest page of messages (`messages.limit(100)` still returns 50).
 * Older messages come with their text on both logins: checked on Unified
 * Login on 7 Nov 2026 and on Instagram Login on 24 Nov 2026 (200 messages back
 * to July, read by id at positions up to 180), whatever Meta's docs say about
 * only the 20 most recent.
 */
const MESSAGES_PAGE = 50;

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
  /** The connection's Graph host: graph.instagram.com for Instagram Login, graph.facebook.com for Unified Login. */
  api: string;
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
 * highest of its numbers (percent). graph.facebook.com names them
 * `call_count`, `total_time`, `total_cputime`; graph.instagram.com
 * `call_volume`, `cpu_time`. Null when the call didn't report it.
 */
const USAGE_KEYS = ['call_count', 'total_time', 'total_cputime', 'call_volume', 'cpu_time'];

export function parseAppUsage(header: string | null): number | null {
  if (!header) return null;
  try {
    const usage = JSON.parse(header) as Record<string, unknown>;
    const values = USAGE_KEYS.filter((k) => k in usage)
      .map((k) => Number(usage[k]))
      .filter((n) => Number.isFinite(n));
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
    const [row]: Array<{
      external_account_id: string | null;
      access_token_encrypted: string | null;
      login_method: string | null;
      created_at: Date;
    }> = await this.dataSource.query(
      `SELECT external_account_id, access_token_encrypted, login_method, created_at FROM connections
        WHERE tenant_id = $1 AND type = 'instagram' AND status = 'connected'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (!row?.external_account_id || !row.access_token_encrypted) return null;
    return {
      accountId: row.external_account_id,
      token: this.crypto.decrypt(row.access_token_encrypted),
      api: graphApi(isInstagramLoginMethod(row.login_method) ? row.login_method : null),
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

  /**
   * A conversation's `limit` latest messages, newest first, 50 a page. On
   * Unified Login this is the call that spends the app's budget, so paging
   * stops once a page reports `stopAtUsage` (%) or more; `usage` is the highest
   * reading seen. Instagram Login's edge may list only the messages' ids
   * (Meta's docs read each message on its own); then each of them is read by
   * id, at Meta's pace, and one that can't be read is skipped.
   */
  async messages(
    account: InstagramAccount,
    conversationId: string,
    opts: { limit?: number; stopAtUsage?: number } = {},
  ): Promise<{ messages: GraphMessage[]; usage: number | null }> {
    const limit = Math.max(1, opts.limit ?? DEFAULT_MESSAGES_PER_CONVERSATION);
    type Page = { data?: GraphMessage[]; paging?: { next?: string } };
    const fields = encodeURIComponent(`messages.limit(${Math.min(limit, MESSAGES_PAGE)}){id,created_time,from,message}`);
    const first = await this.get<{ messages?: Page }>(account, `/${conversationId}?fields=${fields}`);
    let usage = first.usage;
    let page = first.body.messages;
    const listed: GraphMessage[] = [...(page?.data ?? [])];
    while (listed.length < limit && page?.paging?.next) {
      if (opts.stopAtUsage !== undefined && usage !== null && usage >= opts.stopAtUsage) break;
      const next = sameHost(page.paging.next, account.api);
      if (!next) break;
      await new Promise((r) => setTimeout(r, PER_MESSAGE_GAP_MS));
      const res = await this.request<Page>(account, next);
      if (res.usage !== null) usage = Math.max(usage ?? 0, res.usage);
      page = res.body;
      listed.push(...(page.data ?? []));
    }
    listed.splice(limit);
    if (listed.length === 0 || listed.some((m) => m.from)) return { messages: listed, usage };

    const messages: GraphMessage[] = [];
    for (const { id } of listed) {
      await new Promise((r) => setTimeout(r, PER_MESSAGE_GAP_MS));
      try {
        const one = await this.get<GraphMessage>(account, `/${id}?fields=id,created_time,from,message`);
        messages.push(one.body);
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
      }
    }
    return { messages, usage };
  }

  private get<T>(account: InstagramAccount, path: string): Promise<{ body: T; usage: number | null }> {
    return this.request<T>(account, `${account.api}${path}`);
  }

  private async request<T>(account: InstagramAccount, url: string): Promise<{ body: T; usage: number | null }> {
    let res: Response;
    try {
      res = await fetch(url, {
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

/**
 * Meta's `paging.next` link, followed only when it points at the connection's
 * own Graph host: the bearer token goes with it.
 */
function sameHost(next: string, api: string): string | null {
  try {
    return new URL(next).origin === new URL(api).origin ? next : null;
  } catch {
    return null;
  }
}
