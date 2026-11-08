import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { returnedRows } from '../../../common/db';
import { AgentModelFactory } from '../../agent/model.factory';
import {
  GraphHistoryClient,
  GraphRequestError,
  RateLimitedError,
  type GraphConversation,
  type GraphMessage,
  type InstagramAccount,
} from './graph-history.client';
import { hasPersonalData, redact, redactCustomer } from './redact';
import type { HistoryExample, HistoryFact, HistoryFactSection, HistoryImport, HistoryImportView } from './history-import.types';

/** Read until this many conversations have a reply from the shop… */
const WANT_CONVERSATIONS = 30;
/** …or this many conversations have been read. */
const MAX_READ = 60;
/** Stop fetching once a messages call reports this share (%) of the app's hourly budget used. */
const USAGE_CEILING = 75;
/** Fewer replies by a person than this is too little to learn from. */
const MIN_HUMAN_REPLIES = 5;
/** Meta's budget is hourly, and calls made while blocked push recovery further out. */
const RETRY_MS = 60 * 60 * 1000;
/** Runs that may end in an error (network, 5xx, the model, a restart) before the import is `failed`. */
const MAX_ATTEMPTS = 4;
/** The wait before retrying after an error: 5, 15, 45 minutes. */
const BACKOFF_MS = (attempt: number) => 5 * 60 * 1000 * 3 ** (attempt - 1);
/** A `running` import silent this long (no heartbeat) was cut off by a restart. */
const STALE_RUNNING_MINUTES = 10;
/** Conversations whose messages call fails for another reason are skipped, up to this many. */
const SKIPPABLE_ERRORS = 3;
const INPUT_MAX_CHARS = 40_000;
const MESSAGE_MAX_CHARS = 600;
const ANALYSIS_TIMEOUT_MS = 90_000;
/** Meta allows 2 calls a second per Instagram account. */
const CALL_GAP_MS = 500;
/** What the agent reads of `manager_examples` (store-settings.service.ts, MAX_MANAGER_EXAMPLES). */
const AGENT_EXAMPLES = 8;
/** Tags the examples this import adds, so applying again replaces them and leaves the owner's own. */
export const HISTORY_EXAMPLE_TAG = 'instagram-history';
/** `app_state` row holding the app-wide pause on Meta's message-read budget. */
export const BUDGET_KEY = 'instagram_history_budget';
/** Advisory lock taken around a claim, so two processes can't each claim a store. Any app-unique number. */
export const CLAIM_LOCK = 7_301_942;

const FACT_SECTIONS = ['delivery', 'payment', 'returns', 'contacts', 'hours'] as const satisfies readonly HistoryFactSection[];

/** A price in an example would go stale; the agent must take prices from the catalog. */
const PRICE = /\d[\d\s]*(?:грн|₴|uah|гривень|гривні)/iu;

const ANALYSIS_INSTRUCTIONS = `You study a small Ukrainian Instagram shop's past direct-message chats, to set up the AI sales assistant that will answer its customers. Each exchange is what a customer wrote and the reply a person at the shop wrote. Personal data was replaced with tokens such as [телефон], [ім'я], [номер], and a customer message that only gave delivery details is «[дані для доставки]».

Rules:
- Use only what the chats show. Never invent anything. Prefer what the shop repeats across conversations over a one-off.
- Write everything in Ukrainian.
- tone: one short paragraph (2–4 sentences) on how the shop writes, as guidance for the assistant, about the shop as «ми»: «ви» or «ти», how it greets and thanks, emoji (which, how often), message length, warmth, typical phrases.
- traits: 3–6 chips of 1–3 words each, e.g. «на «ви»», «коротко», «з емодзі», «тепло».
- examples: up to 8 typical exchanges that show the shop's manner (greeting, delivery, payment, sizing advice, thanks). Clean them lightly (typos, unrelated parts), keep the shop's wording and emoji. Leave out any exchange that names a price, stock, which sizes are in stock, an order or parcel number, a person's name, or a token in square brackets: those change or are private. Prefer replies that would still be right for another customer.
- facts: up to 20 of the shop's terms as managers told them to customers, each one plain sentence with its section: delivery (carriers, how fast orders ship, who pays, a free-delivery threshold), payment (ways to pay, prepayment), returns (exchange and return terms), contacts (other ways to reach the shop, a physical shop), hours (when managers answer). count = how many different conversations said it. Leave out product prices, personal data, and anything said once that the shop contradicts elsewhere.`;

