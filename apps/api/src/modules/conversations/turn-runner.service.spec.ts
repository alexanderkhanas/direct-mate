import { ConversationStatus } from '@direct-mate/shared';
import { DEFAULT_HANDOFF_ANNOUNCE, TurnMode, TurnRunner } from './turn-runner.service';
import type { AgentTurnResult } from '../agent/agent.types';

// The runner with every dependency faked: what's under test is the pipeline
// around the agent — lease, gates, commit-by-mode, message composition.

const SETTINGS = {
  welcomeLine: 'Вітаю, з вами AI-асистент',
  handoffAnnounce: 'Передаю менеджеру.',
  operatingMode: 'active',
  directRead: true,
  directReply: true,
};

function agentResult(over: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    reply: 'Сорочка льон — 3300 грн.',
    effects: [],
    handoff: null,
    attempts: [{ text: 'Сорочка льон — 3300 грн.', grounding: [], style: [] }],
    steps: [],
    model: 'mock',
    usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    durationMs: 1,
    ...over,
  };
}

function setup(opts: {
  subscriptionActive?: boolean;
  trialHasRoom?: boolean;
  leaseFree?: boolean;
  botReplied?: boolean;
  status?: ConversationStatus;
  settings?: Partial<typeof SETTINGS>;
  agent?: AgentTurnResult | Error;
  placeOrder?: { ok: true; orderId: string; alreadyPlaced: boolean } | { ok: false; error: string };
  paymentClaim?: boolean;
  messagesLastHour?: number;
  newAttachments?: unknown[];
  history?: unknown[];
  focusMediaId?: string | null;
  focus?: unknown;
} = {}) {
  const queries: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('count(*)::int AS n')) return [{ n: opts.messagesLastHour ?? 0 }];
      if (sql.includes('SET processing_until = now()')) return opts.leaseFree === false ? [[], 0] : [[{ id: 'c1' }], 1];
      if (sql.includes('FROM conversations')) {
        return [{ id: 'c1', tenant_id: 't1', customer_id: 'u1', status: opts.status ?? ConversationStatus.Active }];
      }
      if (sql.includes('FROM messages') && sql.includes('role')) return opts.botReplied ? [{}] : [];
      if (sql.includes('FROM customers')) return [{ full_name: 'Іван', username: null }];
      return [];
    }),
    getRepository: jest.fn(),
  };
  const saved: Array<{ text: string; payload: unknown }> = [];
  const conversations = {
    saveMessage: jest.fn(async (_c, _t, _d, _r, text: string, _e, payload: unknown) => saved.push({ text, payload })),
    escalate: jest.fn(async () => undefined),
  };
  const agent = {
    runTurn: jest.fn(async (_input: { notes?: string[] }) => {
      if (opts.agent instanceof Error) throw opts.agent;
      return opts.agent ?? agentResult();
    }),
  };
  const drafts = {
    placeOrder: jest.fn(async () => opts.placeOrder ?? { ok: true, orderId: 'o1', alreadyPlaced: false }),
    claimPaymentDetailsSend: jest.fn(async () => opts.paymentClaim ?? true),
  };
  const telegram = {
    notifyHandoff: jest.fn(async (_params: Record<string, unknown>) => undefined),
    notifyNewOrder: jest.fn(async () => undefined),
  };
  const traces = { persistAgentTurn: jest.fn(async () => undefined) };
  const subscriptions = {
    isActive: jest.fn(async () => opts.subscriptionActive ?? true),
    hasRoomForConversation: jest.fn(async () => opts.trialHasRoom ?? true),
    recordConversation: jest.fn(async () => undefined),
  };

  const order: string[] = [];
  const contentMedia = { prepare: jest.fn(async (_t: string, _c: string) => void order.push('prepare')) };
  const voice = { prepare: jest.fn(async (_t: string, _c: string) => void order.push('voice')) };
  const history = {
    buildTurn: jest.fn(async () => {
      order.push('history');
      return {
        history: opts.history ?? [{ role: 'customer', text: 'Скільки коштує сорочка?' }],
        newAttachments: opts.newAttachments ?? [],
        focusMediaId: opts.focusMediaId ?? null,
        focus: opts.focus ?? null,
      };
    }),
  };
  const media = { resolve: jest.fn(async (..._args: unknown[]) => ({ notes: [], messageText: '', productId: null })) };
  const contentLinks = { addPick: jest.fn(async () => true) };
  const contentQuestions = { afterOrder: jest.fn(async () => undefined) };

  const runner = new TurnRunner(
    dataSource as never,
    conversations as never,
    traces as never,
    history as never,
    media as never,
    agent as never,
    { load: async () => ({ ...SETTINGS, ...opts.settings }) } as never,
    subscriptions as never,
    drafts as never,
    { triggerExternalSync: jest.fn() } as never,
    telegram as never,
    { get: () => undefined } as never,
    contentMedia as never,
    contentLinks as never,
    contentQuestions as never,
    voice as never,
  );
  const run = (mode: TurnMode = 'demo', extra: Partial<Parameters<TurnRunner['run']>[0]> = {}) =>
    runner.run({ tenantId: 't1', conversationId: 'c1', mode, source: 'simulator_cli', ...extra });
  return { run, queries, saved, conversations, agent, drafts, telegram, traces, subscriptions, contentMedia, voice, media, order, contentLinks, contentQuestions };
}

