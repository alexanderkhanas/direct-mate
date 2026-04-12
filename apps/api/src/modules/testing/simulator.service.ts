import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ReplyEngineService,
  ReplyEngineOutput,
} from '../conversations/reply-engine.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationState } from '../conversations/entities/conversation-state.entity';
import { MessageDirection, MessageRole } from '@direct-mate/shared';
import { SimulatorScenario } from '../../scripts/scenarios';

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
  imageUrls?: string[];
  state: Record<string, unknown>;
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
    const turnLogs: SimulatorTurnLog[] = [];

    // Clean up previous sim data for this tenant
    await this.cleanup(scenario.tenantId);

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

      // Save inbound message
      await this.conversationsService.saveMessage(
        conversation.id,
        scenario.tenantId,
        MessageDirection.Inbound,
        MessageRole.User,
        turn.message,
      );

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

      // Determine last activity (for greeting gap detection)
      const sorted = fullConversation.messages.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const previousMessages = sorted.slice(0, -1);
      const lastActivityAt =
        previousMessages.length > 0
          ? previousMessages[previousMessages.length - 1].createdAt
          : undefined;

      // Call reply engine
      let result: ReplyEngineOutput;
      try {
        result = await this.replyEngine.process({
          tenantId: scenario.tenantId,
          conversationId: conversation.id,
          messageText: turn.message,
          state: freshState,
          recentMessages,
          lastActivityAt,
          mediaReference: turn.mediaReference,
          skipFileLog: true,
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

      // Build log entry
      turnLogs.push({
        turnIndex: i,
        message: turn.message,
        mediaReference: turn.mediaReference,
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
        prefixReply: result.prefixReply?.text ?? null,
        secondaryReply: result.secondaryReply?.text ?? null,
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
      });
    }

    return turnLogs;
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
