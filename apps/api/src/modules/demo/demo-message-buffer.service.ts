/**
 * DemoMessageBufferService
 *
 * In-memory per-session message buffer for the public landing-page demo
 * endpoint. Replicates the production Instagram debounce behaviour
 * (instagram.service.ts) with a shorter window and no DB-backed pending
 * table — the demo runs single-process and tolerates loss of in-flight
 * buffers across restarts (the user simply re-sends).
 *
 * Conversation continuity:
 * The in-memory BufferEntry is forgotten on each flush, but the underlying
 * Conversation/Customer/State rows persist in DB. findOrCreateConversation
 * reuses by (tenantId, customerId, channel='demo', channelAccountId=sessionKey),
 * so a returning sessionKey lands on the same Conversation row across
 * buffer windows. Multi-turn flows work end-to-end.
 *
 * Step 3.2 will add explicit session TTL, server-issued sessionKeys, an
 * in-widget "Start new conversation" button, and rate-limit tracking.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageDirection,
  MessageRole,
  ReplyDecision,
} from '@direct-mate/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { TurnRunner, TurnRunResult } from '../conversations/turn-runner.service';
import { DemoBudgetService } from './demo-budget.service';

export type DemoDecision = ReplyDecision | 'budget_exceeded';

export interface DemoReplyPayload {
  reply: { text: string; imageUrls?: string[] } | null;
  /**
   * Follow-up bubbles rendered sequentially after the primary reply.
   * Frontend cascades them with a small delay so each lands as its own
   * message bubble.
   */
  extraReplies?: Array<{ text: string; imageUrls?: string[] }>;
  decision: DemoDecision;
  scenario: string | null;
  isAggregated: boolean;
  handoff: { required: boolean; reason: string | null };
}

const BUDGET_EXCEEDED_PAYLOAD: DemoReplyPayload = {
  reply: null,
  decision: 'budget_exceeded',
  scenario: null,
  isAggregated: false,
  handoff: { required: false, reason: null },
};

/** Cached input tokens cost about a tenth of uncached ones. */
const CACHED_INPUT_WEIGHT = 0.1;
/** A second flush can find the first still running (it holds the lease); it waits its turn. */
const BUSY_RETRY_MS = 1000;
const BUSY_RETRIES = 60;

interface BufferEntry {
  sessionKey: string;
  tenantId: string;
  customerId: string;
  conversationId: string;
  texts: string[];
  timer: NodeJS.Timeout;
  createdAt: Date;
  lastAppendAt: Date;
  pendingResolvers: Array<(payload: DemoReplyPayload) => void>;
  pendingRejecters: Array<(err: Error) => void>;
}

const JANITOR_INTERVAL_MS = 60_000;
const JANITOR_IDLE_THRESHOLD_MS = 60_000;
const DEMO_CHANNEL = 'demo';