describe('TurnRunner: evidence for content links', () => {
  const pick = { type: 'content_pick' as const, productId: 'p1', color: 'Чорний' };
  const placing = { type: 'place_order' as const, checkoutSessionId: 's1' };

  it('records a pick live, for the content the customer pointed at last', async () => {
    const t = setup({ focusMediaId: 'story-1', agent: agentResult({ effects: [pick] }) });
    await t.run('live');
    expect(t.contentLinks.addPick).toHaveBeenCalledWith('t1', { mediaId: 'story-1' }, { productId: 'p1', color: 'Чорний', conversationId: 'c1' });
  });

  it('records nothing in demo or a dry run, nor without a piece of content', async () => {
    for (const mode of ['demo', 'dry_run'] as const) {
      const t = setup({ focusMediaId: 'story-1', agent: agentResult({ effects: [pick] }) });
      await t.run(mode);
      expect(t.contentLinks.addPick).not.toHaveBeenCalled();
    }
    const none = setup({ focusMediaId: null, agent: agentResult({ effects: [pick] }) });
    await none.run('live');
    expect(none.contentLinks.addPick).not.toHaveBeenCalled();
  });

  it("hands a new live order to the owner questions, and never one that was placed before", async () => {
    const t = setup({ agent: agentResult({ effects: [placing] }) });
    await t.run('live');
    expect(t.contentQuestions.afterOrder).toHaveBeenCalledWith('t1', 'c1', { orderId: 'o1', checkoutSessionId: 's1' });

    const again = setup({ agent: agentResult({ effects: [placing] }), placeOrder: { ok: true, orderId: 'o1', alreadyPlaced: true } });
    await again.run('live');
    expect(again.contentQuestions.afterOrder).not.toHaveBeenCalled();

    const demo = setup({ agent: agentResult({ effects: [placing] }) });
    await demo.run('demo');
    expect(demo.contentQuestions.afterOrder).not.toHaveBeenCalled();
  });
});

