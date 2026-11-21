import { BadRequestException } from '@nestjs/common';
import { MockLanguageModelV4 } from 'ai/test';
import { GraphHistoryClient, GraphRequestError, RateLimitedError, parseAppUsage, type GraphMessage } from './graph-history.client';
import { BUDGET_KEY, CLAIM_LOCK, HISTORY_EXAMPLE_TAG, HistoryImportService, cleanAnalysis, humanExchanges } from './history-import.service';
import type { HistoryImport } from './history-import.types';

const SHOP = 'shop-ig';
const CONNECTED = new Date('2026-11-01T00:00:00Z');
const RUN = 'run-1';

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

const ANALYSIS = {
  tone: 'Звертаємося на «ви», тепло й коротко. Вітаємося «Добрий день», дякуємо за замовлення, емодзі зрідка 🙂.',
  traits: ['на «ви»', 'коротко', 'тепло', 'на «ви»', 'з емодзі', 'без канцеляриту', 'ввічливо', 'зайвий'],
  examples: [
    { customer: 'Коли відправите?', manager: 'Відправимо сьогодні до 16:00 🙂' },
    { customer: 'Скільки коштує?', manager: 'Сукня — 2 450 грн' },
    { customer: 'Мій номер', manager: 'Записали ваш [телефон]' },
    { customer: 'Дякую!', manager: 'Дякуємо, Олено! Гарного дня' },
    { customer: 'Ось дані', manager: 'Отримувач Іваненко Олена, все вірно?' },
  ],
  facts: [
    { section: 'payment', text: 'Накладений платіж або передоплата на картку', count: 2 },
    { section: 'delivery', text: 'Відправляємо Новою Поштою за 1–2 дні', count: 6.4 },
    { section: 'contacts', text: 'Телефон магазину [телефон]', count: 3 },
  ],
};

function msg(id: string, from: string, at: string, message?: string): GraphMessage {
  return { id, from: { id: from }, created_time: at, ...(message !== undefined ? { message } : {}) };
}

/** A conversation as Graph returns it (newest first): the customer asks, sends a phone, the shop answers. */
function thread(n: number, opts: { reply?: boolean; at?: string } = {}): GraphMessage[] {
  const at = opts.at ?? `2026-10-${String(10 + (n % 15)).padStart(2, '0')}`;
  const out = [
    msg(`c${n}-1`, `user-${n}`, `${at}T10:00:00Z`, `Привіт! Це olena${n}. Коли відправите?`),
    msg(`c${n}-2`, `user-${n}`, `${at}T10:01:00Z`, 'Мій номер 0671234567'),
  ];
  if (opts.reply !== false) out.push(msg(`s${n}-1`, SHOP, `${at}T10:05:00Z`, `Добрий день, olena${n}! Відправимо сьогодні 🙂`));
  return out.reverse();
}

function respond(body: unknown, opts: { status?: number; usage?: number } = {}): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.usage !== undefined) headers.set('x-app-usage', JSON.stringify({ call_count: 2, total_time: opts.usage, total_cputime: 1 }));
  return new Response(JSON.stringify(body), { status: opts.status ?? 200, headers });
}

const LIMIT_REACHED = { error: { message: '(#4) Application request limit reached', type: 'OAuthException', code: 4, is_transient: true } };

/**
 * Meta, faked: `threads` is the store's inbox (newest first); `usage(i)` is
 * the `x-app-usage` total_time after the i-th messages call (0-based); a
 * number in `limitAt` makes that messages call answer with code 4;
 * `onMessages(i)` runs before the i-th messages call answers.
 */