@Injectable()
export class DemoMessageBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoMessageBufferService.name);
  private readonly debounceMs: number;
  private readonly buffers = new Map<string, BufferEntry>();
  private readonly janitor: NodeJS.Timeout;

  private readonly agentModel: string;
  // Daily caps are per model (demo_spend_daily is keyed by model).
  private readonly capCentsByModel: Record<string, number>;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly turnRunner: TurnRunner,
    private readonly budgetService: DemoBudgetService,
  ) {
    this.debounceMs =
      this.configService.get<number>('demo.debounceMs') ?? 1500;
    this.agentModel =
      this.configService.get<string>('agent.model') ?? 'gpt-5.4-mini';
    this.capCentsByModel = {
      'gpt-5.4-mini':
        this.configService.get<number>('demo.budget.classifierCentsPerDay') ?? 1500,
      'gpt-5.4':
        this.configService.get<number>('demo.budget.fallbackCentsPerDay') ?? 500,
    };
    this.janitor = setInterval(
      () => this.sweepIdleEntries(),
      JANITOR_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.janitor);
    for (const entry of this.buffers.values()) {
      clearTimeout(entry.timer);
    }
    this.buffers.clear();
  }

  async appendAndSchedule(
    tenantId: string,
    sessionKey: string,
    text: string,
  ): Promise<DemoReplyPayload> {
    const existing = this.buffers.get(sessionKey);
    let entry: BufferEntry;

    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.lastAppendAt = new Date();
      entry = existing;
    } else {
      const customer = await this.conversationsService.findOrCreateCustomer(
        tenantId,
        DEMO_CHANNEL,
        sessionKey,
      );
      const { conversation } =
        await this.conversationsService.findOrCreateConversation(
          tenantId,
          customer.id,
          DEMO_CHANNEL,
          sessionKey,
        );
      const now = new Date();
      entry = {
        sessionKey,
        tenantId,
        customerId: customer.id,
        conversationId: conversation.id,
        texts: [text],
        timer: undefined as unknown as NodeJS.Timeout,
        createdAt: now,
        lastAppendAt: now,
        pendingResolvers: [],
        pendingRejecters: [],
      };
      this.buffers.set(sessionKey, entry);
    }

    // Persist inbound message immediately, matching production behaviour
    // (instagram.service.ts:451 saves before the debounce window).
    await this.conversationsService.saveMessage(
      entry.conversationId,
      tenantId,
      MessageDirection.Inbound,
      MessageRole.User,
      text,
    );

    entry.timer = setTimeout(
      () => void this.flush(sessionKey),
      this.debounceMs,
    );

    return new Promise<DemoReplyPayload>((resolve, reject) => {
      entry.pendingResolvers.push(resolve);
      entry.pendingRejecters.push(reject);
    });
  }

  private async flush(sessionKey: string): Promise<void> {
    const entry = this.buffers.get(sessionKey);
    if (!entry) return;

    // Capture and remove BEFORE awaiting so a new POST mid-processing
    // creates a fresh entry. The DB Conversation row is reused via
    // findOrCreateConversation, which is the desired behaviour.
    this.buffers.delete(sessionKey);

    const isAggregated = entry.texts.length > 1;

    try {
      // canSpend is fail-closed for models it has no price for, so a
      // misconfigured AGENT_MODEL stops the demo rather than spending blind.
      // A priced model without its own cap gets the agent's daily cap.
      const cap = this.capCentsByModel[this.agentModel] ?? this.capCentsByModel['gpt-5.4-mini'];
      if (!(await this.budgetService.canSpend(this.agentModel, cap))) {
        this.logger.warn(`Demo budget exceeded for ${this.agentModel} — skipping the agent for ${sessionKey}`);
        for (const resolve of entry.pendingResolvers) {
          resolve({ ...BUDGET_EXCEEDED_PAYLOAD, isAggregated });
        }
        return;
      }

      // Demo mode: orders are placed and payment details claimed in the
      // database so the conversation stays truthful, but nothing leaves the
      // system — no Telegram, no n8n — and a handoff doesn't pause the chat,
      // because no manager is coming.
      const result = await this.runWhenFree(entry);

      if (result.agent) {
        const u = result.agent.usage;
        const input = u.inputTokens - u.cachedInputTokens + u.cachedInputTokens * CACHED_INPUT_WEIGHT;
        await this.budgetService.chargeEstimate(result.agent.model, Math.ceil(input), u.outputTokens);
      }

      const [first, ...rest] = result.messages;
      const toolNames = [
        ...new Set((result.agent?.steps ?? []).flatMap((s) => s.toolCalls.map((c) => c.toolName))),
      ];
      const payload: DemoReplyPayload = {
        reply: first ? { text: first.text, imageUrls: first.imageUrls } : null,
        extraReplies: rest.length
          ? rest.map((m) => ({ text: m.text, imageUrls: m.imageUrls }))
          : undefined,
        decision: result.handoff
          ? ReplyDecision.Handoff
          : result.committed.orderId
            ? ReplyDecision.CreateDraftOrder
            : ReplyDecision.Reply,
        scenario: toolNames.length ? toolNames.join(', ') : null,
        isAggregated,
        handoff: {
          required: !!result.handoff,
          reason: result.handoff?.reason ?? null,
        },
      };

      for (const resolve of entry.pendingResolvers) {
        resolve(payload);
      }
    } catch (err) {
      this.logger.error(
        `Demo flush failed for ${sessionKey}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      const error = err instanceof Error ? err : new Error(String(err));
      for (const reject of entry.pendingRejecters) {
        reject(error);
      }
    }
  }

  /**
   * A message sent while the previous one is still being answered starts its
   * own flush; that one finds the conversation leased and waits, then answers
   * everything the visitor has written since.
   */
  private async runWhenFree(entry: BufferEntry): Promise<TurnRunResult> {
    for (let attempt = 0; ; attempt++) {
      const result = await this.turnRunner.run({
        tenantId: entry.tenantId,
        conversationId: entry.conversationId,
        mode: 'demo',
        source: 'demo_widget',
      });
      if (result.status !== 'busy' || attempt >= BUSY_RETRIES) return result;
      await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
    }
  }

  private sweepIdleEntries(): void {
    const cutoff = Date.now() - JANITOR_IDLE_THRESHOLD_MS;
    for (const [key, entry] of this.buffers.entries()) {
      if (entry.lastAppendAt.getTime() < cutoff) {
        this.logger.warn(
          `Janitor force-flushing idle buffer entry: sessionKey=${key} idleMs=${Date.now() - entry.lastAppendAt.getTime()}`,
        );
        clearTimeout(entry.timer);
        void this.flush(key);
      }
    }
  }
}
