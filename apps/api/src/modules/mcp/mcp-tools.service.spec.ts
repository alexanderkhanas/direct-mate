import { HttpException } from '@nestjs/common';
import { FeedError } from '../catalog-feeds/feed-fetcher';
import type { OnboardingStatus, OnboardingStepKey } from '../onboarding/onboarding.service';
import { emptyDraft } from '../onboarding/store-notes';
import { McpToolsService } from './mcp-tools.service';

const ORDER: OnboardingStepKey[] = ['products', 'instagram', 'knowledge', 'sizes', 'test', 'tone', 'telegram', 'live'];

function status(done: OnboardingStepKey[]): OnboardingStatus {
  return {
    completed: false,
    operatingMode: 'paused',
    steps: ORDER.map((key) => ({ key, state: done.includes(key) ? 'done' : 'todo', blocking: false })),
    readiness: { ready: false, missing: ['knowledge'] },
    store: { name: 'Alta', businessType: 'fashion', instagram: null, feedUrl: null, products: { total: 0, inStock: 0 } },
    supportAvailable: false,
  } as OnboardingStatus;
}

type Perm = { allowed: boolean; since: string | null; decided: boolean };
const perm = (allowed: boolean, decided = allowed): Perm => ({ allowed, since: allowed ? '2026-11-20T00:00:00.000Z' : null, decided });

function setup(
  opts: {
    done?: OnboardingStepKey[];
    doc?: string | null;
    read?: Perm;
    reply?: Perm;
    history?: Record<string, unknown> | null;
    advice?: 'recommend' | 'consult';
    charts?: Array<{ id: string; brands: string[]; categories: string[] }>;
    matching?: number;
  } = {},
) {
  const dataSource = {
    query: jest.fn(async (sql: string) =>
      sql.includes("'sizing'") ? [{ advice: opts.advice ?? null }] : [{ knowledge_doc: opts.doc ?? null, checkout_config: null }],
    ),
  };
  const config = { get: jest.fn((key: string) => (key === 'app.baseUrl' ? 'https://directmate.app' : undefined)) };
  const onboarding = { status: jest.fn(async () => status(opts.done ?? [])), skip: jest.fn(async () => undefined) };
  const notes = { mergeAndApply: jest.fn(async (_t: string, patch: { sections?: Record<string, string> }) => ({ ...emptyDraft(), sections: patch.sections ?? {} })) };
  const testChat = {
    reset: jest.fn(async () => undefined),
    send: jest.fn(async () => ({ messages: [{ role: 'bot', text: 'Вітаю!', imageUrls: ['/uploads/p/1.jpg'] }], handoff: false, status: 'replied' })),
  };
  const feeds = {
    status: jest.fn(async () => ({ feed: null, jobs: [] })),
    preview: jest.fn(),
    connect: jest.fn(),
  };
  const telegram = { generateConnectToken: jest.fn(async () => ({ token: 'x', deepLink: 'https://t.me/DirectMateBot?start=x' })) };
  const settings = { updateSettings: jest.fn(async () => ({ success: true })) };
  const storeConfig = {
    setOperatingMode: jest.fn(async (): Promise<unknown> => ({ ok: true, wentLive: true })),
    setSizingAdvice: jest.fn(async () => undefined),
  };
  const subscriptions = {
    getPlanForTenant: jest.fn(async () => ({
      plan: { planType: 'trial', trialEndsAt: null },
      usage: { used: 0, limit: 200, percentUsed: 0 },
      trialDaysRemaining: null,
      active: true,
      trialStarted: false,
    })),
  };
  const handoffs = { issue: jest.fn(async (_t: string, action: string) => ({ url: `https://directmate.app/claude/${action}?t=tok`, expiresInSeconds: 600 })) };
  const events = { record: jest.fn(async () => undefined) };
  const current = () => ({ read_messages: opts.read ?? perm(false), reply_to_customers: opts.reply ?? perm(false) });
  const permissions = {
    get: jest.fn(async () => current()),
    set: jest.fn(async (): Promise<unknown> => ({ permissions: current() })),
  };
  const history = { get: jest.fn(async () => ({ instagramConnected: true, import: opts.history ?? null })) };
  const sizeCharts = {
    listTenantBrands: jest.fn(async () => ['Lliana', 'Monte']),
    listTenantCategories: jest.fn(async () => ['Сукні', 'Штани']),
    matchCount: jest.fn(async () => ({ count: opts.matching ?? 5, total: 10 })),
    listForTenant: jest.fn(async () => opts.charts ?? []),
    listWithCounts: jest.fn(async () => []),
    coverage: jest.fn(async () => ({ total: 10, covered: 5, uncovered: 5, uncoveredBrands: [], uncoveredCategories: ['Штани'] })),
    sizesFor: jest.fn(async () => ['S', 'M', 'L', 'XL']),
    createFromTable: jest.fn(async (_t: string, dto: Record<string, unknown>) => ({ id: 'chart-new', ...dto })),
    update: jest.fn(async (_t: string, id: string, dto: Record<string, unknown>) => ({ id, ...dto })),
    delete: jest.fn(async () => undefined),
  };
  const tools = new McpToolsService(
    dataSource as never,
    config as never,
    onboarding as never,
    notes as never,
    testChat as never,
    feeds as never,
    telegram as never,
    settings as never,
    storeConfig as never,
    subscriptions as never,
    handoffs as never,
    events as never,
    permissions as never,
    history as never,
    sizeCharts as never,
  );
  return { tools, onboarding, notes, testChat, feeds, storeConfig, handoffs, events, permissions, history, sizeCharts };
}

