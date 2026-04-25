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
import { ReplyEngineService } from '../conversations/reply-engine.service';
import { DemoBudgetService } from './demo-budget.service';

export type DemoDecision = ReplyDecision | 'budget_exceeded';

export interface DemoReplyPayload {
  reply: { text: string; imageUrls?: string[] } | null;
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

const FALLBACK_CHARGE_PROBABILITY = 0.2;

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

  private readonly classifierModel: string;
  private readonly fallbackModel: string;
  private readonly classifierCapCents: number;
  private readonly fallbackCapCents: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationsService: ConversationsService,
    private readonly replyEngineService: ReplyEngineService,
    private readonly budgetService: DemoBudgetService,
  ) {
    this.debounceMs =
      this.configService.get<number>('demo.debounceMs') ?? 1500;
    this.classifierModel =
      this.configService.get<string>('openai.model') ?? 'gpt-5.4-mini';
    this.fallbackModel =
      this.configService.get<string>('openai.fallbackModel') ?? 'gpt-5.4';
    this.classifierCapCents =
      this.configService.get<number>('demo.budget.classifierCentsPerDay') ??
      1500;
    this.fallbackCapCents =
      this.configService.get<number>('demo.budget.fallbackCentsPerDay') ?? 500;
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

    const combinedText = entry.texts.join('\n');
    const isAggregated = entry.texts.length > 1;

    try {
      // Pre-check budget on BOTH classifier and fallback caps. canSpend
      // returns false for unknown models (fail-closed), so a misconfigured
      // OPENAI_MODEL trips this rather than running unbounded calls.
      const [canClassifier, canFallback] = await Promise.all([
        this.budgetService.canSpend(
          this.classifierModel,
          this.classifierCapCents,
        ),
        this.budgetService.canSpend(
          this.fallbackModel,
          this.fallbackCapCents,
        ),
      ]);
      if (!canClassifier || !canFallback) {
        this.logger.warn(
          `Demo budget exceeded — skipping engine for ${sessionKey} (classifier=${canClassifier}, fallback=${canFallback})`,
        );
        for (const resolve of entry.pendingResolvers) {
          resolve({ ...BUDGET_EXCEEDED_PAYLOAD, isAggregated });
        }
        return;
      }

      const conversation = await this.conversationsService.findById(
        entry.conversationId,
      );
      const recentMessages = conversation.messages
        .slice(-10)
        .map((m) => ({ role: m.role, text: m.text }));

      const state = await this.conversationsService.getState(
        entry.conversationId,
      );
      if (!state) {
        throw new Error(
          `ConversationState missing for ${entry.conversationId}`,
        );
      }

      const result = await this.replyEngineService.process({
        tenantId: entry.tenantId,
        conversationId: entry.conversationId,
        messageText: combinedText,
        state,
        recentMessages,
      });

      // Charge classifier always (it ran). Charge fallback probabilistically
      // because we can't observe whether it ran without instrumenting the
      // engine. p=0.20 overcounts by ~2× in expectation — a deliberate
      // conservative bias.
      const inputTokens = Math.max(1, Math.ceil(combinedText.length / 3));
      const outputTokens = result.reply?.text
        ? Math.max(1, Math.ceil(result.reply.text.length / 3))
        : 200;
      await this.budgetService.chargeEstimate(
        this.classifierModel,
        inputTokens,
        outputTokens,
      );
      if (Math.random() < FALLBACK_CHARGE_PROBABILITY) {
        await this.budgetService.chargeEstimate(
          this.fallbackModel,
          inputTokens,
          outputTokens,
        );
      }

      if (result.stateUpdate) {
        await this.conversationsService.updateState(
          entry.conversationId,
          result.stateUpdate,
        );
      }

      if (result.reply?.text) {
        await this.conversationsService.saveMessage(
          entry.conversationId,
          entry.tenantId,
          MessageDirection.Outbound,
          MessageRole.Assistant,
          result.reply.text,
        );
      }

      // Demo intentionally skips ordersService.createFromConversation()
      // and conversationsService.escalate() / Telegram notify. The reply
      // text alone communicates the outcome to the visitor.

      const payload: DemoReplyPayload = {
        reply: result.reply
          ? { text: result.reply.text, imageUrls: result.reply.imageUrls }
          : null,
        decision: result.decision,
        scenario: result.templateScenario ?? null,
        isAggregated,
        handoff: {
          required: result.handoff.required,
          reason: result.handoff.reason,
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
