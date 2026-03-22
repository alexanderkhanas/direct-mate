import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../audit/audit.service';
import {
  AuditLogType,
  AuditLogStatus,
  ConversationStateStatus,
  MessageDirection,
  MessageRole,
  ReplyDecision,
} from '@direct-mate/shared';

export interface ReplyEngineInput {
  tenantId: string;
  conversationId: string;
  messageText: string;
  state: ConversationState;
  recentMessages: Array<{ role: string; text: string | null }>;
}

export interface ReplyEngineOutput {
  decision: ReplyDecision;
  reply: { text: string; sendNow: boolean } | null;
  handoff: { required: boolean; reason: string | null };
  stateUpdate: Partial<ConversationState> | null;
}

@Injectable()
export class ReplyEngineService {
  private readonly logger = new Logger(ReplyEngineService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
    @InjectRepository(ManagerExample)
    private readonly examplesRepo: Repository<ManagerExample>,
    private readonly availabilityService: AvailabilityService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get<string>('openai.apiKey') });
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o';
  }

  async process(input: ReplyEngineInput): Promise<ReplyEngineOutput> {
    const settings = await this.settingsRepo.findOne({
      where: { tenantId: input.tenantId },
    });

    const stockFreshness = settings?.handoffRules?.stockFreshnessMinutes ?? 10;
    const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 2;
    const failedTurns = (input.state.contextJson?.failedTurns as number) ?? 0;

    if (failedTurns >= maxFailedTurns) {
      await this.auditService.log({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        type: AuditLogType.Handoff,
        details: { reason: 'max_failed_turns', failedTurns },
      });
      return {
        decision: ReplyDecision.Handoff,
        reply: null,
        handoff: { required: true, reason: 'max_failed_turns' },
        stateUpdate: null,
      };
    }

    const examples = await this.examplesRepo.find({
      where: { tenantId: input.tenantId, isActive: true },
      take: 5,
    });

    // If we already have a selected product in state, use it as context
    // instead of searching again (e.g. user said "Так" to confirm)
    let availabilityResult: Awaited<ReturnType<typeof this.runAvailabilityCheck>>;

    if (
      input.state.selectedProductId &&
      input.state.stateStatus === ConversationStateStatus.StockConfirmed
    ) {
      // Fetch the selected product info for context
      const selectedContext = await this.getSelectedProductContext(
        input.state.selectedProductId,
        input.state.selectedVariantId ?? undefined,
      );
      availabilityResult = {
        handoffRequired: false,
        context: selectedContext ?? 'Previously selected product',
        variantId: input.state.selectedVariantId ?? undefined,
        productId: input.state.selectedProductId,
      };
    } else {
      availabilityResult = await this.runAvailabilityCheck(
        input.tenantId,
        input.conversationId,
        input.messageText,
        stockFreshness,
      );
    }

    if (availabilityResult.handoffRequired) {
      return {
        decision: ReplyDecision.Handoff,
        reply: null,
        handoff: { required: true, reason: availabilityResult.reason ?? 'stale_data' },
        stateUpdate: null,
      };
    }

    let replyText: string;
    try {
      replyText = await this.generateReply({
        brandTone: settings?.brandTonePrompt ?? 'Warm and concise, like a professional manager',
        examples,
        messageText: input.messageText,
        recentMessages: input.recentMessages,
        availabilityContext: availabilityResult.context,
        language: settings?.supportedLanguages?.[0] ?? 'uk',
      });
    } catch (err) {
      this.logger.error('OpenAI call failed', err);
      await this.auditService.log({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        type: AuditLogType.AiDecision,
        status: AuditLogStatus.Failed,
        details: { error: 'openai_failure' },
      });
      return {
        decision: ReplyDecision.Handoff,
        reply: null,
        handoff: { required: true, reason: 'ai_failure' },
        stateUpdate: null,
      };
    }

    const stateUpdate: Partial<ConversationState> = {};
    if (availabilityResult.variantId) {
      stateUpdate.selectedVariantId = availabilityResult.variantId;
      stateUpdate.selectedProductId = availabilityResult.productId ?? undefined;
      stateUpdate.stateStatus = ConversationStateStatus.StockConfirmed;
    }

    await this.auditService.log({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: AuditLogType.AiDecision,
      details: { decision: ReplyDecision.Reply },
    });

    return {
      decision: ReplyDecision.Reply,
      reply: { text: replyText, sendNow: true },
      handoff: { required: false, reason: null },
      stateUpdate,
    };
  }

  private async getSelectedProductContext(
    productId: string,
    variantId?: string,
  ): Promise<string | null> {
    try {
      const result = await this.availabilityService.getByProductId(productId, variantId);
      if (!result) return null;
      const parts = [`Customer previously selected: ${result.title}`];
      if (result.variant) {
        parts.push(`Variant: ${[result.variant.size, result.variant.color].filter(Boolean).join(', ')}`);
        parts.push(`Price: ${result.variant.price} ${result.variant.currency}`);
      }
      if (result.stock !== undefined) {
        parts.push(`Stock: ${result.stock} available`);
      }
      parts.push(`Status: customer confirmed interest, proceed with ordering flow`);
      return parts.join('. ');
    } catch {
      return null;
    }
  }

  private async runAvailabilityCheck(
    tenantId: string,
    conversationId: string,
    text: string,
    maxFreshnessMinutes: number,
  ): Promise<{
    handoffRequired: boolean;
    reason?: string;
    context?: string;
    variantId?: string;
    productId?: string;
  }> {
    try {
      const result = await this.availabilityService.check(tenantId, { query: text });

      await this.auditService.log({
        tenantId,
        conversationId,
        type: AuditLogType.AvailabilityCheck,
        details: {
          matchType: result.matchType,
          variantId: result.variant?.id,
          effectiveAvailable: result.stock?.effectiveAvailable,
        },
      });

      if (result.matchType === 'none') {
        return {
          handoffRequired: false,
          context: 'No matching product found',
        };
      }

      if (result.stock && !result.stock.isFresh) {
        return {
          handoffRequired: true,
          reason: 'stale_stock_data',
        };
      }

      if (result.stock && result.stock.effectiveAvailable <= 0) {
        return {
          handoffRequired: false,
          context: `${result.product?.title} is currently out of stock`,
        };
      }

      return {
        handoffRequired: false,
        context: `${result.product?.title} is available (${result.stock?.effectiveAvailable} units)`,
        variantId: result.variant?.id,
        productId: result.product?.id,
      };
    } catch (err) {
      this.logger.error('Availability check failed', err);
      return { handoffRequired: true, reason: 'availability_check_failed' };
    }
  }

  private async generateReply(params: {
    brandTone: string;
    examples: ManagerExample[];
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    availabilityContext?: string;
    language?: string;
  }): Promise<string> {
    const lang = params.language ?? 'uk';
    const langMap: Record<string, string> = { uk: 'Ukrainian', en: 'English', ru: 'Russian' };
    const langName = langMap[lang] ?? lang;

    const systemParts = [
      `You are a sales assistant for an online store. CRITICAL: You MUST reply ONLY in ${langName}. Never switch to another language regardless of what language the customer uses.`,
      `\nTone and personality:\n${params.brandTone}`,
    ];
    if (params.availabilityContext) {
      systemParts.push(`\nStock context: ${params.availabilityContext}`);
    }
    systemParts.push(`\nRules:\n- Be concise and warm\n- Never invent stock or pricing facts\n- Always respond in ${langName}\n- NEVER say "contact manager", "ask our manager", or reveal you are AI/bot\n- If you don't know something, say you'll check and get back to them\n- Act as the store manager yourself — you ARE the manager`);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemParts.join('\n') },
    ];

    // Add few-shot examples
    for (const ex of params.examples) {
      messages.push({ role: 'user', content: ex.customerMessage });
      messages.push({ role: 'assistant', content: ex.managerReply });
    }

    // Add conversation history
    for (const msg of params.recentMessages) {
      const role = msg.role === MessageRole.User ? 'user' : 'assistant';
      messages.push({ role, content: msg.text ?? '' });
    }

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    return completion.choices[0]?.message?.content?.trim() ?? '';
  }
}
