import { ConversationStatus, MessageRole } from '@direct-mate/shared';
import { InstagramService } from './instagram.service';
import type { IgAccount } from './instagram-sender.service';
import type { TurnRunResult } from '../../conversations/turn-runner.service';

// Webhook fixtures through the Instagram service, with every dependency faked:
// what's under test is intake, the reply timer, delivery and echo handling.

const SHOP = 'ig-shop';
const CUSTOMER = 'ig-customer';

function runResult(over: Partial<TurnRunResult> = {}): TurnRunResult {
  return {
    status: 'replied',
    messages: [
      { kind: 'welcome', text: 'Вітаю, з вами AI-асистент', messageId: 'm-welcome' },
      { kind: 'reply', text: 'Так, є в L — 3300 грн.', imageUrls: ['/uploads/a.jpg'], messageId: 'm-reply' },
    ],
    handoff: null,
    committed: { orderId: null, paymentDetailsSent: false },
    agent: null,
    traceId: 'trace',
    ...over,
  };
}

function setup(opts: {
  operatingMode?: string;
  run?: TurnRunResult;
  ownMids?: string[];
  ownAfterRecheck?: string[];
  recentBotTexts?: string[];
  sendFails?: boolean;
  appId?: string;
} = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const savedMids = new Set<string>();
  const ownMids = new Set(opts.ownMids ?? []);

  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT external_user_id FROM customers')) return [{ external_user_id: CUSTOMER }];
      if (sql.includes('SELECT full_name, username FROM customers')) return [{ full_name: 'Іван', username: 'ivan' }];
      if (sql.includes('SELECT text FROM messages')) return (opts.recentBotTexts ?? []).map((text) => ({ text }));
      return [];
    }),
  };
  const conversations = {
    findOrCreateCustomer: jest.fn(async () => ({ id: 'cust1', username: 'ivan' })),
    findOrCreateConversation: jest.fn(async () => ({ conversation: { id: 'conv1' } })),
    saveChannelMessage: jest.fn(
      async (_c: string, _t: string, _role: MessageRole, _text: string, mid: string, _attachments: unknown) => {
        if (savedMids.has(mid)) return null;
        savedMids.add(mid);
        return `row-${mid}`;
      },
    ),
    updateCustomer: jest.fn(),
    findCustomer: jest.fn(async () => ({ id: 'cust1' })),
    findConversationByCustomer: jest.fn(async () => ({ id: 'conv1', status: ConversationStatus.Active })),
    takeover: jest.fn(),
    escalate: jest.fn(),
    release: jest.fn(),
  };
  const sender = {
    sendText: jest.fn(async (_account: IgAccount, _to: unknown, text: string) => {
      if (opts.sendFails && !text.startsWith('Вітаю')) throw new Error('Meta 500');
      return [`mid-${text.length}`];
    }),
    sendImage: jest.fn(async (_account: IgAccount, _to: unknown, _url: string) => 'mid-image'),
    isOwnMessage: jest.fn(async (mid: string) => ownMids.has(mid)),
    messageText: jest.fn(async (_t: string, mid: string) => (mid === 'bot-mid' ? 'Сорочка льон — 3300 грн' : null)),
    pruneSentIds: jest.fn(),
  };
  const runner = { run: jest.fn(async () => opts.run ?? runResult()) };
  const telegram = { notifyHandoff: jest.fn(async () => undefined) };
  const learning = { recordCustomerMessage: jest.fn(), recordBotAnalysis: jest.fn(), recordManagerReply: jest.fn() };
  const media = {
    attachmentFor: jest.fn(async (_t: string, ref: { type: string; mediaId: string }) => ({
      ...ref,
      url: '/uploads/customer-media/t1/copy.jpg',
    })),
  };
  const conversationRepo = { find: jest.fn(async () => []), update: jest.fn() };

  const service = new InstagramService(
    { get: (key: string) => ({ 'instagram.debounceMs': 5000, 'meta.appId': opts.appId ?? '777' })[key] } as never,
    conversations as never,
    {
      findByExternalAccountId: async (id: string) =>
        id === SHOP ? { id: 'conn1', tenantId: 't1', accessTokenEncrypted: 'enc', externalAccountId: SHOP } : null,
    } as never,
    { decrypt: () => 'token' } as never,
    telegram as never,
    conversationRepo as never,
    learning as never,
    { handleComment: jest.fn(async () => undefined) } as never,
    dataSource as never,
    runner as never,
    { load: async () => ({ operatingMode: opts.operatingMode ?? 'active' }) } as never,
    media as never,
    sender as never,
  );

  /** Wait for queued intake to finish. */
  const settle = () => Promise.all([...(service as unknown as { intakeQueues: Map<string, Promise<void>> }).intakeQueues.values()]);
  const answer = (row: Partial<{ reply_rerun: boolean }> = {}) =>
    (service as unknown as { answer: (r: unknown) => Promise<void> }).answer({
      id: 'conv1',
      tenant_id: 't1',
      customer_id: 'cust1',
      channel_account_id: SHOP,
      reply_rerun: false,
      ...row,
    });
  const timerArms = () => queries.filter((q) => q.sql.includes('SET reply_due_at = now() + make_interval')).length;
  const promote = (ids: string[]) => ids.forEach((id) => ownMids.add(id));
  for (const id of opts.ownAfterRecheck ?? []) setTimeout(() => promote([id]), 1000);

  return { service, queries, conversations, sender, runner, telegram, learning, media, settle, answer, timerArms };
}

