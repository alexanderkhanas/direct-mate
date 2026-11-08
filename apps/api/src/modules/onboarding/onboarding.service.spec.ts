import { BadRequestException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { TestChatService } from './test-chat.service';
import { DEFAULT_BRAND_TONE } from './store-defaults';

const ROW = {
  name: 'Alta',
  business_type: 'fashion',
  operating_mode: 'paused',
  flow_business: null,
  knowledge: true,
  sizing_consult: false,
  has_ranges: false,
  ready_chart: false,
  telegram: false,
  brand_tone_prompt: DEFAULT_BRAND_TONE,
  steps_skipped: ['telegram'],
  tested_at: null,
  completed_at: null,
  history_import: null,
  instagram: 'alta.men',
  feed_url: 'https://alta.example/feed.xml',
  products_total: 64,
  products_in_stock: 51,
};

function service(row: Record<string, unknown> = {}, opts: { support?: string } = {}) {
  const query = jest.fn(async (sql: string) => (sql.includes('FROM tenants t') ? [{ ...ROW, ...row }] : []));
  const readiness = { check: jest.fn(async () => ({ ready: false, missing: ['products'] })) };
  const config = { get: jest.fn((key: string) => (key === 'support.telegramUsername' ? opts.support ?? '' : undefined)) };
  const svc = new OnboardingService({ query } as never, readiness as never, config as never);
  return { svc, query };
}

describe('OnboardingService.status', () => {
  it('reads each step from the store and keeps skips for the optional ones', async () => {
    const { svc } = service();
    const status = await svc.status('t1');
    // Instagram early: its history drafts the notes and the tone.
    expect(status.steps.map((s) => [s.key, s.state, s.blocking])).toEqual([
      ['products', 'todo', true],
      ['instagram', 'done', true],
      ['knowledge', 'done', true],
      ['sizes', 'todo', false], // a clothing store
      ['test', 'todo', false],
      ['tone', 'todo', false], // the registration default isn't a choice the owner made
      ['telegram', 'skipped', false],
      ['live', 'todo', false],
    ]);
    expect(status.store).toEqual({
      name: 'Alta',
      businessType: 'fashion',
      instagram: 'alta.men',
      feedUrl: 'https://alta.example/feed.xml',
      products: { total: 64, inStock: 51 },
    });
  });

  it('counts sizes done for a chart the bot can read, «Немає сітки», or the older ranges — not an image-only chart', async () => {
    const sizes = async (row: Record<string, unknown>) => (await service(row).svc.status('t1')).steps.find((s) => s.key === 'sizes')?.state;
    expect(await sizes({})).toBe('todo');
    expect(await sizes({ ready_chart: true })).toBe('done');
    expect(await sizes({ sizing_consult: true })).toBe('done');
    expect(await sizes({ has_ranges: true })).toBe('done');
  });

  it('has no sizes step for a beauty store, and counts an own tone as done', async () => {
    const { svc } = service({ business_type: 'beauty', brand_tone_prompt: 'Пишемо тепло, на «ти».' });
    const keys = (await svc.status('t1')).steps.map((s) => s.key);
    expect(keys).not.toContain('sizes');
    expect((await svc.status('t1')).steps.find((s) => s.key === 'tone')?.state).toBe('done');
  });

  it("refuses to skip a step the bot can't work without", async () => {
    await expect(service().svc.skip('t1', 'products')).rejects.toThrow(BadRequestException);
  });

  it('builds the «set it up for me» Telegram link with what the founder needs to know', async () => {
    const { svc } = service({}, { support: '@founder' });
    const { url } = await svc.requestHelp('t1', 'owner@alta.ua', 'products');
    expect(url).toMatch(/^https:\/\/t\.me\/founder\?text=/);
    const text = decodeURIComponent(url!.split('text=')[1]);
    expect(text).toContain('Магазин: Alta');
    expect(text).toContain('Email: owner@alta.ua');
    expect(text).toContain('Instagram: @alta.men');
    expect(text).toContain('Зупинився на кроці: товари');
  });

  it('leaves the other-platform line open for the owner to name their platform', async () => {
    const { svc } = service({}, { support: 'founder' });
    const { url } = await svc.requestHelp('t1', 'owner@alta.ua', 'products', 'other_platform');
    expect(decodeURIComponent(url!.split('text=')[1]).endsWith('Хочу підключити товари з ')).toBe(true);
  });
});

describe('TestChatService', () => {
  function chat() {
    const conversations = {
      findOrCreateCustomer: jest.fn(async () => ({ id: 'cu1' })),
      findOrCreateConversation: jest.fn(async () => ({ conversation: { id: 'c1' } })),
      saveMessage: jest.fn(async () => ({ id: 'm1' })),
    };
    const turnRunner = {
      run: jest.fn(async () => ({ messages: [{ kind: 'reply', text: 'Так, є в M.' }], handoff: null })),
    };
    const onboarding = { markTested: jest.fn(async () => undefined) };
    const svc = new TestChatService({ query: jest.fn() } as never, conversations as never, turnRunner as never, {} as never, {} as never, onboarding as never);
    return { svc, conversations, turnRunner, onboarding };
  }

  it("answers on a paused store, in demo mode, in the owner's test channel", async () => {
    const t = chat();
    const result = await t.svc.send('t1', { text: 'Є сорочка в M?' });
    expect(result.messages).toEqual([{ role: 'bot', text: 'Так, є в M.' }]);
    expect(t.conversations.findOrCreateCustomer).toHaveBeenCalledWith('t1', 'test', 'owner-test');
    expect(t.turnRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'demo', source: 'owner_test', ignorePause: true }),
    );
    expect(t.onboarding.markTested).toHaveBeenCalledWith('t1');
  });

  it("only takes photos this store uploaded, never an arbitrary URL", async () => {
    const t = chat();
    await expect(t.svc.send('t1', { photoUrl: 'http://169.254.169.254/latest' })).rejects.toThrow(BadRequestException);
    await expect(t.svc.send('t1', { photoUrl: '/uploads/customer-media/other-tenant/a.jpg' })).rejects.toThrow(BadRequestException);
    await t.svc.send('t1', { photoUrl: '/uploads/customer-media/t1/a.jpg' });
    expect(t.conversations.saveMessage).toHaveBeenCalledWith(
      'c1', 't1', expect.anything(), expect.anything(), '', undefined, null,
      [{ type: 'customer_photo', mediaId: '/uploads/customer-media/t1/a.jpg', url: '/uploads/customer-media/t1/a.jpg' }],
    );
  });

  it('returns the conversation with message times, for the chat to show when it started', async () => {
    const query = jest.fn(async () => [
      { role: 'user', text: 'Є сорочка?', attachments: null, raw_payload: null, created_at: new Date('2026-11-08T12:32:00Z') },
      { role: 'assistant', text: 'Так.', attachments: null, raw_payload: { imageUrls: ['/a.jpg'] }, created_at: new Date('2026-11-08T12:32:07Z') },
    ]);
    const svc = new TestChatService({ query } as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await svc.history('t1')).toEqual([
      { role: 'customer', text: 'Є сорочка?', createdAt: '2026-11-08T12:32:00.000Z' },
      { role: 'bot', text: 'Так.', imageUrls: ['/a.jpg'], createdAt: '2026-11-08T12:32:07.000Z' },
    ]);
  });

  it('stops a store sending more than 60 test messages an hour', async () => {
    const t = chat();
    for (let i = 0; i < 60; i++) await t.svc.send('t1', { text: `${i}` });
    await expect(t.svc.send('t1', { text: 'ще' })).rejects.toThrow(/Too many/);
  });
});