const analysisSchema = z.object({
  tone: z.string(),
  traits: z.array(z.string()),
  examples: z.array(z.object({ customer: z.string(), manager: z.string() })),
  facts: z.array(z.object({ section: z.enum(FACT_SECTIONS), text: z.string(), count: z.number() })),
});

export type HistoryAnalysis = Pick<HistoryImport, 'tone' | 'traits' | 'examples' | 'facts'>;

/** A customer's message(s) and the reply a person at the shop wrote right after. */
export interface Exchange {
  customer: string;
  manager: string;
}

interface ReadThread {
  /** The customer's username and name, to redact. */
  names: string[];
  messages: GraphMessage[];
}

interface ReadResult {
  threads: ReadThread[];
  read: number;
  messages: number;
  /** `budget`: usage reached the ceiling; `limited`: Meta refused (code 4). Either pauses the whole app. */
  stop: 'done' | 'budget' | 'limited';
}

/** The run lost its claim: consent was withdrawn, or the import was reset. Nothing more is read or written. */
class RunStopped extends Error {}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The exchanges in one conversation where a person at the shop replied: each
 * human reply (consecutive messages joined) with the customer's message(s)
 * right before it. A shop message is human when it predates the DirectMate
 * connection, or when it is one the store's manager typed (`managerMids`, the
 * echoes saved as `manager` messages). Anything else from the shop after the
 * connection is taken for the bot's, and closes the customer's turn without an
 * exchange. `clean` redacts each message before it's joined.
 */
export function humanExchanges(
  messages: readonly GraphMessage[],
  accountId: string,
  connectedAt: Date,
  managerMids: ReadonlySet<string>,
  clean: { customer?: (text: string) => string; manager?: (text: string) => string } = {},
): Exchange[] {
  const ordered = [...messages].sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
  const out: Exchange[] = [];
  let asked: string[] = [];
  let reply: string[] = [];
  const close = () => {
    if (asked.length > 0 && reply.length > 0) {
      out.push({ customer: clip(asked.join('\n'), MESSAGE_MAX_CHARS), manager: clip(reply.join('\n'), MESSAGE_MAX_CHARS) });
    }
    asked = [];
    reply = [];
  };

  for (const message of ordered) {
    const raw = message.message?.trim();
    if (message.from?.id !== accountId) {
      if (reply.length > 0) close();
      const text = raw && (clean.customer ? clean.customer(raw) : raw);
      // Several delivery-detail messages in a row become one token.
      if (text && asked[asked.length - 1] !== text) asked.push(text);
      continue;
    }
    const byPerson = Date.parse(message.created_time) < connectedAt.getTime() || managerMids.has(message.id);
    if (!byPerson) {
      close();
      continue;
    }
    // A message the shop starts with (no question before it) isn't a reply.
    if (raw && asked.length > 0) reply.push(clean.manager ? clean.manager(raw) : raw);
  }
  close();
  return out;
}

/** The customer's side of a conversation: usernames and names to redact. */
function customerNames(conversation: GraphConversation, messages: readonly GraphMessage[], accountId: string): string[] {
  const names = new Set<string>();
  for (const p of conversation.participants?.data ?? []) {
    if (p.id === accountId) continue;
    if (p.username) names.add(p.username);
    if (p.name) names.add(p.name);
  }
  for (const m of messages) if (m.from && m.from.id !== accountId && m.from.username) names.add(m.from.username);
  return [...names];
}

/** Worth trying again later: no answer, Meta's side failing, a timeout, the model, the database. A 4xx from Graph is not. */
function isTransient(err: unknown): boolean {
  if (err instanceof GraphRequestError) return err.status === 0 || err.status >= 500;
  return true;
}

/**
 * The Instagram history import: reads a store's recent DMs once, at setup,
 * and keeps only what was learned from them (tone, traits, example replies,
 * the shop's terms) in `tenant_onboarding.history_import`. Raw messages,
 * usernames and the token are never stored.
 *
 * Meta's message-read budget is per app, so this is one queue for the whole
 * app: a cron claims the oldest waiting store and runs it alone, pacing by
 * the `x-app-usage` header. A code 4 or a reading at the ceiling pauses every
 * store's reads for an hour (`app_state`), because calls made while blocked
 * keep the block going (docs/v2-agent/ig-conversation-history.md).
 */