const inbound = (message: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: SHOP, messaging: [{ sender: { id: CUSTOMER }, recipient: { id: SHOP }, timestamp: 1, message }] }],
}) as never;
const echo = (message: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [
    { id: SHOP, messaging: [{ sender: { id: SHOP }, recipient: { id: CUSTOMER }, timestamp: 1, message: { is_echo: true, ...message } }] },
  ],
}) as never;

describe('InstagramService intake', () => {
  it('saves a redelivered message once and arms the reply timer once', async () => {
    const t = setup();
    await t.service.handleWebhook(inbound({ mid: 'm1', text: 'Привіт' }));
    await t.service.handleWebhook(inbound({ mid: 'm1', text: 'Привіт' }));
    await t.settle();

    expect(t.conversations.saveChannelMessage).toHaveBeenCalledTimes(2);
    expect(t.timerArms()).toBe(1);
  });

  it('copies a photo before arming the timer, and pushes the timer out for each message of a burst', async () => {
    const t = setup();
    await t.service.handleWebhook(inbound({ mid: 'p1', attachments: [{ type: 'image', payload: { url: 'https://cdn/p.jpg' } }] }));
    await t.service.handleWebhook(inbound({ mid: 'm2', text: 'Є таке в L?' }));
    await t.settle();

    const [photoCall, textCall] = t.conversations.saveChannelMessage.mock.calls;
    expect(photoCall[3]).toBe('');
    expect(photoCall[5]).toEqual([{ type: 'customer_photo', mediaId: 'https://cdn/p.jpg' }]);
    expect(textCall[3]).toBe('Є таке в L?');
    expect(t.media.attachmentFor).toHaveBeenCalledWith('t1', { type: 'customer_photo', mediaId: 'https://cdn/p.jpg' });
    const order = t.queries.map((q) => q.sql);
    const copied = order.findIndex((sql) => sql.includes('UPDATE messages SET attachments'));
    expect(copied).toBeGreaterThan(-1);
    expect(copied).toBeLessThan(order.findIndex((sql) => sql.includes('SET reply_due_at = now() + make_interval')));
    expect(t.timerArms()).toBe(2);
  });

  it('records every kind of attachment, resolves a quote-reply, and ignores a bare heart', async () => {
    const t = setup();
    await t.service.handleWebhook(inbound({ mid: 'q1', text: 'а ця?', reply_to: { mid: 'bot-mid' } }));
    await t.service.handleWebhook(inbound({ mid: 's1', text: 'є в M?', reply_to: { story: { id: 'story-9' } } }));
    await t.service.handleWebhook(
      inbound({ mid: 'v1', attachments: [{ type: 'video', payload: { url: 'https://cdn/v.mp4' } }, { type: 'ig_reel', payload: { reel_video_id: 'r1' } }] }),
    );
    await t.service.handleWebhook(inbound({ mid: 'h1', attachments: [{ type: 'like_heart' }] }));
    await t.settle();

    const attachments = t.conversations.saveChannelMessage.mock.calls.map((c) => c[5]);
    expect(attachments).toEqual([
      [{ type: 'quoted_message', mediaId: 'bot-mid', quotedText: 'Сорочка льон — 3300 грн' }],
      [{ type: 'story_reply', mediaId: 'story-9' }],
      [
        { type: 'customer_video', mediaId: 'https://cdn/v.mp4' },
        { type: 'post_share', mediaId: 'r1' },
      ],
    ]);
  });

  it('skips a message to an Instagram account no store has connected', async () => {
    const t = setup();
    await t.service.handleWebhook({
      object: 'instagram',
      entry: [{ id: 'other', messaging: [{ sender: { id: CUSTOMER }, recipient: { id: 'other' }, timestamp: 1, message: { mid: 'x', text: 'hi' } }] }],
    } as never);
    await t.settle();
    expect(t.conversations.saveChannelMessage).not.toHaveBeenCalled();
  });
});

