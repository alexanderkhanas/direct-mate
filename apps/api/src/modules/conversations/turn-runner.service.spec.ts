import { ConversationStatus } from '@direct-mate/shared';
import { DEFAULT_HANDOFF_ANNOUNCE, TurnMode, TurnRunner } from './turn-runner.service';
import type { AgentTurnResult } from '../agent/agent.types';

// The runner with every dependency faked: what's under test is the pipeline
// around the agent — lease, gates, commit-by-mode, message composition.

const SETTINGS = {
  welcomeLine: 'Вітаю, з вами AI-асистент',
  handoffAnnounce: 'Передаю менеджеру.',
  operatingMode: 'active',
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
  leaseFree?: boolean;
  botReplied?: boolean;
  status?: ConversationStatus;
  settings?: Partial<typeof SETTINGS>;
  agent?: AgentTurnResult | Error;
  placeOrder?: { ok: true; orderId: string; alreadyPlaced: boolean } | { ok: false; error: string };
  paymentClaim?: boolean;
  messagesLastHour?: number;
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

  const runner = new TurnRunner(
    dataSource as never,
    conversations as never,
    traces as never,
    { build: async () => [{ role: 'customer', text: 'Скільки коштує сорочка?' }] } as never,
    { resolve: async () => ({ notes: [], messageText: '', productId: null }) } as never,
    agent as never,
    { load: async () => ({ ...SETTINGS, ...opts.settings }) } as never,
    { isActive: async () => true } as never,
    drafts as never,
    { triggerExternalSync: jest.fn() } as never,
    telegram as never,
    { get: () => undefined } as never,
  );
  const run = (mode: TurnMode = 'demo') =>
    runner.run({ tenantId: 't1', conversationId: 'c1', mode, source: 'simulator_cli' });
  return { run, queries, saved, conversations, agent, drafts, telegram, traces };
}

describe('TurnRunner', () => {
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