/** Two sizes of a chart printed in inches, as Claude would send it. */
const chestInches = {
  measurements: [{ key: 'chest' as const, unit: 'in' as const }],
  rows: [
    { size: 'S', cells: [{ key: 'chest' as const, min: 34, max: 36 }] },
    { size: 'M', cells: [{ key: 'chest' as const, min: 37, max: 39, uncertain: true }] },
  ],
};

describe('McpToolsService', () => {
  afterEach(() => jest.useRealTimers());

  it('reports the status with what to do next', async () => {
    const { tools } = setup();
    const result = await tools.getSetupStatus('t1');
    expect(result.next?.step).toBe('products');
    expect(result.plan).toMatchObject({ type: 'trial', trial_started: false, agent_may_answer: true });
  });

  describe('connect_catalog', () => {
    it('imports a feed that finishes in time and records the funnel step', async () => {
      const { tools, feeds, events } = setup();
      feeds.connect.mockResolvedValue({ feed: { products: 64, warnings: [] }, jobs: [] });
      const result = await tools.connectCatalog('t1', { source: 'feed', url: 'https://alta.ua/feed.xml' });
      expect(result).toMatchObject({ importing: false, products: 64 });
      expect(events.record).toHaveBeenCalledWith('t1', 'catalog_connected');
    });

    it('answers «still importing» when the import is slow, and lets it finish by itself', async () => {
      jest.useFakeTimers();
      const { tools, feeds, events } = setup();
      let finish!: (v: unknown) => void;
      feeds.connect.mockReturnValue(new Promise((r) => (finish = r)));
      const pending = tools.connectCatalog('t1', { source: 'feed', url: 'https://alta.ua/feed.xml' });
      await jest.advanceTimersByTimeAsync(26_000);
      const result = await pending;
      expect(result.importing).toBe(true);
      expect((await tools.getSetupStatus('t1')).catalog).toMatchObject({ importing: true });

      finish({ feed: { products: 64, warnings: [] }, jobs: [] });
      await jest.advanceTimersByTimeAsync(0);
      expect(events.record).toHaveBeenCalledWith('t1', 'catalog_connected');
      expect((await tools.getSetupStatus('t1')).catalog).toMatchObject({ importing: false });
    });

    it('returns a feed problem as data, with its code', async () => {
      const { tools, feeds, events } = setup();
      feeds.connect.mockRejectedValue(new FeedError('not_public', 'The link needs a login'));
      const result = await tools.connectCatalog('t1', { source: 'feed', url: 'https://alta.ua/feed.xml' });
      expect(result.error).toEqual({ code: 'not_public', message: 'The link needs a login' });
      expect(events.record).not.toHaveBeenCalled();
    });

    it('gives a link for Shopify instead of taking a token in chat', async () => {
      const { tools, feeds, handoffs } = setup();
      const result = await tools.connectCatalog('t1', { source: 'shopify' });
      expect(handoffs.issue).toHaveBeenCalledWith('t1', 'shopify');
      expect(result.link).toContain('/claude/shopify?t=');
      expect(feeds.connect).not.toHaveBeenCalled();
    });
  });

  describe('save_store_notes', () => {
    it('says which key sections are still empty', async () => {
      const { tools } = setup({ done: ['products', 'instagram'] });
      const result = await tools.saveStoreNotes('t1', { sections: { delivery: '- Нова пошта' } });
      expect(result.missing_sections).toEqual(['payment', 'returns', 'contacts']);
      expect(result.warnings).toEqual([]);
    });

    it('warns that a promise word in the notes lets the agent promise it', async () => {
      const { tools } = setup();
      const result = await tools.saveStoreNotes('t1', { sections: { other: '- Знижка 10% на другу річ' } });
      expect(result.warnings).toHaveLength(1);
      expect((result.warnings as string[])[0]).toContain('discounts');
    });

    it('does not warn about a promise the notes refuse', async () => {
      const { tools } = setup();
      const result = await tools.saveStoreNotes('t1', { sections: { other: '- Знижок немає' } });
      expect(result.warnings).toEqual([]);
    });
  });

  describe('try_agent', () => {
    it('returns the replies as untrusted content with absolute image links', async () => {
      const { tools, events } = setup();
      const result = await tools.tryAgent('t1', { message: 'Привіт' });
      expect(result.untrusted_content).toEqual({
        customer_message: 'Привіт',
        replies: [{ text: 'Вітаю!', images: ['https://directmate.app/uploads/p/1.jpg'] }],
      });
      expect(JSON.stringify(result.next)).not.toContain('Вітаю');
      expect(events.record).toHaveBeenCalledWith('t1', 'first_try_agent');
    });

    it('explains an empty answer when the agent was busy', async () => {
      const { tools, testChat } = setup();
      testChat.send.mockResolvedValue({ messages: [], handoff: false, status: 'busy' } as never);
      const result = await tools.tryAgent('t1', { message: 'Привіт' });
      expect(result.status).toBe('busy');
      expect(result.note).toContain('Send it again');
    });

    it('returns the hourly limit as data', async () => {
      const { tools, testChat } = setup();
      testChat.send.mockRejectedValue(new HttpException('Too many test messages this hour', 429));
      const result = await tools.tryAgent('t1', { message: 'Привіт' });
      expect(result.error?.code).toBe('rate_limited');
    });

    it('starts over when asked', async () => {
      const { tools, testChat } = setup();
      await tools.tryAgent('t1', { message: 'Привіт', newConversation: true });
      expect(testChat.reset).toHaveBeenCalledWith('t1');
    });
  });

  describe('go_live', () => {
    it('does nothing without the owner’s confirmation', async () => {
      const { tools, storeConfig } = setup({ done: ORDER.filter((k) => k !== 'live') });
      const result = await tools.goLive('t1', { mode: 'active', confirmed: false });
      expect(result.error?.code).toBe('not_confirmed');
      expect(storeConfig.setOperatingMode).not.toHaveBeenCalled();
    });

    it('refuses learning mode before Instagram is connected', async () => {
      const { tools, storeConfig } = setup({ done: ['products'] });
      const result = await tools.goLive('t1', { mode: 'learning', confirmed: true });
      expect(result.error).toMatchObject({ code: 'not_ready', details: { missing: ['instagram'] } });
      expect(storeConfig.setOperatingMode).not.toHaveBeenCalled();
    });

    it('says what is missing when the store is not ready to be turned on', async () => {
      const { tools, storeConfig, events } = setup({ done: ['products', 'instagram'] });
      storeConfig.setOperatingMode.mockResolvedValue({ ok: false, missing: ['knowledge'] });
      const result = await tools.goLive('t1', { mode: 'active', confirmed: true });
      expect(result.error).toMatchObject({ code: 'not_ready', details: { missing: ['knowledge'] } });
      expect(events.record).not.toHaveBeenCalled();
    });

    it('names the permission active mode needs', async () => {
      const { tools, storeConfig } = setup({ done: ['products', 'instagram'] });
      storeConfig.setOperatingMode.mockResolvedValue({ ok: false, missing: ['reply_permission'] });
      const result = await tools.goLive('t1', { mode: 'active', confirmed: true });
      expect(result.error).toMatchObject({ code: 'permission_needed' });
      expect(result.error?.message).toMatch(/reply_to_customers/);
    });

    it('turns the agent on and records it', async () => {
      const { tools, storeConfig, events } = setup({ done: ORDER.filter((k) => k !== 'live') });
      const result = await tools.goLive('t1', { mode: 'active', confirmed: true });
      expect(storeConfig.setOperatingMode).toHaveBeenCalledWith('t1', 'active');
      expect(result.operating_mode).toBe('active');
      expect(events.record).toHaveBeenCalledWith('t1', 'go_live');
    });

    it('says that learning mode does not start the trial', async () => {
      const { tools } = setup({ done: ['products', 'instagram'] });
      const result = await tools.goLive('t1', { mode: 'learning', confirmed: true });
      expect(result.note).toContain('free trial has not started');
    });
  });

  describe('set_instagram_permission', () => {
    it('grants nothing without the owner’s confirmation', async () => {
      const { tools, permissions } = setup({ done: ['products', 'instagram'] });
      const result = await tools.setInstagramPermission('t1', { permission: 'read_messages', allowed: true });
      expect(result.error).toMatchObject({ code: 'not_confirmed' });
      expect(permissions.set).not.toHaveBeenCalled();
    });

    it('records a confirmed grant as given through Claude, by the owner who connected it', async () => {
      const { tools, permissions } = setup({ done: ['products', 'instagram'] });
      const result = await tools.setInstagramPermission('t1', { permission: 'read_messages', allowed: true, confirmed: true }, 'u1');
      expect(permissions.set).toHaveBeenCalledWith('t1', 'read_messages', true, { source: 'claude', userId: 'u1' });
      expect(String(result.note)).toMatch(/up to an hour/);
    });

    it('records a «no» without asking for confirmation', async () => {
      const { tools, permissions } = setup({ done: ['products', 'instagram'] });
      await tools.setInstagramPermission('t1', { permission: 'reply_to_customers', allowed: false });
      expect(permissions.set).toHaveBeenCalledWith('t1', 'reply_to_customers', false, { source: 'claude', userId: undefined });
    });

    it('says when withdrawing paused the agent', async () => {
      const { tools, permissions } = setup({ done: ['products', 'instagram'] });
      permissions.set.mockResolvedValueOnce({ permissions: { read_messages: perm(false, true), reply_to_customers: perm(false, true) }, operatingMode: 'paused' });
      const result = await tools.setInstagramPermission('t1', { permission: 'reply_to_customers', allowed: false });
      expect(result.operating_mode).toBe('paused');
    });
  });

  describe('permissions in the steering', () => {
    it('asks only about reading once Instagram is connected, after saying nothing is read or sent', async () => {
      const { tools } = setup({ done: ['products', 'instagram'] });
      const { next } = await tools.getSetupStatus('t1');
      expect(next?.step).toBe('permissions');
      expect(next?.ask_owner[0]).toMatch(/does not let DirectMate read your Direct, and the AI agent sends nothing/);
      expect(next?.then_call).toMatch(/"read_messages"/);
      expect(next?.then_call).not.toMatch(/set_instagram_permission with permission "reply_to_customers"/);
    });

    it('moves on to the notes once reading is answered, even with a «no», without asking about replying', async () => {
      const { tools } = setup({ done: ['products', 'instagram'], read: perm(false, true) });
      const { next } = await tools.getSetupStatus('t1');
      expect(next?.step).toBe('knowledge');
      expect(JSON.stringify(next)).not.toMatch(/reply_to_customers/);
    });

    it('reports both permissions and the import in the status', async () => {
      const { tools } = setup({ done: ['products', 'instagram'], read: perm(true), reply: perm(false, true), history: { consent: true, status: 'running' } });
      const result = await tools.getSetupStatus('t1');
      expect(result.instagram_permissions).toEqual({ read_messages: true, reply_to_customers: false });
      expect(result.history_import).toBe('running');
      expect(result.next?.then_call).toMatch(/being read/);
    });
  });

  describe('size charts', () => {
    it('saves a confirmed chart as ready: units converted, names spelled as the store has them, no picture', async () => {
      const { tools, sizeCharts } = setup();
      const result = await tools.saveSizeChart('t1', { brands: ['lliana'], ...chestInches, confirmed: true });

      expect(sizeCharts.createFromTable).toHaveBeenCalledWith('t1', {
        name: 'Lliana',
        brands: ['Lliana'],
        categories: [],
        status: 'ready',
        table: {
          measurements: [{ key: 'chest', label: 'Обхват грудей', unit: 'cm' }],
          rows: [
            { size: 'S', values: { chest: { min: 86.5, max: 91.5 } } },
            { size: 'M', values: { chest: { min: 94, max: 99 } } },
          ],
          uncertain: [{ size: 'M', key: 'chest' }],
        },
      });
      expect(result.saved).toMatchObject({ chart_id: 'chart-new', status: 'ready', products: 5 });
      expect((result.untrusted_content as Record<string, unknown>).sizes_sold_but_not_in_chart).toEqual(['L', 'XL']);
    });

    it('saves as a draft without the owner’s yes, and points at the uncertain cells', async () => {
      const { tools, sizeCharts } = setup();
      const result = await tools.saveSizeChart('t1', chestInches);
      expect(sizeCharts.createFromTable).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'draft', name: 'Усі товари' }));
      expect(result.warnings).toEqual([expect.stringContaining('M chest')]);
    });

    it('refuses names the store does not have, and a scope with no products', async () => {
      const unknown = setup();
      const bad = await unknown.tools.saveSizeChart('t1', { categories: ['Футболки'], ...chestInches, confirmed: true });
      expect(bad.error?.code).toBe('unknown_scope');
      expect(unknown.sizeCharts.createFromTable).not.toHaveBeenCalled();

      const empty = setup({ matching: 0 });
      const none = await empty.tools.saveSizeChart('t1', { brands: ['Monte'], categories: ['Сукні'], ...chestInches });
      expect(none.error?.code).toBe('no_products');
    });

    it('names the chart that already covers the same products, and replaces it when given its id', async () => {
      const charts = [{ id: '5f0c6c1e-0000-4000-8000-000000000001', brands: [], categories: ['штани'] }];
      const { tools, sizeCharts } = setup({ charts });
      const taken = await tools.saveSizeChart('t1', { categories: ['Штани'], ...chestInches });
      expect(taken.error?.code).toBe('scope_taken');

      await tools.saveSizeChart('t1', { chartId: charts[0].id, categories: ['Штани'], ...chestInches, confirmed: true });
      expect(sizeCharts.update).toHaveBeenCalledWith('t1', charts[0].id, expect.objectContaining({ status: 'ready', categories: ['Штани'] }));
      expect(sizeCharts.createFromTable).not.toHaveBeenCalled();
    });

    it('turns size advice back on when a store that chose a manager saves a ready chart', async () => {
      const { tools, storeConfig } = setup({ advice: 'consult' });
      await tools.saveSizeChart('t1', { ...chestInches, confirmed: true });
      expect(storeConfig.setSizingAdvice).toHaveBeenCalledWith('t1', 'recommend');
    });

    it('deletes a chart only with the owner’s yes', async () => {
      const { tools, sizeCharts } = setup();
      expect((await tools.deleteSizeChart('t1', { chartId: 'c1' })).error?.code).toBe('not_confirmed');
      expect(sizeCharts.delete).not.toHaveBeenCalled();
      await tools.deleteSizeChart('t1', { chartId: 'c1', confirmed: true });
      expect(sizeCharts.delete).toHaveBeenCalledWith('t1', 'c1');
    });
  });

  describe('get_history_import', () => {
    it('reads nothing without the read permission', async () => {
      const { tools } = setup();
      expect((await tools.getHistoryImport('t1')).status).toBe('not_allowed');
    });

    it('returns the terms and the tone as untrusted content, and the examples only as a review link', async () => {
      const { tools } = setup({
        read: perm(true),
        history: {
          consent: true,
          status: 'done',
          stats: { conversations: 30, messages: 400, humanReplies: 120 },
          tone: 'Пишемо на «ви», коротко.',
          traits: ['на «ви»'],
          facts: [{ section: 'delivery', text: 'Нова пошта, 1–2 дні', count: 9 }],
          examples: [{ customer: 'Є M?', manager: 'Так, є.' }],
        },
      });
      const result = await tools.getHistoryImport('t1');
      expect(result.status).toBe('done');
      expect(result.untrusted_content).toEqual({
        facts: [{ section: 'delivery', text: 'Нова пошта, 1–2 дні', count: 9 }],
        tone: 'Пишемо на «ви», коротко.',
        traits: ['на «ви»'],
      });
      expect(result.examples_to_review).toBe(1);
      expect(String(result.review_examples_url)).toMatch(/\/onboarding\?step=instagram$/);
      expect(JSON.stringify(result)).not.toContain('Є M?');
    });
  });

  it('refuses to skip a step that cannot be skipped, as data', async () => {
    const { tools, onboarding } = setup();
    onboarding.skip.mockRejectedValue(new HttpException('Step "products" can\'t be skipped', 400));
    const result = await tools.skipSetupStep('t1', 'products');
    expect(result.error?.code).toBe('invalid_request');
  });
});