@Injectable()
export class HistoryImportService {
  private readonly logger = new Logger(HistoryImportService.name);
  private busy = false;
  /** Pause between Graph calls; tests set it to 0. */
  callGapMs = CALL_GAP_MS;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly graph: GraphHistoryClient,
    private readonly models: AgentModelFactory,
    private readonly config: ConfigService,
  ) {}

  async get(tenantId: string): Promise<HistoryImportView> {
    const [row]: Array<{ history_import: HistoryImport | null; instagram: boolean }> = await this.dataSource.query(
      `SELECT o.history_import,
              EXISTS (SELECT 1 FROM connections c
                       WHERE c.tenant_id = t.id AND c.type = 'instagram' AND c.status = 'connected') AS instagram
         FROM tenants t
         LEFT JOIN tenant_onboarding o ON o.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId],
    );
    return { instagramConnected: !!row?.instagram, import: row?.history_import ?? null };
  }

  /**
   * The Instagram step's switch. Turning it off stops everything, in any
   * state: a waiting or running import is called off (a running one stops at
   * its next check) and what was learned is deleted.
   */
  async setConsent(tenantId: string, read: boolean): Promise<HistoryImportView> {
    await this.dataSource.query(
      `INSERT INTO tenant_onboarding (tenant_id, completed_at, history_import)
       SELECT $1, CASE WHEN (SELECT operating_mode FROM store_configs WHERE tenant_id = $1) = 'active' THEN now() END,
              jsonb_build_object('consent', $2::boolean, 'status', 'idle')
       ON CONFLICT (tenant_id) DO UPDATE SET
         history_import = CASE
           WHEN $2::boolean
             THEN coalesce(tenant_onboarding.history_import, jsonb_build_object('status', 'idle')) || jsonb_build_object('consent', true)
           ELSE (coalesce(tenant_onboarding.history_import, '{}'::jsonb)
                  - ARRAY['tone', 'traits', 'examples', 'facts', 'stats', 'analyzedAt', 'retryAfter', 'error',
                          'runId', 'startedAt', 'queuedAt', 'toppedUp', 'attempts'])
                || jsonb_build_object('consent', false, 'status', 'idle')
         END,
         updated_at = now()`,
      [tenantId, read],
    );
    return this.get(tenantId);
  }

  /**
   * Queue the import. Idempotent: an import already waiting, running or
   * finished is left as it is; one that failed is queued again.
   */
  async request(tenantId: string): Promise<HistoryImportView> {
    const view = await this.get(tenantId);
    if (!view.instagramConnected) {
      throw new BadRequestException({ message: 'Connect Instagram first', details: { reason: 'instagram_not_connected' } });
    }
    if (!view.import?.consent) {
      throw new BadRequestException({ message: 'The owner has not agreed to have chats read', details: { reason: 'no_consent' } });
    }
    await this.dataSource.query(
      `UPDATE tenant_onboarding
          SET history_import = history_import || jsonb_build_object(
                'status', 'queued', 'queuedAt', now(), 'startedAt', null, 'retryAfter', null, 'runId', null,
                'toppedUp', false, 'attempts', 0, 'error', null),
              updated_at = now()
        WHERE tenant_id = $1
          AND history_import->>'consent' = 'true'
          AND coalesce(history_import->>'status', 'idle') IN ('idle', 'failed')`,
      [tenantId],
    );
    return this.get(tenantId);
  }

  /**
   * The owner approved the tone and examples (possibly edited): the tone
   * becomes the store's, the examples replace any earlier ones from history,
   * and the tone step counts as done. The agent reads the 8 newest examples,
   * so history fills only the room the owner's own examples leave.
   */
  async apply(tenantId: string, input: { tone: string; examples: HistoryExample[] }): Promise<void> {
    const view = await this.get(tenantId);
    if (view.import?.status !== 'done' || !view.import.consent) {
      throw new BadRequestException({ message: 'Nothing to apply yet', details: { reason: 'not_ready' } });
    }
    const tone = input.tone.trim().slice(0, 2000);
    const examples = input.examples
      .map((e) => ({ customer: e.customer.trim().slice(0, 1000), manager: e.manager.trim().slice(0, 1000) }))
      .filter((e) => e.customer && e.manager);

    let added = 0;
    await this.dataSource.transaction(async (manager) => {
      if (tone) {
        await manager.query(
          `INSERT INTO tenant_settings (tenant_id, brand_tone_prompt) VALUES ($1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET brand_tone_prompt = $2, updated_at = now()`,
          [tenantId, tone],
        );
      }
      await manager.query(`DELETE FROM manager_examples WHERE tenant_id = $1 AND $2 = ANY(tags)`, [tenantId, HISTORY_EXAMPLE_TAG]);
      const [{ own }]: Array<{ own: number }> = await manager.query(
        `SELECT count(*)::int AS own FROM manager_examples WHERE tenant_id = $1 AND is_active AND NOT ($2 = ANY(tags))`,
        [tenantId, HISTORY_EXAMPLE_TAG],
      );
      const room = Math.max(0, AGENT_EXAMPLES - own);
      for (const [i, e] of examples.slice(0, room).entries()) {
        // A second apart, first newest: the agent reads them newest first, in the order the owner saw.
        await manager.query(
          `INSERT INTO manager_examples (tenant_id, customer_message, manager_reply, tags, created_at)
           VALUES ($1, $2, $3, $4, now() - make_interval(secs => $5))`,
          [tenantId, e.customer, e.manager, [HISTORY_EXAMPLE_TAG], i],
        );
        added += 1;
      }
      await manager.query(
        `UPDATE tenant_onboarding SET history_import = history_import || '{"applied": true}'::jsonb, updated_at = now()
          WHERE tenant_id = $1`,
        [tenantId],
      );
    });
    this.logger.log(`History tone and ${added} of ${examples.length} examples applied for ${tenantId}`);
  }

  // ─── The queue ──────────────────────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.config.get<boolean>('historyImport.workerEnabled')) return;
    if (this.busy) return;
    this.busy = true;
    try {
      await this.queueConnected();
      await this.recoverStale();
      await this.holdForBudget();
      const job = await this.claim();
      if (job) await this.run(job.tenantId, job.state);
    } catch (err) {
      this.logger.error(`History import tick failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Stores that agreed to the read and have Instagram connected, but whose
   * import was never requested (the owner closed the tab on the way back from
   * Meta): queue them, so the agreement isn't lost. During a budget pause
   * `holdForBudget` turns them `limited` right after.
   */
  async queueConnected(): Promise<void> {
    await this.dataSource.query(
      `UPDATE tenant_onboarding o
          SET history_import = o.history_import || jsonb_build_object(
                'status', 'queued', 'queuedAt', now(), 'startedAt', null, 'retryAfter', null, 'runId', null,
                'toppedUp', false, 'attempts', 0, 'error', null),
              updated_at = now()
        WHERE o.history_import->>'consent' = 'true'
          AND coalesce(o.history_import->>'status', 'idle') = 'idle'
          AND EXISTS (SELECT 1 FROM connections c
                       WHERE c.tenant_id = o.tenant_id AND c.type = 'instagram' AND c.status = 'connected')`,
    );
  }

  /**
   * A `running` import with no heartbeat for 10 minutes was cut off by a
   * restart: queue it again (that counts as an attempt), so it can't stay
   * `running`, or keep the owner's page polling, forever.
   */
  async recoverStale(): Promise<void> {
    await this.dataSource.query(
      `UPDATE tenant_onboarding
          SET history_import = history_import || CASE
                WHEN coalesce((history_import->>'attempts')::int, 0) + 1 >= $2
                  THEN jsonb_build_object('status', 'failed', 'runId', null, 'error', 'The import was cut off',
                                          'attempts', coalesce((history_import->>'attempts')::int, 0) + 1)
                ELSE jsonb_build_object('status', 'queued', 'runId', null,
                                        'attempts', coalesce((history_import->>'attempts')::int, 0) + 1)
              END,
              updated_at = now()
        WHERE history_import->>'status' = 'running'
          AND coalesce((history_import->>'startedAt')::timestamptz, '-infinity') < now() - make_interval(mins => $1)`,
      [STALE_RUNNING_MINUTES, MAX_ATTEMPTS],
    );
  }

  /** While the app is paused, waiting imports show as `limited` until the pause ends (and the owner's page stops polling). */
  async holdForBudget(): Promise<void> {
    await this.dataSource.query(
      `UPDATE tenant_onboarding o
          SET history_import = o.history_import || jsonb_build_object('status', 'limited', 'retryAfter', b.value->>'pausedUntil'),
              updated_at = now()
         FROM app_state b
        WHERE b.key = $1
          AND (b.value->>'pausedUntil')::timestamptz > now()
          AND o.history_import->>'consent' = 'true'
          AND o.history_import->>'status' IN ('queued', 'limited')
          AND coalesce((o.history_import->>'retryAfter')::timestamptz, '-infinity') < (b.value->>'pausedUntil')::timestamptz`,
      [BUDGET_KEY],
    );
  }

  /**
   * The oldest import that may run now (queued, or limited with its hour up),
   * marked running with a fresh run id. Nothing is claimed while the app's
   * budget is paused or another store's import runs. The advisory lock comes
   * first, in its own statement, so the claim's snapshot already sees a run
   * another process committed while this one waited.
   */
  async claim(): Promise<{ tenantId: string; state: HistoryImport } | null> {
    return this.dataSource.transaction(async (manager) => {
      const [{ locked }]: Array<{ locked: boolean }> = await manager.query(`SELECT pg_try_advisory_xact_lock($1) AS locked`, [CLAIM_LOCK]);
      if (!locked) return null;
      const raw = await manager.query(
        `UPDATE tenant_onboarding o
            SET history_import = o.history_import || jsonb_build_object('status', 'running', 'startedAt', now(), 'runId', $2::text),
                updated_at = now()
          WHERE o.tenant_id = (
            SELECT c.tenant_id FROM tenant_onboarding c
             WHERE c.history_import->>'consent' = 'true'
               AND c.history_import->>'status' IN ('queued', 'limited')
               AND (c.history_import->>'retryAfter' IS NULL OR (c.history_import->>'retryAfter')::timestamptz <= now())
               AND NOT EXISTS (SELECT 1 FROM tenant_onboarding r WHERE r.history_import->>'status' = 'running')
               AND NOT EXISTS (SELECT 1 FROM app_state b
                                WHERE b.key = $1 AND (b.value->>'pausedUntil')::timestamptz > now())
             ORDER BY (c.history_import->>'queuedAt')::timestamptz ASC NULLS LAST
             LIMIT 1
             FOR UPDATE SKIP LOCKED)
          RETURNING o.tenant_id, o.history_import`,
        [BUDGET_KEY, randomUUID()],
      );
      const [row] = returnedRows<{ tenant_id: string; history_import: HistoryImport }>(raw);
      return row ? { tenantId: row.tenant_id, state: row.history_import } : null;
    });
  }

  /**
   * One store's import, start to finish. Never throws. A budget stop leaves
   * it waiting without counting an attempt; a passing error retries with
   * back-off; a lasting one is `failed`; a withdrawn consent writes nothing.
   */
  async run(tenantId: string, state: HistoryImport): Promise<void> {
    const runId = state.runId ?? '';
    try {
      const account = await this.graph.account(tenantId);
      if (!account) {
        await this.finish(tenantId, runId, { status: 'failed', error: 'Instagram is not connected' });
        return;
      }
      const read = await this.read(tenantId, runId, account);
      const exchanges = await this.exchanges(tenantId, account, read.threads);
      const stats = { conversations: read.read, messages: read.messages, humanReplies: exchanges.length };
      this.logger.log(
        `History import ${tenantId}: ${read.read} conversations, ${read.messages} messages, ${exchanges.length} human replies (${read.stop})`,
      );

      if (exchanges.length < MIN_HUMAN_REPLIES) {
        const retryAfter = new Date(Date.now() + RETRY_MS).toISOString();
        if (read.stop !== 'done') {
          // Stopped by the budget, not because the store is quiet: wait for the app's pause to end.
          await this.finish(tenantId, runId, { status: 'limited', stats, retryAfter });
        } else if (!state.toppedUp) {
          await this.finish(tenantId, runId, { status: 'queued', stats, retryAfter, toppedUp: true });
        } else {
          await this.finish(tenantId, runId, { status: 'empty', stats, retryAfter: null });
        }
        return;
      }

      await this.heartbeat(tenantId, runId);
      const analysis = await this.analyse(exchanges);
      await this.finish(tenantId, runId, {
        status: 'done',
        stats,
        ...analysis,
        applied: false,
        analyzedAt: new Date().toISOString(),
        retryAfter: null,
        error: null,
      });
    } catch (err) {
      if (err instanceof RunStopped) {
        this.logger.log(`History import ${tenantId} stopped: consent withdrawn or the import was reset`);
        return;
      }
      const message = err instanceof GraphRequestError ? `Graph ${err.status}: ${err.message}` : (err as Error).message;
      const attempts = (state.attempts ?? 0) + 1;
      const retry = isTransient(err) && attempts < MAX_ATTEMPTS;
      this.logger.warn(`History import ${tenantId} ${retry ? `will retry (attempt ${attempts})` : 'failed'}: ${message}`);
      await this.finish(
        tenantId,
        runId,
        retry
          ? { status: 'queued', attempts, error: clip(message, 200), retryAfter: new Date(Date.now() + BACKOFF_MS(attempts)).toISOString() }
          : { status: 'failed', attempts, error: clip(message, 200) },
      ).catch((e) => this.logger.error(`History import ${tenantId}: couldn't record the failure: ${(e as Error).message}`));
    }
  }

  /**
   * Conversations newest first; keep those the shop replied in. Stops at
   * enough conversations, at the budget ceiling, or when Meta refuses; checks
   * before every call that the run still holds (consent, not reset).
   */
  private async read(tenantId: string, runId: string, account: InstagramAccount): Promise<ReadResult> {
    const result: ReadResult = { threads: [], read: 0, messages: 0, stop: 'done' };
    let skipped = 0;
    let after: string | null = null;
    try {
      do {
        await this.heartbeat(tenantId, runId);
        const page = await this.graph.conversations(account, after);
        for (const conversation of page.conversations) {
          await this.gap();
          await this.heartbeat(tenantId, runId);
          let messages: GraphMessage[];
          let usage: number | null;
          try {
            ({ messages, usage } = await this.graph.messages(account, conversation.id));
          } catch (err) {
            const tokenProblem = err instanceof GraphRequestError && (err.status === 401 || err.code === 190);
            if (err instanceof GraphRequestError && !tokenProblem && ++skipped <= SKIPPABLE_ERRORS) continue;
            throw err;
          }
          result.read += 1;
          result.messages += messages.length;
          if (messages.some((m) => m.from?.id === account.accountId)) {
            result.threads.push({ names: customerNames(conversation, messages, account.accountId), messages });
          }
          if (usage !== null) {
            await this.recordUsage(usage);
            if (usage >= USAGE_CEILING) return { ...result, stop: 'budget' };
          }
          if (result.threads.length >= WANT_CONVERSATIONS || result.read >= MAX_READ) return result;
        }
        after = page.next;
        if (after) await this.gap();
      } while (after);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        await this.pauseApp();
        return { ...result, stop: 'limited' };
      }
      throw err;
    }
    return result;
  }

  /**
   * Human replies across the threads, redacted. After the connection a shop
   * message counts only if it's one the manager typed: the echo saved as a
   * `manager` message (`instagram_sent_mids` can't say, it's pruned after 30
   * days and older bot ids have another format).
   */
  private async exchanges(tenantId: string, account: InstagramAccount, threads: ReadThread[]): Promise<Array<Exchange & { conversation: number }>> {
    const after = threads.flatMap((t) =>
      t.messages.filter((m) => m.from?.id === account.accountId && Date.parse(m.created_time) >= account.connectedAt.getTime()).map((m) => m.id),
    );
    const typed = new Set<string>();
    if (after.length > 0) {
      const rows: Array<{ mid: string }> = await this.dataSource.query(
        `SELECT external_message_id AS mid FROM messages
          WHERE tenant_id = $1 AND role = 'manager' AND external_message_id = ANY($2::text[])`,
        [tenantId, after],
      );
      for (const r of rows) typed.add(r.mid);
    }
    return threads.flatMap((t, i) =>
      humanExchanges(t.messages, account.accountId, account.connectedAt, typed, {
        customer: (text) => redactCustomer(text, t.names),
        manager: (text) => redact(text, t.names),
      }).map((e) => ({ conversation: i + 1, ...e })),
    );
  }

  /** One model call: the tone, its chips, example replies and the shop's terms. */
  async analyse(exchanges: Array<Exchange & { conversation: number }>): Promise<HistoryAnalysis> {
    const blocks: string[] = [];
    let size = 0;
    let current = 0;
    for (const e of exchanges) {
      const block = `${e.conversation !== current ? `### Розмова ${e.conversation}\n` : ''}Клієнт: ${e.customer}\nМагазин: ${e.manager}`;
      if (size + block.length > INPUT_MAX_CHARS) break;
      blocks.push(block);
      size += block.length + 2;
      current = e.conversation;
    }

    const resolved = this.models.resolve({});
    const result = await generateText({
      model: resolved.model,
      instructions: ANALYSIS_INSTRUCTIONS,
      output: Output.object({ schema: analysisSchema, name: 'shop_profile' }),
      messages: [{ role: 'user', content: blocks.join('\n\n') }],
      providerOptions: resolved.providerOptions,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });
    if (!result.output) throw new Error('The analysis returned nothing');
    return cleanAnalysis(result.output);
  }

  // ─── The app-wide budget ────────────────────────────────────

  /** The latest `x-app-usage` reading; at the ceiling, every store's reads pause until the reading is an hour old. */
  private async recordUsage(usage: number): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO app_state (key, value)
       VALUES ($1, jsonb_build_object('usage', $2::numeric, 'usageAt', now(),
                 'pausedUntil', CASE WHEN $2::numeric >= $3 THEN now() + interval '1 hour' END))
       ON CONFLICT (key) DO UPDATE SET
         value = app_state.value || jsonb_build_object('usage', $2::numeric, 'usageAt', now())
                 || CASE WHEN $2::numeric >= $3 THEN jsonb_build_object('pausedUntil', now() + interval '1 hour') ELSE '{}'::jsonb END,
         updated_at = now()`,
      [BUDGET_KEY, usage, USAGE_CEILING],
    );
  }

  /** Meta refused (code 4 or another throttle): nobody reads for an hour. */
  private async pauseApp(): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO app_state (key, value) VALUES ($1, jsonb_build_object('pausedUntil', now() + interval '1 hour'))
       ON CONFLICT (key) DO UPDATE SET
         value = app_state.value || jsonb_build_object('pausedUntil', now() + interval '1 hour'), updated_at = now()`,
      [BUDGET_KEY],
    );
  }

  // ─── Writing the run's state ────────────────────────────────

  /** Still this run's, with consent: refresh `startedAt`. Otherwise stop the run where it is. */
  private async heartbeat(tenantId: string, runId: string): Promise<void> {
    const raw = await this.dataSource.query(
      `UPDATE tenant_onboarding SET history_import = history_import || jsonb_build_object('startedAt', now())
        WHERE tenant_id = $1 AND history_import->>'runId' = $2
          AND history_import->>'status' = 'running' AND history_import->>'consent' = 'true'
        RETURNING tenant_id`,
      [tenantId, runId],
    );
    if (returnedRows(raw).length === 0) throw new RunStopped();
  }

  /** The run's outcome, written only while the run still holds the import and consent stands. */
  private async finish(tenantId: string, runId: string, patch: Partial<HistoryImport>): Promise<void> {
    await this.dataSource.query(
      `UPDATE tenant_onboarding SET history_import = history_import || $3::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND history_import->>'runId' = $2 AND history_import->>'consent' = 'true'`,
      [tenantId, runId, JSON.stringify({ ...patch, runId: null })],
    );
  }

  private gap(): Promise<void> {
    return this.callGapMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.callGapMs)) : Promise.resolve();
  }
}

/** Trim and cap what the model returned; drop examples that carry a price, a name or anything personal. */
export function cleanAnalysis(out: z.infer<typeof analysisSchema>): HistoryAnalysis {
  const traits = [...new Set(out.traits.map((t) => t.trim()).filter(Boolean))].map((t) => clip(t, 40)).slice(0, 6);
  const examples = out.examples
    .map((e) => ({ customer: e.customer.trim(), manager: e.manager.trim() }))
    .filter((e) => e.customer && e.manager)
    .filter((e) => !PRICE.test(`${e.customer}\n${e.manager}`) && !hasPersonalData(`${e.customer}\n${e.manager}`))
    .map((e) => ({ customer: clip(e.customer, 500), manager: clip(e.manager, 500) }))
    .slice(0, 8);
  const facts: HistoryFact[] = out.facts
    .map((f) => ({ section: f.section, text: f.text.trim(), count: Math.max(1, Math.round(f.count) || 1) }))
    .filter((f) => (FACT_SECTIONS as readonly string[]).includes(f.section) && f.text && !hasPersonalData(f.text))
    .map((f) => ({ ...f, text: clip(f.text, 300) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { tone: out.tone.trim() ? clip(out.tone.trim(), 1500) : null, traits, examples, facts };
}