describe('InstagramService answering', () => {
  it('runs the turn live and sends the messages in order, photos before the text they go with', async () => {
    const t = setup();
    await t.answer();

    expect(t.runner.run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', source: 'instagram', supersede: true }));
    const sends = [
      ...t.sender.sendText.mock.invocationCallOrder.map((n, i) => ({ n, what: t.sender.sendText.mock.calls[i][2] })),
      ...t.sender.sendImage.mock.invocationCallOrder.map((n, i) => ({ n, what: t.sender.sendImage.mock.calls[i][2] })),
    ].sort((a, b) => a.n - b.n);
    expect(sends.map((s) => s.what)).toEqual(['Вітаю, з вами AI-асистент', '/uploads/a.jpg', 'Так, є в L — 3300 грн.']);
    const delivered = t.queries.filter((q) => q.sql.includes("delivery_status = 'sent'")).map((q) => q.params[0]);
    expect(delivered).toEqual(['m-welcome', 'm-reply']);
  });

  it('re-runs a superseded turn once, and the re-run sends whatever it writes', async () => {
    const t = setup({ run: runResult({ status: 'superseded', messages: [] }) });
    await t.answer();
    expect(t.queries.some((q) => q.sql.includes('SET reply_rerun = true'))).toBe(true);

    const rerun = setup();
    await rerun.answer({ reply_rerun: true });
    expect(rerun.runner.run).toHaveBeenCalledWith(expect.objectContaining({ supersede: false }));
    expect(rerun.queries.some((q) => q.sql.includes('SET reply_rerun = false'))).toBe(true);
  });

  it('tries again shortly when another run holds the conversation', async () => {
    const t = setup({ run: runResult({ status: 'busy', messages: [] }) });
    await t.answer();
    expect(t.queries.some((q) => q.sql.includes('SET reply_due_at = COALESCE(reply_due_at'))).toBe(true);
    expect(t.sender.sendText).not.toHaveBeenCalled();
  });

  it('marks undelivered messages failed and hands the conversation to a manager', async () => {
    const t = setup({ sendFails: true });
    await t.answer();

    const failed = t.queries.find((q) => q.sql.includes("delivery_status = 'failed'"));
    expect(failed?.params[0]).toEqual(['m-reply']);
    expect(t.conversations.escalate).toHaveBeenCalledWith('conv1', 'send_failed');
    expect(t.telegram.notifyHandoff).toHaveBeenCalledWith(expect.objectContaining({ reason: 'send_failed' }));
  });

  it('runs a learning-mode store as a dry run and sends nothing', async () => {
    const t = setup({ operatingMode: 'learning' });
    await t.answer();
    expect(t.runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dry_run', source: 'instagram_dry_run', supersede: false }),
    );
    expect(t.learning.recordBotAnalysis).toHaveBeenCalledWith('conv1', expect.objectContaining({ botReply: 'Так, є в L — 3300 грн.' }));
    expect(t.sender.sendText).not.toHaveBeenCalled();
  });
});

describe('InstagramService echoes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const handle = async (t: ReturnType<typeof setup>, payload: unknown) => {
    await t.service.handleWebhook(payload as never);
    await jest.advanceTimersByTimeAsync(5000);
  };

  it('ignores the echo of a message we sent, by id or by our app id', async () => {
    const t = setup({ ownMids: ['ours'] });
    await handle(t, echo({ mid: 'ours', text: 'Так, є в L.' }));
    await handle(t, echo({ mid: 'unknown', text: 'Щось', app_id: 777 }));
    expect(t.conversations.takeover).not.toHaveBeenCalled();
    expect(t.conversations.saveChannelMessage).not.toHaveBeenCalled();
  });

  it('recognises our echo that arrives before the send response, by text or on the recheck', async () => {
    const byText = setup({ recentBotTexts: ['Так, є в L — 3300 грн.'] });
    await handle(byText, echo({ mid: 'early', text: 'Так, є в L — 3300 грн.' }));
    expect(byText.conversations.takeover).not.toHaveBeenCalled();

    const byRecheck = setup({ ownAfterRecheck: ['image-echo'] });
    await handle(byRecheck, echo({ mid: 'image-echo', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] }));
    expect(byRecheck.conversations.takeover).not.toHaveBeenCalled();
  });

  it("treats any other echo as a manager writing, and pauses the bot", async () => {
    const t = setup();
    await handle(t, echo({ mid: 'manager-1', text: 'Добрий день, це Оля, менеджер' }));

    expect(t.conversations.saveChannelMessage).toHaveBeenCalledWith(
      'conv1',
      't1',
      MessageRole.Manager,
      'Добрий день, це Оля, менеджер',
      'manager-1',
      null,
    );
    expect(t.conversations.takeover).toHaveBeenCalledWith('conv1', null, 'auto_detected');
  });
});