describe('TurnRunner', () => {
  it("waits for the images of the stories and posts and the voice transcripts in the new messages before reading the history", async () => {
    const t = setup();
    await t.run();
    expect(t.contentMedia.prepare).toHaveBeenCalledWith('t1', 'c1');
    expect(t.voice.prepare).toHaveBeenCalledWith('t1', 'c1');
    expect(t.order).toEqual(['prepare', 'voice', 'history']);
  });

  it('gives the resolver the copy, caption and flags of a story or post, and only the id of a photo', async () => {
    const story = { type: 'story_reply', mediaId: 's1', sourceUrl: 'https://cdn/s.mp4', url: '/uploads/content-media/t1/s-frames.jpg', image: 'video_frames', caption: 'Сукня' };
    const share = { type: 'post_share', mediaId: 'p9', url: '/uploads/content-media/t1/p.jpg', image: 'picture', foreign: true, reel: true };
    const photo = { type: 'customer_photo', mediaId: 'https://cdn/x.jpg', url: '/uploads/customer-media/t1/x.jpg' };
    const t = setup({ newAttachments: [story, share, photo] });
    await t.run();
    expect(t.media.resolve.mock.calls[0][2]).toEqual([
      { type: 'story_reply', mediaId: 's1', url: story.url, image: 'video_frames', caption: 'Сукня' },
      { type: 'post_share', mediaId: 'p9', url: share.url, image: 'picture', foreign: true, reel: true },
      { type: 'customer_photo', mediaId: 'https://cdn/x.jpg' },
    ]);
    // Read with the history, from the same rows: a copy that lands in between can't make a note point at a missing image.
    expect(t.queries.some((sql) => sql.includes('SELECT attachments FROM messages'))).toBe(false);
  });

  it('gives the manager and the trace the whole last message, so a share with no words still says what it was', async () => {
    const share = '(shared a post, shown in the image)';
    const t = setup({
      history: [{ role: 'customer', text: share, said: '' }],
      agent: agentResult({ reply: null, handoff: { reason: 'lost_context', summaryForManager: null } }),
    });
    await t.run('live');
    expect(t.telegram.notifyHandoff.mock.calls[0][0]).toMatchObject({ lastMessage: share });
    expect(t.media.resolve.mock.calls[0][3]).toBe(share);
    expect(t.traces.persistAgentTurn.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ inboundMessageText: share })]));
  });

  it('keeps the story from earlier in the conversation in view when the new messages point at nothing', async () => {
    const story = { type: 'story_reply', mediaId: 's1', url: '/uploads/content-media/t1/s.jpg', image: 'picture' };
    const t = setup({ focus: story });
    await t.run();
    expect(t.media.resolve.mock.calls[0][2]).toEqual([{ ...story, earlier: true }]);

    // A new photo or story is what the customer means now: the earlier one isn't added.
    const photo = { type: 'customer_photo', mediaId: 'https://cdn/x.jpg' };
    const fresh = setup({ focus: story, newAttachments: [photo] });
    await fresh.run();
    expect(fresh.media.resolve.mock.calls[0][2]).toEqual([photo]);
  });

  it("takes a reference the caller passed from its saved message, which carries the copy", async () => {
    const story = { type: 'story_reply', mediaId: 's1', url: '/uploads/content-media/t1/s.jpg', image: 'picture' };
    const t = setup({ newAttachments: [story] });
    await t.run('demo', { mediaReference: { type: 'story_reply', mediaId: 's1' } });
    expect(t.media.resolve.mock.calls[0][2]).toEqual([story]);

    const other = setup({ newAttachments: [story] });
    await other.run('demo', { mediaReference: { type: 'post_reply', mediaId: 'p1' } });
    expect(other.media.resolve.mock.calls[0][2]).toEqual([{ type: 'post_reply', mediaId: 'p1' }]);
  });

  it('leaves a conversation alone while another run holds its lease', async () => {
    const t = setup({ leaseFree: false });
    expect((await t.run()).status).toBe('busy');
    expect(t.agent.runTurn).not.toHaveBeenCalled();
  });

  it('skips a paused store and a conversation a manager has taken over, except in dry run', async () => {
    expect((await setup({ settings: { operatingMode: 'paused' } }).run()).skipReason).toBe('paused');
    expect((await setup({ status: ConversationStatus.HumanInControl }).run()).skipReason).toBe('human_in_control');
    expect((await setup({ status: ConversationStatus.HumanInControl }).run('dry_run')).status).toBe('replied');
  });

  it("sends nothing live without the owner's reply permission, and drafts nothing in learning mode without the read one", async () => {
    const noReply = setup({ settings: { directReply: false } });
    expect(await noReply.run('live')).toMatchObject({ status: 'skipped', skipReason: 'no_permission', messages: [] });
    expect(noReply.agent.runTurn).not.toHaveBeenCalled();
    expect((await setup({ settings: { directRead: false } }).run('dry_run')).skipReason).toBe('no_permission');
    // Each gate needs only its own permission.
    expect((await setup({ settings: { directRead: false } }).run('live')).status).toBe('replied');
    expect((await setup({ settings: { directReply: false } }).run('dry_run')).status).toBe('replied');
    // The owner's test chat and the simulator run in demo mode: neither permission is needed.
    expect((await setup({ settings: { directRead: false, directReply: false } }).run('demo')).status).toBe('replied');
  });

  it('goes quiet when the plan is unpaid: no reply, no handoff line, nothing the customer sees', async () => {
    const t = setup({ subscriptionActive: false });
    const result = await t.run('live');
    expect(result).toMatchObject({ status: 'skipped', skipReason: 'subscription_inactive', messages: [], handoff: null });
    expect(t.agent.runTurn).not.toHaveBeenCalled();
    expect(t.saved).toEqual([]);
  });

  it("doesn't take on a new conversation once the trial's conversations are used up", async () => {
    const t = setup({ trialHasRoom: false });
    expect((await t.run('live')).skipReason).toBe('subscription_inactive');
    expect(t.agent.runTurn).not.toHaveBeenCalled();
  });

  it('counts a conversation the bot took on live, and not demo or test ones', async () => {
    const live = setup();
    await live.run('live');
    await new Promise((r) => setImmediate(r));
    expect(live.subscriptions.recordConversation).toHaveBeenCalledWith('t1');

    const demo = setup();
    await demo.run('demo');
    expect(demo.subscriptions.recordConversation).not.toHaveBeenCalled();
  });

  it('saves the products the reply was about with the reply, for later turns', async () => {
    const t = setup({
      agent: agentResult({
        steps: [
          {
            attempt: 1,
            text: '',
            finishReason: 'tool-calls',
            toolCalls: [{ toolName: 'get_product', input: { productRef: '5d041fb6' } }],
            toolResults: [{ toolName: 'get_product', output: { ref: '5d041fb6', title: 'Сорочка льон' } }],
          },
        ],
      }),
    });
    await t.run();
    const reply = t.saved.find((m) => (m.payload as { kind: string }).kind === 'reply');
    expect(reply?.payload).toMatchObject({ products: [{ ref: '5d041fb6', title: 'Сорочка льон' }] });
    expect(t.saved.find((m) => (m.payload as { kind: string }).kind === 'welcome')?.payload).not.toHaveProperty('products');
  });

  it("opens the conversation's first reply with the welcome line, and tells the agent not to greet", async () => {
    const t = setup();
    const result = await t.run();
    expect(result.messages.map((m) => m.kind)).toEqual(['welcome', 'reply']);
    expect((t.agent.runTurn.mock.calls[0][0].notes ?? []).join(' ')).toContain('do not greet');
    expect((await setup({ botReplied: true }).run()).messages.map((m) => m.kind)).toEqual(['reply']);
  });

  it('ends a handoff with the store announce line, and escalates only in live mode', async () => {
    const handoff = agentResult({ reply: null, handoff: { reason: 'complaint_or_return', summaryForManager: 'Повернення' } });
    const demo = setup({ botReplied: true, agent: handoff });
    const result = await demo.run('demo');
    expect(result.messages).toEqual([{ kind: 'handoff_announce', text: 'Передаю менеджеру.' }]);
    expect(demo.conversations.escalate).not.toHaveBeenCalled();

    const live = setup({ botReplied: true, agent: handoff, settings: { handoffAnnounce: undefined } });
    expect((await live.run('live')).messages[0].text).toBe(DEFAULT_HANDOFF_ANNOUNCE);
    expect(live.conversations.escalate).toHaveBeenCalledWith('c1', 'complaint_or_return');
    expect(live.telegram.notifyHandoff.mock.calls[0][0]).toMatchObject({ summary: 'Повернення' });
  });

  it('places a staged order and sends payment details once claimed', async () => {
    const t = setup({
      botReplied: true,
      agent: agentResult({
        effects: [
          { type: 'place_order', checkoutSessionId: 's1' },
          { type: 'send_payment_details', checkoutSessionId: 's1', text: 'IBAN UA00' },
        ],
      }),
    });
    const result = await t.run();
    expect(result.committed).toEqual({ orderId: 'o1', paymentDetailsSent: true });
    expect(result.messages.map((m) => m.kind)).toEqual(['reply', 'payment_details']);
    expect(t.drafts.placeOrder).toHaveBeenCalledWith('t1', 's1', 'simulator');
  });

  it('does not repeat payment details that were already claimed', async () => {
    const t = setup({
      botReplied: true,
      paymentClaim: false,
      agent: agentResult({ effects: [{ type: 'send_payment_details', checkoutSessionId: 's1', text: 'IBAN UA00' }] }),
    });
    expect((await t.run()).messages.map((m) => m.kind)).toEqual(['reply']);
  });

  it('drops the reply and hands off when the order cannot be placed', async () => {
    const t = setup({
      botReplied: true,
      placeOrder: { ok: false, error: 'No longer in stock: Сорочка льон.' },
      agent: agentResult({ reply: 'Замовлення оформлено!', effects: [{ type: 'place_order', checkoutSessionId: 's1' }] }),
    });
    const result = await t.run();
    expect(result.handoff?.reason).toBe('order_failed');
    expect(result.messages.map((m) => m.kind)).toEqual(['handoff_announce']);
  });

  it('commits and saves nothing in dry run, but returns what would have been sent', async () => {
    const t = setup({
      agent: agentResult({
        effects: [
          { type: 'place_order', checkoutSessionId: 's1' },
          { type: 'send_payment_details', checkoutSessionId: 's1', text: 'IBAN UA00' },
        ],
      }),
    });
    const result = await t.run('dry_run');
    expect(result.messages.map((m) => m.kind)).toEqual(['welcome', 'reply', 'payment_details']);
    expect(t.drafts.placeOrder).not.toHaveBeenCalled();
    expect(t.drafts.claimPaymentDetailsSend).not.toHaveBeenCalled();
    expect(t.saved).toEqual([]);
  });

  it('turns an agent crash into an announced handoff and always releases the lease', async () => {
    const t = setup({ botReplied: true, agent: new Error('boom') });
    const result = await t.run();
    expect(result.handoff?.reason).toBe('runner_error');
    expect(result.messages.map((m) => m.kind)).toEqual(['handoff_announce']);
    expect(t.queries.at(-1)).toContain('SET processing_until = NULL');
  });

  it('hands a customer sending more than 60 messages an hour to a manager without running the agent (live only)', async () => {
    const live = setup({ botReplied: true, messagesLastHour: 61 });
    const result = await live.run('live');
    expect(result.handoff?.reason).toBe('rate_limited');
    expect(live.agent.runTurn).not.toHaveBeenCalled();
    expect(live.conversations.escalate).toHaveBeenCalledWith('c1', 'rate_limited');

    const demo = setup({ botReplied: true, messagesLastHour: 61 });
    expect((await demo.run('demo')).handoff).toBeNull();
    expect(demo.agent.runTurn).toHaveBeenCalled();
  });
});