function fakeGraph(threads: GraphMessage[][], opts: { usage?: (i: number) => number; limitAt?: number; onMessages?: (i: number) => void } = {}) {
  const calls: string[] = [];
  let messageCalls = 0;
  const fetchMock = jest.fn(async (url: string) => {
    calls.push(url);
    const path = new URL(url).pathname.replace('/v27.0', '');
    if (path === `/${SHOP}/conversations`) {
      const after = Number(new URL(url).searchParams.get('after') ?? 0);
      const page = threads.slice(after, after + 25).map((_, i) => ({
        id: `conv-${after + i}`,
        participants: { data: [{ id: SHOP, username: 'lliana.store' }, { id: `user-${after + i}`, username: `olena${after + i}` }] },
      }));
      const next = after + 25 < threads.length;
      return respond({ data: page, paging: next ? { next: 'https://graph/next', cursors: { after: String(after + 25) } } : {} });
    }
    const i = messageCalls++;
    opts.onMessages?.(i);
    if (opts.limitAt === i) return respond(LIMIT_REACHED, { status: 403, usage: 104 });
    const index = Number(path.replace('/conv-', ''));
    return respond({ id: `conv-${index}`, messages: { data: threads[index] } }, { usage: opts.usage?.(i) ?? 5 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { calls, messageCalls: () => messageCalls };
}

interface SetupOpts {
  state?: Partial<HistoryImport>;
  connected?: boolean;
  connectedAt?: Date;
  /** Mids saved as `manager` messages (the echoes of what the manager typed). */
  managerMids?: string[];
  model?: MockLanguageModelV4;
  /** The owner's own active examples (not from history), for the cap on applied ones. */
  ownExamples?: number;
  workerEnabled?: boolean;
}

/**
 * A fake database that keeps the store's `history_import` row and the app's
 * budget row, and answers the statements the service sends by their shape.
 */
function setup(opts: SetupOpts = {}) {
  const row: HistoryImport = { consent: true, status: 'running', runId: RUN, ...opts.state };
  const budget: Record<string, unknown> = {};
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown> => {
    if (sql.includes('access_token_encrypted')) {
      return opts.connected === false ? [] : [{ external_account_id: SHOP, access_token_encrypted: 'enc', created_at: opts.connectedAt ?? CONNECTED }];
    }
    if (sql.includes('FROM messages') && sql.includes("role = 'manager'")) {
      return (params[1] as string[]).filter((id) => opts.managerMids?.includes(id)).map((mid) => ({ mid }));
    }
    if (sql.includes('FROM tenants t')) return [{ history_import: row, instagram: opts.connected !== false }];
    if (sql.includes("jsonb_build_object('startedAt', now())")) {
      const holds = row.runId === params[1] && row.status === 'running' && row.consent;
      return holds ? [[{ tenant_id: params[0] }], 1] : [[], 0];
    }
    if (sql.includes('history_import || $3::jsonb')) {
      writes.push({ sql, params });
      if (row.runId === params[1] && row.consent) Object.assign(row, JSON.parse(params[2] as string));
      return [[], 0];
    }
    if (sql.includes('INSERT INTO app_state')) {
      writes.push({ sql, params });
      if (params.length === 1 || (params[1] as number) >= (params[2] as number)) budget.pausedUntil = 'in an hour';
      if (params.length > 1) budget.usage = params[1];
      return [];
    }
    if (sql.includes('SELECT count(*)::int AS own')) return [{ own: opts.ownExamples ?? 0 }];
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
    writes.push({ sql, params });
    return [];
  });
  const dataSource = { query, transaction: async <T>(fn: (m: { query: typeof query }) => Promise<T>) => fn({ query }) };
  const graph = new GraphHistoryClient(dataSource as never, { decrypt: () => 'token' } as never);
  const model = opts.model ?? new MockLanguageModelV4({ doGenerate: [text(JSON.stringify(ANALYSIS))] });
  const config = { get: (key: string) => (key === 'historyImport.workerEnabled' ? (opts.workerEnabled ?? true) : undefined) };
  const service = new HistoryImportService(dataSource as never, graph, { resolve: () => ({ model, providerOptions: {} }) } as never, config as never);
  service.callGapMs = 0;
  return { service, row, budget, writes, query, model };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('humanExchanges', () => {
  it("pairs each person's reply with the customer's messages right before it", () => {
    const out = humanExchanges(thread(1), SHOP, CONNECTED, new Set());
    expect(out).toEqual([
      { customer: 'Привіт! Це olena1. Коли відправите?\nМій номер 0671234567', manager: 'Добрий день, olena1! Відправимо сьогодні 🙂' },
    ]);
  });

  it('joins consecutive replies, skips photo-only messages and messages the shop starts with', () => {
    const messages = [
      msg('s0', SHOP, '2026-10-01T09:00:00Z', 'Нова колекція вже на сайті!'),
      msg('c1', 'u', '2026-10-01T10:00:00Z', 'Є розмір M?'),
      msg('c2', 'u', '2026-10-01T10:00:30Z'),
      msg('s1', SHOP, '2026-10-01T10:02:00Z', 'Так, є'),
      msg('s2', SHOP, '2026-10-01T10:02:10Z'),
      msg('s3', SHOP, '2026-10-01T10:02:20Z', 'Оформлюємо?'),
      msg('c3', 'u', '2026-10-01T10:05:00Z', 'Так'),
    ].reverse();
    expect(humanExchanges(messages, SHOP, CONNECTED, new Set())).toEqual([{ customer: 'Є розмір M?', manager: 'Так, є\nОформлюємо?' }]);
  });

  it("after connecting, keeps only what the manager typed (saved echoes) and drops everything else as the bot's", () => {
    const messages = [
      msg('c1', 'u', '2026-11-02T10:00:00Z', 'Скільки доставка?'),
      msg('bot-1', SHOP, '2026-11-02T10:00:10Z', 'За тарифами перевізника.'),
      msg('c2', 'u', '2026-11-02T10:01:00Z', 'А можна завтра?'),
      msg('mgr-1', SHOP, '2026-11-02T10:10:00Z', 'Так, відправимо завтра зранку'),
    ];
    expect(humanExchanges(messages, SHOP, CONNECTED, new Set(['mgr-1']))).toEqual([
      { customer: 'А можна завтра?', manager: 'Так, відправимо завтра зранку' },
    ]);
  });

  it('counts every shop message before the connection as human', () => {
    const messages = [msg('c1', 'u', '2026-10-30T10:00:00Z', 'Привіт'), msg('x', SHOP, '2026-10-30T10:01:00Z', 'Вітаємо!')];
    expect(humanExchanges(messages, SHOP, CONNECTED, new Set())).toHaveLength(1);
  });

  it('collapses consecutive delivery-detail messages into one token', () => {
    const messages = [
      msg('c1', 'u', '2026-10-01T10:00:00Z', 'Іваненко Олена'),
      msg('c2', 'u', '2026-10-01T10:00:10Z', '0671234567'),
      msg('c3', 'u', '2026-10-01T10:00:20Z', 'Київ, НП 25'),
      msg('s1', SHOP, '2026-10-01T10:05:00Z', 'Дякуємо, оформили!'),
    ];
    const out = humanExchanges(messages, SHOP, CONNECTED, new Set(), { customer: () => '[дані для доставки]' });
    expect(out).toEqual([{ customer: '[дані для доставки]', manager: 'Дякуємо, оформили!' }]);
  });
});

describe('HistoryImportService', () => {
  describe('reading and pacing', () => {
    it('reads newest first, redacts, analyses and saves only the conclusions', async () => {
      const graph = fakeGraph(Array.from({ length: 8 }, (_, i) => thread(i)));
      const t = setup();
      await t.service.run('t1', t.row);

      expect(graph.messageCalls()).toBe(8);
      expect(graph.calls[0]).toContain(`/${SHOP}/conversations?platform=instagram&fields=id%2Cupdated_time%2Cparticipants&limit=25`);
      expect(decodeURIComponent(graph.calls[1])).toContain('/conv-0?fields=messages.limit(20){id,created_time,from,message}');

      // The model saw redacted exchanges: the phone message is one token, the username and the vocative are gone.
      const prompt = JSON.stringify(t.model.doGenerateCalls[0].prompt);
      expect(prompt).toContain("Клієнт: Привіт! Це [ім'я]. Коли відправите?\\n[дані для доставки]");
      expect(prompt).toContain('Магазин: Добрий день! Відправимо сьогодні');
      expect(prompt).not.toMatch(/0671234567|olena\d/);

      expect(t.row.status).toBe('done');
      expect(t.row.stats).toEqual({ conversations: 8, messages: 24, humanReplies: 8 });
      expect(t.row.tone).toContain('на «ви»');
      expect(t.row.traits).toEqual(['на «ви»', 'коротко', 'тепло', 'з емодзі', 'без канцеляриту', 'ввічливо']);
      // A price, a token, a vocative name or a full name never become examples or facts.
      expect(t.row.examples).toEqual([{ customer: 'Коли відправите?', manager: 'Відправимо сьогодні до 16:00 🙂' }]);
      expect(t.row.facts).toEqual([
        { section: 'delivery', text: 'Відправляємо Новою Поштою за 1–2 дні', count: 6 },
        { section: 'payment', text: 'Накладений платіж або передоплата на картку', count: 2 },
      ]);
      expect(t.row.applied).toBe(false);
      expect(t.row.runId).toBeNull();
      // Nothing raw is written.
      expect(JSON.stringify([t.row, t.writes.map((w) => w.params)])).not.toMatch(/0671234567|olena\d|token|Привіт! Це/);
    });

    it('keeps conversations the shop replied in, and stops at 30 of them', async () => {
      const graph = fakeGraph(Array.from({ length: 50 }, (_, i) => thread(i, { reply: i % 5 !== 0 })));
      const t = setup();
      await t.service.run('t1', t.row);
      // 30 with a reply needs 38 conversations (every fifth has none); paging moved past the first 25.
      expect(graph.messageCalls()).toBe(38);
      expect(t.row.stats).toEqual({ conversations: 38, messages: 38 * 3 - 8, humanReplies: 30 });
    });

    it('stops at 60 conversations read, however few the shop replied in', async () => {
      const graph = fakeGraph(Array.from({ length: 80 }, (_, i) => thread(i, { reply: i < 6 })));
      const t = setup();
      await t.service.run('t1', t.row);
      expect(graph.messageCalls()).toBe(60);
      expect(t.row.status).toBe('done');
    });

    it('refreshes its heartbeat before every Graph call', async () => {
      fakeGraph(Array.from({ length: 6 }, (_, i) => thread(i)));
      const t = setup();
      await t.service.run('t1', t.row);
      const beats = t.query.mock.calls.filter(([sql]) => sql.includes("jsonb_build_object('startedAt', now())"));
      // One before the conversation list, one before each of the 6 messages calls, one before the analysis.
      expect(beats).toHaveLength(8);
      expect(beats[0][1]).toEqual(['t1', RUN]);
    });
  });

  describe('the app-wide budget pause', () => {
    it('at 75 % usage: records the reading with an hour-long pause for every store, and analyses what is in hand', async () => {
      const graph = fakeGraph(Array.from({ length: 20 }, (_, i) => thread(i)), { usage: (i) => (i < 5 ? 10 + i * 10 : 80) });
      const t = setup();
      await t.service.run('t1', t.row);

      expect(graph.messageCalls()).toBe(6);
      const readings = t.writes.filter((w) => w.sql.includes('INSERT INTO app_state'));
      expect(readings.map((w) => w.params)).toEqual([10, 20, 30, 40, 50, 80].map((u) => [BUDGET_KEY, u, 75]));
      expect(readings[0].sql).toMatch(/WHEN \$2::numeric >= \$3 THEN jsonb_build_object\('pausedUntil', now\(\) \+ interval '1 hour'\)/);
      expect(t.budget.pausedUntil).toBeTruthy();
      expect(t.row).toMatchObject({ status: 'done', stats: { humanReplies: 6 } });
    });

    it('on code 4: pauses the app for an hour; the store waits without counting an attempt', async () => {
      const graph = fakeGraph(Array.from({ length: 20 }, (_, i) => thread(i)), { limitAt: 2 });
      const t = setup({ state: { attempts: 2 } });
      const before = Date.now();
      await t.service.run('t1', t.row);

      expect(graph.messageCalls()).toBe(3);
      const pause = t.writes.find((w) => w.sql.includes('INSERT INTO app_state') && w.params.length === 1)!;
      expect(pause.sql).toContain("'pausedUntil', now() + interval '1 hour'");
      expect(t.row.status).toBe('limited');
      expect(t.row.attempts).toBe(2);
      expect(Date.parse(t.row.retryAfter!) - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
      expect(t.model.doGenerateCalls).toHaveLength(0);
    });

    it('on code 4 with enough replies in hand: analyses them', async () => {
      fakeGraph(Array.from({ length: 20 }, (_, i) => thread(i)), { limitAt: 7 });
      const t = setup();
      await t.service.run('t1', t.row);
      expect(t.row).toMatchObject({ status: 'done', stats: { conversations: 7, humanReplies: 7 } });
    });

    it("doesn't spend the top-up when the budget, not a quiet store, stopped the read", async () => {
      fakeGraph(Array.from({ length: 10 }, (_, i) => thread(i)), { usage: () => 90 });
      const t = setup();
      await t.service.run('t1', t.row);
      expect(t.row.status).toBe('limited');
      expect(t.row.toppedUp).toBeUndefined();
    });

    it('claims nothing while paused, and shows waiting stores as limited until the pause ends', async () => {
      const t = setup();
      await t.service.claim();
      const claim = t.query.mock.calls.find(([sql]) => sql.includes("'status', 'running'"))!;
      expect(claim[0]).toMatch(/NOT EXISTS \(SELECT 1 FROM app_state b\s+WHERE b.key = \$1 AND \(b.value->>'pausedUntil'\)::timestamptz > now\(\)\)/);
      expect(claim[1]![0]).toBe(BUDGET_KEY);

      await t.service.holdForBudget();
      const hold = t.writes.at(-1)!;
      expect(hold.sql).toMatch(/jsonb_build_object\('status', 'limited', 'retryAfter', b.value->>'pausedUntil'\)/);
      expect(hold.sql).toMatch(/IN \('queued', 'limited'\)/);
      expect(hold.params).toEqual([BUDGET_KEY]);
    });
  });

  describe('the claim', () => {
    it('takes the advisory lock first, in its own statement, then claims one store with a fresh run id', async () => {
      const t = setup();
      t.query
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([[{ tenant_id: 't9', history_import: { consent: true, status: 'running', runId: 'r' } }], 1]);
      const job = await t.service.claim();

      expect(job).toEqual({ tenantId: 't9', state: { consent: true, status: 'running', runId: 'r' } });
      const [lock, claim] = t.query.mock.calls;
      expect(lock).toEqual(['SELECT pg_try_advisory_xact_lock($1) AS locked', [CLAIM_LOCK]]);
      expect(claim[0]).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(claim[0]).toMatch(/history_import->>'consent' = 'true'/);
      expect(claim[0]).toMatch(/NOT EXISTS \(SELECT 1 FROM tenant_onboarding r WHERE r.history_import->>'status' = 'running'\)/);
      expect(claim[0]).toMatch(/ORDER BY \(c.history_import->>'queuedAt'\)::timestamptz ASC/);
      expect(claim[1]![1]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('claims nothing when another process holds the lock', async () => {
      const t = setup();
      t.query.mockResolvedValueOnce([{ locked: false }]);
      expect(await t.service.claim()).toBeNull();
      expect(t.query).toHaveBeenCalledTimes(1);
    });

    it('returns null when nothing is due', async () => {
      const t = setup();
      t.query.mockResolvedValueOnce([{ locked: true }]).mockResolvedValueOnce([[], 0]);
      expect(await t.service.claim()).toBeNull();
    });

    it('queues a stale run again (as an attempt), and fails it after too many', async () => {
      const t = setup();
      await t.service.recoverStale();
      const { sql, params } = t.writes.at(-1)!;
      expect(sql).toMatch(/WHERE history_import->>'status' = 'running'/);
      expect(sql).toMatch(/'status', 'queued'/);
      expect(sql).toMatch(/'status', 'failed'/);
      expect(params).toEqual([10, 4]);
    });

    it("doesn't start a second run while one is in progress, never throws, and stays off when disabled", async () => {
      const t = setup();
      let release!: () => void;
      const claim = jest.spyOn(t.service, 'claim').mockResolvedValue({ tenantId: 't1', state: t.row });
      const run = jest.spyOn(t.service, 'run').mockImplementation(() => new Promise<void>((r) => (release = r)));
      const first = t.service.tick();
      while (run.mock.calls.length === 0) await Promise.resolve();
      await t.service.tick();
      expect(claim).toHaveBeenCalledTimes(1);
      release();
      await first;

      claim.mockRejectedValueOnce(new Error('db down'));
      await expect(t.service.tick()).resolves.toBeUndefined();

      const off = setup({ workerEnabled: false });
      await off.service.tick();
      expect(off.query).not.toHaveBeenCalled();
    });
  });

  describe('human replies after the connection', () => {
    it("drops a bot reply older than 30 days (its sent id long pruned) and keeps the manager's typed replies", async () => {
      // Connected in August: by November, instagram_sent_mids holds nothing from September.
      const inbox = [
        ...Array.from({ length: 3 }, (_, i) => thread(i, { at: '2026-09-05' })),
        ...Array.from({ length: 5 }, (_, i) => thread(i + 3, { at: '2026-09-06' })),
      ];
      fakeGraph(inbox);
      const t = setup({ connectedAt: new Date('2026-08-01T00:00:00Z'), managerMids: ['s3-1', 's4-1', 's5-1', 's6-1', 's7-1'] });
      await t.service.run('t1', t.row);

      expect(t.row).toMatchObject({ status: 'done', stats: { humanReplies: 5 } });
      const lookup = t.query.mock.calls.find(([sql]) => sql.includes('FROM messages'))!;
      expect(lookup[0]).toMatch(/role = 'manager' AND external_message_id = ANY\(\$2::text\[\]\)/);
      expect(lookup[1]).toEqual(['t1', ['s0-1', 's1-1', 's2-1', 's3-1', 's4-1', 's5-1', 's6-1', 's7-1']]);
      // The bot's three replies didn't reach the model.
      expect(JSON.stringify(t.model.doGenerateCalls[0].prompt).match(/Магазин:/g)).toHaveLength(5);
    });
  });

  describe('consent withdrawn', () => {
    it('mid-run: stops reading, calls no model and writes nothing', async () => {
      const graph = fakeGraph(Array.from({ length: 20 }, (_, i) => thread(i)), {
        onMessages: (i) => {
          // What setConsent(false) leaves: idle, no consent, no run.
          if (i === 2) Object.assign(t.row, { consent: false, status: 'idle', runId: undefined });
        },
      });
      const t = setup();
      await t.service.run('t1', t.row);

      expect(graph.messageCalls()).toBe(3);
      expect(t.model.doGenerateCalls).toHaveLength(0);
      expect(t.row).toEqual({ consent: false, status: 'idle', runId: undefined });
      // The only results write is refused by its consent and run checks.
      expect(t.writes.filter((w) => w.sql.includes('history_import || $3::jsonb'))).toHaveLength(0);
    });

    it('before the analysis: no model call', async () => {
      fakeGraph(Array.from({ length: 6 }, (_, i) => thread(i)), {
        onMessages: (i) => {
          if (i === 5) t.row.consent = false;
        },
      });
      const t = setup();
      await t.service.run('t1', t.row);
      expect(t.model.doGenerateCalls).toHaveLength(0);
      expect(t.row.status).toBe('running');
    });

    it('results are written only while the run holds the import and consent stands', async () => {
      fakeGraph(Array.from({ length: 6 }, (_, i) => thread(i)));
      const t = setup();
      await t.service.run('t1', t.row);
      const finish = t.writes.find((w) => w.sql.includes('history_import || $3::jsonb'))!;
      expect(finish.sql).toMatch(/history_import->>'runId' = \$2 AND history_import->>'consent' = 'true'/);
    });

    it('setConsent(false) idles the import in every state and deletes what was learned', async () => {
      const t = setup();
      await t.service.setConsent('t1', false);
      const write = t.writes.find((w) => w.sql.includes('INSERT INTO tenant_onboarding'))!;
      expect(write.params).toEqual(['t1', false]);
      expect(write.sql).toMatch(/ELSE \(coalesce\(tenant_onboarding.history_import, '\{\}'::jsonb\)\s+- ARRAY\['tone', 'traits', 'examples', 'facts'/);
      expect(write.sql).toMatch(/'runId'/);
      expect(write.sql).toMatch(/\|\| jsonb_build_object\('consent', false, 'status', 'idle'\)/);
      // No condition on the current status: running and done are reset too.
      expect(write.sql).not.toMatch(/IN \('queued', 'limited'\)/);
    });
  });

  describe('too few replies by a person', () => {
    it('queues one top-up an hour later', async () => {
      fakeGraph([thread(0), thread(1), thread(2, { reply: false })]);
      const t = setup();
      await t.service.run('t1', t.row);
      expect(t.row).toMatchObject({ status: 'queued', toppedUp: true, stats: { humanReplies: 2 } });
      expect(Date.parse(t.row.retryAfter!)).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
      expect(t.model.doGenerateCalls).toHaveLength(0);
    });

    it('is empty when the top-up finds too few as well', async () => {
      fakeGraph([thread(0), thread(1)]);
      const t = setup({ state: { toppedUp: true } });
      await t.service.run('t1', t.row);
      expect(t.row).toMatchObject({ status: 'empty', stats: { humanReplies: 2 } });
    });
  });

  describe('errors', () => {
    it('a lasting Graph error (bad token) fails the import', async () => {
      global.fetch = jest.fn(async () => respond({ error: { message: 'Invalid OAuth access token', code: 190 } }, { status: 401 })) as never;
      const t = setup();
      await expect(t.service.run('t1', t.row)).resolves.toBeUndefined();
      expect(t.row).toMatchObject({ status: 'failed', attempts: 1 });
      expect(t.row.error).toContain('Invalid OAuth access token');
    });

    it('a passing error (no answer, a 5xx, the model) retries with back-off, then fails after four', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('socket hang up');
      }) as never;
      const t = setup();
      const before = Date.now();
      await t.service.run('t1', t.row);
      expect(t.row).toMatchObject({ status: 'queued', attempts: 1 });
      expect(Date.parse(t.row.retryAfter!) - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);

      global.fetch = jest.fn(async () => respond({ error: { message: 'Service unavailable', code: 2 } }, { status: 503 })) as never;
      const again = setup({ state: { attempts: 1 } });
      await again.service.run('t1', again.row);
      expect(again.row).toMatchObject({ status: 'queued', attempts: 2 });
      expect(Date.parse(again.row.retryAfter!) - Date.now()).toBeGreaterThan(14 * 60 * 1000);

      fakeGraph(Array.from({ length: 6 }, (_, i) => thread(i)));
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error('model overloaded');
        },
      });
      const last = setup({ state: { attempts: 3 }, model });
      await last.service.run('t1', last.row);
      expect(last.row).toMatchObject({ status: 'failed', attempts: 4 });
    });

    it('fails without a connected account', async () => {
      const t = setup({ connected: false });
      await t.service.run('t1', t.row);
      expect(t.row).toMatchObject({ status: 'failed', error: 'Instagram is not connected' });
    });

    it('skips a conversation whose messages call fails for another reason', async () => {
      fakeGraph(Array.from({ length: 6 }, (_, i) => thread(i)));
      const fetchMock = global.fetch as jest.Mock;
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (url: string) =>
        url.includes('/conv-2?') ? respond({ error: { message: 'Unsupported get request', code: 100 } }, { status: 400 }) : original(url),
      );
      const t = setup();
      await t.service.run('t1', t.row);
      expect(t.row).toMatchObject({ status: 'done', stats: { conversations: 5, humanReplies: 5 } });
    });
  });

  describe('request', () => {
    it('requires Instagram and consent', async () => {
      await expect(setup({ connected: false }).service.request('t1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(setup({ state: { consent: false, status: 'idle' } }).service.request('t1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('queues only an import that is idle or failed (idempotent)', async () => {
      const t = setup({ state: { status: 'idle' } });
      const view = await t.service.request('t1');
      expect(view.instagramConnected).toBe(true);
      const update = t.writes.find((w) => w.sql.includes("'status', 'queued'"))!;
      expect(update.sql).toMatch(/IN \('idle', 'failed'\)/);
      expect(update.sql).toMatch(/'toppedUp', false, 'attempts', 0/);
    });
  });

  describe('apply', () => {
    const examples = Array.from({ length: 8 }, (_, i) => ({ customer: ` Питання ${i} `, manager: `Відповідь ${i}` }));

    it('writes the tone, replaces earlier history examples and marks the tone step done', async () => {
      const t = setup({ state: { status: 'done' } });
      await t.service.apply('t1', { tone: '  На «ви», тепло.  ', examples: [{ customer: ' ', manager: 'x' }, ...examples] });

      const tone = t.writes.find((w) => w.sql.includes('INSERT INTO tenant_settings'))!;
      expect(tone.sql).toMatch(/ON CONFLICT \(tenant_id\) DO UPDATE SET brand_tone_prompt = \$2/);
      expect(tone.params).toEqual(['t1', 'На «ви», тепло.']);
      const del = t.writes.find((w) => w.sql.startsWith('DELETE FROM manager_examples'))!;
      expect(del.params).toEqual(['t1', HISTORY_EXAMPLE_TAG]);
      const inserts = t.writes.filter((w) => w.sql.includes('INSERT INTO manager_examples'));
      expect(inserts).toHaveLength(8);
      // A second apart, first newest, so the agent reads them in the order the owner saw.
      expect(inserts.map((w) => w.params[4])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(inserts[0].sql).toContain('now() - make_interval(secs => $5)');
      expect(inserts[0].params.slice(0, 4)).toEqual(['t1', 'Питання 0', 'Відповідь 0', [HISTORY_EXAMPLE_TAG]]);
      expect(t.writes.at(-1)!.sql).toContain('"applied": true');
      expect(t.writes.indexOf(del)).toBeLessThan(t.writes.indexOf(inserts[0]));
    });

    it("fills only the room the owner's own examples leave of the 8 the agent reads", async () => {
      const t = setup({ state: { status: 'done' }, ownExamples: 5 });
      await t.service.apply('t1', { tone: 'x', examples });
      expect(t.writes.filter((w) => w.sql.includes('INSERT INTO manager_examples')).map((w) => w.params[1])).toEqual([
        'Питання 0',
        'Питання 1',
        'Питання 2',
      ]);

      const full = setup({ state: { status: 'done' }, ownExamples: 9 });
      await full.service.apply('t1', { tone: 'x', examples });
      expect(full.writes.some((w) => w.sql.includes('INSERT INTO manager_examples'))).toBe(false);
      expect(full.writes.at(-1)!.sql).toContain('"applied": true');
    });

    it('keeps the saved tone when the owner cleared it', async () => {
      const t = setup({ state: { status: 'done' } });
      await t.service.apply('t1', { tone: ' ', examples: [] });
      expect(t.writes.some((w) => w.sql.includes('tenant_settings'))).toBe(false);
    });

    it('refuses before the import is done, or without consent', async () => {
      const t = setup({ state: { status: 'running' } });
      await expect(t.service.apply('t1', { tone: 'x', examples: [] })).rejects.toBeInstanceOf(BadRequestException);
      const withdrawn = setup({ state: { status: 'done', consent: false } });
      await expect(withdrawn.service.apply('t1', { tone: 'x', examples: [] })).rejects.toBeInstanceOf(BadRequestException);
      expect(t.writes).toHaveLength(0);
    });
  });
});

describe('cleanAnalysis', () => {
  it('caps the lists and keeps a fact count of at least one', () => {
    const out = cleanAnalysis({
      tone: '  ',
      traits: [],
      examples: Array.from({ length: 12 }, (_, i) => ({ customer: `Питання ${i}`, manager: `Відповідь ${i}` })),
      facts: Array.from({ length: 25 }, (_, i) => ({ section: 'delivery' as const, text: `Факт ${i}`, count: i === 0 ? 0 : i })),
    });
    expect(out.tone).toBeNull();
    expect(out.examples).toHaveLength(8);
    expect(out.facts).toHaveLength(20);
    expect(out.facts![0].count).toBe(24);
    expect(Math.min(...out.facts!.map((f) => f.count))).toBeGreaterThanOrEqual(1);
  });
});

describe('GraphHistoryClient', () => {
  const account = { accountId: SHOP, token: 'tkn', api: 'https://graph.facebook.com/v27.0', connectedAt: CONNECTED };
  const igAccount = { ...account, api: 'https://graph.instagram.com/v27.0' };
  const client = () => new GraphHistoryClient({} as never, {} as never);

  it('reads the usage as the highest of the three numbers', () => {
    expect(parseAppUsage('{"call_count":19,"total_time":126,"total_cputime":40}')).toBe(126);
    expect(parseAppUsage(null)).toBeNull();
    expect(parseAppUsage('not json')).toBeNull();
  });

  it('sends the token as a bearer header and returns the usage', async () => {
    const fetchMock = jest.fn(async () => respond({ messages: { data: [msg('m1', 'u', '2026-10-01T00:00:00Z', 'hi')] } }, { usage: 21 }));
    global.fetch = fetchMock as never;
    const res = await client().messages(account, 'conv-1');
    expect(res).toEqual({ messages: [msg('m1', 'u', '2026-10-01T00:00:00Z', 'hi')], usage: 21 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v27\.0\/conv-1\?fields=/);
    expect(init.headers).toEqual({ Authorization: 'Bearer tkn' });
  });

  it('turns code 4 into RateLimitedError and anything else into GraphRequestError', async () => {
    global.fetch = jest.fn(async () => respond(LIMIT_REACHED, { status: 403 })) as never;
    await expect(client().messages(account, 'c')).rejects.toBeInstanceOf(RateLimitedError);

    global.fetch = jest.fn(async () => respond({ error: { message: 'Bad', code: 100 } }, { status: 400 })) as never;
    await expect(client().messages(account, 'c')).rejects.toMatchObject({ name: 'GraphRequestError', status: 400, code: 100 });

    global.fetch = jest.fn(async () => {
      throw new Error('socket hang up');
    }) as never;
    const err = await client().messages(account, 'c').catch((e) => e);
    expect(err).toBeInstanceOf(GraphRequestError);
    expect(err.status).toBe(0);
  });

  it('reads an Instagram Login connection on graph.instagram.com', async () => {
    const fetchMock = jest.fn(async () => respond({ messages: { data: [msg('m1', 'u', '2026-10-01T00:00:00Z', 'hi')] } }));
    global.fetch = fetchMock as never;
    await client().messages(igAccount, 'conv-1');
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/graph\.instagram\.com\/v27\.0\/conv-1\?fields=/);
  });

  it("reads each message by id when the conversation lists only the messages' ids, skipping one it can't read", async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn(async (url: string) => {
        if (url.includes('/conv-1?')) {
          return respond({ messages: { data: [{ id: 'm1', created_time: 'a' }, { id: 'm2', created_time: 'b' }, { id: 'm3', created_time: 'c' }] } });
        }
        if (url.includes('/m2?')) return respond({ error: { message: 'deleted', code: 100 } }, { status: 400 });
        const id = url.includes('/m1?') ? 'm1' : 'm3';
        return respond(msg(id, 'u', '2026-10-01T00:00:00Z', `text ${id}`));
      });
      global.fetch = fetchMock as never;
      const pending = client().messages(igAccount, 'conv-1');
      await jest.runAllTimersAsync();
      const res = await pending;
      expect(res.messages.map((m) => m.message)).toEqual(['text m1', 'text m3']);
      expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe('https://graph.instagram.com/v27.0/m1?fields=id,created_time,from,message');
    } finally {
      jest.useRealTimers();
    }
  });

  it('pages the conversation list by cursor', async () => {
    const fetchMock = jest.fn(async () => respond({ data: [{ id: 'c1' }], paging: { next: 'https://x', cursors: { after: 'CUR' } } }));
    global.fetch = fetchMock as never;
    const page = await client().conversations(account, 'PREV');
    expect(page).toEqual({ conversations: [{ id: 'c1' }], next: 'CUR', usage: null });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('after=PREV');
  });
});
