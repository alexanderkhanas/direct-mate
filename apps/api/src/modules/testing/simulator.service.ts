import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ReplyEngineService,
  ReplyEngineOutput,
} from '../conversations/reply-engine.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationState } from '../conversations/entities/conversation-state.entity';
import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { SimulatorScenario, SimulatorTurnExpect } from '../../scripts/scenarios';

// ─── Constants (different from CLI simulator to avoid conflicts) ──

const SIM_CUSTOMER_EXTERNAL_ID = 'sim-api-001';
const SIM_CHANNEL = 'instagram';
const SIM_CHANNEL_ACCOUNT_ID = 'sim-api-channel';

// ─── Turn log interface ──────────────────────────────────────────

export interface SimulatorTurnLog {
  turnIndex: number;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  classification: Record<string, unknown> | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  prefixReply?: string | null;
  secondaryReply?: string | null;
  /** Follow-up bot bubbles emitted alongside the primary `replyText`.
   *  Production Instagram sends each as a separate DM (see
   *  `instagram.service.ts:732-749`). The welcome gate promotes the
   *  AI introduction to primary and demotes the contextual reply to
   *  `extraReplies[0]`; the admin simulator must render these as
   *  additional bot bubbles or it looks like the contextual reply
   *  was lost. */
  extraReplies?: Array<{ text: string; imageUrls?: string[] }>;
  imageUrls?: string[];
  state: Record<string, unknown>;
  assertions: Array<{ field: string; pass: boolean; expected: unknown; actual: unknown; message?: string }>;
  trace: string[];
}

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class SimulatorService {
  constructor(
    private readonly replyEngine: ReplyEngineService,
    private readonly conversationsService: ConversationsService,
    private readonly dataSource: DataSource,
  ) {}

  async runScenario(scenario: SimulatorScenario): Promise<SimulatorTurnLog[]> {
    // Resolve slug → UUID if needed (parity with the CLI runner).
    const resolvedTenantId = await this.resolveTenantId(scenario.tenantId);
    scenario = { ...scenario, tenantId: resolvedTenantId };

    const turnLogs: SimulatorTurnLog[] = [];

    // Clean up previous sim data for this tenant
    await this.cleanup(scenario.tenantId);

    // Apply flowConfigOverride if present; restore in finally.
    const restoreFlowConfig = await this.applyFlowConfigOverride(scenario);

    try {
    // Create customer + conversation
    const customer = await this.conversationsService.findOrCreateCustomer(
      scenario.tenantId,
      SIM_CHANNEL,
      SIM_CUSTOMER_EXTERNAL_ID,
    );

    const { conversation } =
      await this.conversationsService.findOrCreateConversation(
        scenario.tenantId,
        customer.id,
        SIM_CHANNEL,
        SIM_CHANNEL_ACCOUNT_ID,
      );

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];

      // Normalize message to array to simulate Instagram debounce.
      const inboundMessages = Array.isArray(turn.message) ? turn.message : [turn.message];
      const combinedText = inboundMessages.join('\n');

      // Resolve customer_photo URL at runtime to a fresh linked media_url
      // so vision matching compares the same image against itself.
      let mediaReference = turn.mediaReference;
      if (turn.resolveMediaFromLinkedProduct && mediaReference?.type === 'customer_photo') {
        const rows: Array<{ media_url: string }> = await this.dataSource.query(
          `SELECT media_url FROM instagram_media_mappings
           WHERE tenant_id = $1 AND product_id IS NOT NULL AND media_url IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [scenario.tenantId],
        );
        if (rows[0]?.media_url) {
          mediaReference = { ...mediaReference, mediaId: rows[0].media_url };
        }
      }

      // Save each inbound message row separately (matches production debounce).
      for (const msg of inboundMessages) {
        await this.conversationsService.saveMessage(
          conversation.id,
          scenario.tenantId,
          MessageDirection.Inbound,
          MessageRole.User,
          msg,
        );
      }

      // Load recent messages
      const fullConversation = await this.conversationsService.findById(
        conversation.id,
      );
      const recentMessages = fullConversation.messages
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(-10)
        .map((m) => ({ role: m.role, text: m.text }));

      // Reload fresh state
      const freshState = await this.dataSource
        .getRepository(ConversationState)
        .findOne({ where: { conversationId: conversation.id } });

      if (!freshState) {
        throw new Error(
          `No state found for conversation ${conversation.id}`,
        );
      }

      // Call reply engine
      let result: ReplyEngineOutput;
      try {
        result = await this.replyEngine.process({
          tenantId: scenario.tenantId,
          conversationId: conversation.id,
          messageText: combinedText,
          state: freshState,
          recentMessages,
          mediaReference,
        });
      } catch (err) {
        throw new Error(
          `Error on turn ${i + 1}: ${(err as Error).message}`,
        );
      }

      // Save outbound message
      if (result.reply?.text) {
        await this.conversationsService.saveMessage(
          conversation.id,
          scenario.tenantId,
          MessageDirection.Outbound,
          MessageRole.Assistant,
          result.reply.text,
        );
      }

      // Apply state update
      if (result.stateUpdate) {
        await this.conversationsService.updateState(
          conversation.id,
          result.stateUpdate,
        );
      }

      // Read updated state for log
      const updatedState = await this.dataSource
        .getRepository(ConversationState)
        .findOne({ where: { conversationId: conversation.id } });

      const memory = (updatedState?.contextJson ?? {}) as Record<
        string,
        unknown
      >;

      // Run assertions
      const assertions = turn.expect ? this.runAssertions(turn.expect, result, memory) : [];

      // Build log entry
      turnLogs.push({
        turnIndex: i,
        message: combinedText,
        mediaReference,
        classification: result.classification
          ? {
              primaryIntent: result.classification.primaryIntent,
              recommendedAction: result.classification.recommendedAction,
              entities: result.classification.entities,
              slotAction: (result.classification as any).slotAction,
              confidence: result.classification.confidence,
              conversationStage: result.classification.conversationStage,
              dialogueAct: result.classification.dialogueAct,
            }
          : null,
        decision: result.decision,
        scenario: result.templateScenario ?? null,
        replyText: result.reply?.text ?? null,
        prefixReply: null,
        secondaryReply: null,
        extraReplies: (result.extraReplies ?? []).map((r) => ({
          text: r.text,
          imageUrls: r.imageUrls,
        })),
        imageUrls: result.reply?.imageUrls,
        state: {
          selectionState: memory.selectionState,
          selectedProductId: memory.selectedProductId,
          selectedVariantId: memory.selectedVariantId,
          selectedVariantName: memory.selectedVariantName,
          cartItems: memory.cartItems,
          lastAction: memory.lastAction,
          awaitingField: memory.awaitingField,
          preQualifyCollected: memory.preQualifyCollected,
          recommendedSize: memory.recommendedSize,
          orderCreated: memory.orderCreated,
        },
        assertions,
        trace: result.trace ?? [],
      });
    }

    return turnLogs;
    } finally {
      await restoreFlowConfig();
    }
  }

  private async resolveTenantId(tenantIdOrSlug: string): Promise<string> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(tenantIdOrSlug)) return tenantIdOrSlug;
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [tenantIdOrSlug],
    );
    if (rows.length === 0) {
      throw new Error(`Scenario tenantId/slug "${tenantIdOrSlug}" not found in tenants table`);
    }
    return rows[0].id;
  }

  private async applyFlowConfigOverride(
    scenario: SimulatorScenario,
  ): Promise<() => Promise<void>> {
    if (!scenario.flowConfigOverride) {
      return async () => {};
    }
    const rows: Array<{ flow_config: Record<string, unknown> | null }> =
      await this.dataSource.query(
        `SELECT flow_config FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
        [scenario.tenantId],
      );
    const original = rows[0]?.flow_config ?? {};
    const merged = { ...original, ...scenario.flowConfigOverride };
    await this.dataSource.query(
      `UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`,
      [JSON.stringify(merged), scenario.tenantId],
    );
    return async () => {
      await this.dataSource.query(
        `UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`,
        [JSON.stringify(original), scenario.tenantId],
      );
    };
  }

  private runAssertions(
    expect: SimulatorTurnExpect,
    result: ReplyEngineOutput,
    memory: Record<string, unknown>,
  ): Array<{ field: string; pass: boolean; expected: unknown; actual: unknown; message?: string }> {
    const out: Array<{ field: string; pass: boolean; expected: unknown; actual: unknown; message?: string }> = [];
    const arr = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

    const push = (field: string, pass: boolean, expected: unknown, actual: unknown, message?: string) => {
      out.push({ field, pass, expected, actual, message });
    };

    if (expect.decision !== undefined) {
      push('decision', result.decision === expect.decision, expect.decision, result.decision);
    }
    if (expect.scenario !== undefined) {
      const actual = result.templateScenario ?? null;
      push('scenario', actual === expect.scenario, expect.scenario, actual);
    }
    for (const sub of arr(expect.replyContains)) {
      push('replyContains', (result.reply?.text ?? '').toLowerCase().includes(sub.toLowerCase()), sub, result.reply?.text?.slice(0, 80));
    }
    for (const sub of arr(expect.replyNotContains)) {
      push('replyNotContains', !(result.reply?.text ?? '').toLowerCase().includes(sub.toLowerCase()), `NOT ${sub}`, result.reply?.text?.slice(0, 80));
    }
    if (expect.imageCount !== undefined) {
      const actual = result.reply?.imageUrls?.length ?? 0;
      push('imageCount', actual === expect.imageCount, expect.imageCount, actual);
    }
    if (expect.extraReplyCount !== undefined) {
      const actual = result.extraReplies?.length ?? 0;
      push('extraReplyCount', actual === expect.extraReplyCount, expect.extraReplyCount, actual);
    }
    if (expect.extraReplyImageContains !== undefined) {
      const sub = expect.extraReplyImageContains.toLowerCase();
      const allUrls = (result.extraReplies ?? []).flatMap((r) => r.imageUrls ?? []);
      const found = allUrls.some((u) => u.toLowerCase().includes(sub));
      push(
        'extraReplyImageContains',
        found,
        sub,
        allUrls.length ? allUrls : '(no extra image urls)',
      );
    }

    if (expect.state) {
      const s = expect.state;
      if (s.selectionState !== undefined) push('state.selectionState', memory.selectionState === s.selectionState, s.selectionState, memory.selectionState);
      if (s.selectedProductId !== undefined) {
        if (s.selectedProductId === null) push('state.selectedProductId', !memory.selectedProductId, null, memory.selectedProductId);
        else push('state.selectedProductId', memory.selectedProductId === s.selectedProductId, s.selectedProductId, memory.selectedProductId);
      }
      if (s.selectedVariantName !== undefined) push('state.selectedVariantName', memory.selectedVariantName === s.selectedVariantName, s.selectedVariantName, memory.selectedVariantName);
      if (s.cartLength !== undefined) {
        const actual = Array.isArray(memory.cartItems) ? memory.cartItems.length : 0;
        push('state.cartLength', actual === s.cartLength, s.cartLength, actual);
      }
      if (s.cartHasVariant !== undefined) {
        const items = Array.isArray(memory.cartItems) ? memory.cartItems as any[] : [];
        const found = items.some(it => it.variantName === s.cartHasVariant);
        push('state.cartHasVariant', found, s.cartHasVariant, items.map(it => it.variantName));
      }
      if (s.lastAction !== undefined) push('state.lastAction', memory.lastAction === s.lastAction, s.lastAction, memory.lastAction);
      if (s.awaitingField !== undefined) push('state.awaitingField', memory.awaitingField === s.awaitingField, s.awaitingField, memory.awaitingField);
      if (s.preQualifyCollected !== undefined) push('state.preQualifyCollected', memory.preQualifyCollected === s.preQualifyCollected, s.preQualifyCollected, memory.preQualifyCollected);
      if (s.recommendedSize !== undefined) push('state.recommendedSize', memory.recommendedSize === s.recommendedSize, s.recommendedSize, memory.recommendedSize);
      if (s.recommendedSkinType !== undefined) push('state.recommendedSkinType', memory.recommendedSkinType === s.recommendedSkinType, s.recommendedSkinType, memory.recommendedSkinType);
      if (s.shouldOfferSizeHelp !== undefined) push('state.shouldOfferSizeHelp', !!memory.shouldOfferSizeHelp === s.shouldOfferSizeHelp, s.shouldOfferSizeHelp, !!memory.shouldOfferSizeHelp);
      if (s.awaitingPreQualifyAnswer !== undefined) push('state.awaitingPreQualifyAnswer', !!memory.awaitingPreQualifyAnswer === s.awaitingPreQualifyAnswer, s.awaitingPreQualifyAnswer, !!memory.awaitingPreQualifyAnswer);
      if (s.orderCreated !== undefined) push('state.orderCreated', memory.orderCreated === s.orderCreated, s.orderCreated, memory.orderCreated);
    }

    return out;
  }

  private async cleanup(tenantId: string): Promise<void> {
    await this.dataSource.query(
      `
      DELETE FROM messages WHERE conversation_id IN (
        SELECT conv.id FROM conversations conv
        JOIN customers cust ON conv.customer_id = cust.id
        WHERE cust.external_user_id = $1 AND cust.tenant_id = $2
      )
    `,
      [SIM_CUSTOMER_EXTERNAL_ID, tenantId],
    );

    await this.dataSource.query(
      `
      DELETE FROM conversation_state WHERE conversation_id IN (
        SELECT conv.id FROM conversations conv
        JOIN customers cust ON conv.customer_id = cust.id
        WHERE cust.external_user_id = $1 AND cust.tenant_id = $2
      )
    `,
      [SIM_CUSTOMER_EXTERNAL_ID, tenantId],
    );

    await this.dataSource.query(
      `
      DELETE FROM conversations WHERE customer_id IN (
        SELECT id FROM customers WHERE external_user_id = $1 AND tenant_id = $2
      )
    `,
      [SIM_CUSTOMER_EXTERNAL_ID, tenantId],
    );

    await this.dataSource.query(
      `
      DELETE FROM customers WHERE external_user_id = $1 AND tenant_id = $2
    `,
      [SIM_CUSTOMER_EXTERNAL_ID, tenantId],
    );
  }
}
