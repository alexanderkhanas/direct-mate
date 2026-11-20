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

function setup(opts: { done?: OnboardingStepKey[]; doc?: string | null } = {}) {
  const dataSource = {
    query: jest.fn(async () => [{ knowledge_doc: opts.doc ?? null, checkout_config: null }]),
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
  );
  return { tools, onboarding, notes, testChat, feeds, storeConfig, handoffs, events };
}

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

  it('refuses to skip a step that cannot be skipped, as data', async () => {
    const { tools, onboarding } = setup();
    onboarding.skip.mockRejectedValue(new HttpException('Step "products" can\'t be skipped', 400));
    const result = await tools.skipSetupStep('t1', 'products');
    expect(result.error?.code).toBe('invalid_request');
  });
});
