import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConversationTrace,
  ConversationTraceError,
  ConversationTraceStageTimings,
  OpenAiCallRecord,
} from './entities/conversation-trace.entity';

export interface PersistTraceInput {
  traceId: string;
  tenantId: string;
  conversationId: string | null;
  customerId: string | null;
  startedAt: Date;
  durationMs: number;
  inboundMessageText: string | null;
  inboundMediaRef: Record<string, unknown> | null;
  decision: 'reply' | 'handoff' | 'create_draft_order' | 'error';
  templateScenario: string | null;
  handoffReason: string | null;
  traceSteps: string[];
  stageTimings: ConversationTraceStageTimings;
  classifierOutput: Record<string, unknown> | null;
  openaiCalls: OpenAiCallRecord[];
  /** AssistantMemory shape at turn start (engine inputs). */
  memoryBefore: Record<string, unknown> | null;
  /** AssistantMemory shape at turn end (engine outputs). */
  memoryAfter: Record<string, unknown> | null;
  /** Last-N classifier context window. */
  recentMessages: Array<{ role: string; text: string | null }>;
  /** Rendered outbound reply (primary + joined extraReplies). */
  outboundReply: string | null;
  error: ConversationTraceError | null;
}

@Injectable()
export class ConversationTracesService {
  private readonly logger = new Logger(ConversationTracesService.name);

  constructor(
    @InjectRepository(ConversationTrace)
    private readonly repo: Repository<ConversationTrace>,
  ) {}

  /**
   * Best-effort write. Never throws to the caller — engine must not be
   * blocked by trace-persistence failures. Errors are logged via the
   * NestJS logger so they still appear in container logs.
   */
  async persist(input: PersistTraceInput): Promise<void> {
    try {
      const requestIds = input.openaiCalls
        .map((c) => c.requestId)
        .filter((id): id is string => !!id);

      const timings: ConversationTraceStageTimings = {
        ...input.stageTimings,
        openai_call_count: input.openaiCalls.length,
        openai_total_tokens: input.openaiCalls.reduce(
          (sum, c) => sum + c.promptTokens + c.completionTokens,
          0,
        ),
      };

      await this.repo.insert({
        traceId: input.traceId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        customerId: input.customerId,
        inboundMessageText: input.inboundMessageText,
        // TypeORM jsonb columns expect a deep-partial; the wide
        // `Record<string, unknown>` we expose to callers narrows fine at
        // runtime, so cast is safe here.
        inboundMediaRef: input.inboundMediaRef as any,
        startedAt: input.startedAt,
        completedAt: new Date(),
        durationMs: input.durationMs,
        decision: input.decision,
        templateScenario: input.templateScenario,
        handoffReason: input.handoffReason,
        traceSteps: input.traceSteps,
        stageTimings: timings,
        classifierOutput: input.classifierOutput as any,
        openaiRequestIds: requestIds.length ? requestIds : null,
        openaiCalls: input.openaiCalls.length ? input.openaiCalls : null,
        memoryBefore: input.memoryBefore as any,
        memoryAfter: input.memoryAfter as any,
        recentMessages: input.recentMessages.length
          ? (input.recentMessages as any)
          : null,
        outboundReply: input.outboundReply,
        error: input.error,
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist conversation trace (traceId=${input.traceId}, conversationId=${input.conversationId})`,
        (err as Error).stack,
      );
    }
  }

  /** Trace rows for one conversation, newest first. Used by the admin UI. */
  async listForConversation(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationTrace[]> {
    return this.repo.find({
      where: { tenantId, conversationId },
      order: { startedAt: 'DESC' },
    });
  }

  /** Recent error traces for an admin, optionally scoped to a tenant. */
  async listErrors(opts: {
    tenantId?: string;
    sinceMs?: number;
    limit?: number;
  }): Promise<ConversationTrace[]> {
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.decision = :decision', { decision: 'error' });
    if (opts.tenantId) {
      qb.andWhere('t.tenant_id = :tenantId', { tenantId: opts.tenantId });
    }
    if (opts.sinceMs && opts.sinceMs > 0) {
      qb.andWhere('t.started_at >= :since', {
        since: new Date(Date.now() - opts.sinceMs),
      });
    }
    return qb.orderBy('t.started_at', 'DESC').limit(opts.limit ?? 100).getMany();
  }
}
