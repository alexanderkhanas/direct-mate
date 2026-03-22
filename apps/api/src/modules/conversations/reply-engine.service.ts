import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';
import { ConversationState } from './entities/conversation-state.entity';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../audit/audit.service';
import {
  AuditLogType,
  ConversationStateStatus,
  MessageRole,
  ReplyDecision,
} from '@direct-mate/shared';

// ─── Public interfaces ───────────────────────────────────────────

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

// ─── AI structured output ────────────────────────────────────────

interface AIPlan {
  intent: string;
  dialogue_act: string;
  dialogue_state: string;
  product_keywords: string[];
  next_action: string;
  needs_handoff: boolean;
  handoff_reason: string | null;
  reply: string;
}

// ─── Assistant action memory (stored in contextJson) ─────────────

interface AssistantMemory {
  lastAction?: string;
  lastPresentedProducts?: Array<{
    title: string;
    variants: string[];
    price: string;
  }>;
  awaitingField?: string;
  selectedCategory?: string;
  failedTurns?: number;
}

// ─── Tool definition ─────────────────────────────────────────────

const PLAN_AND_REPLY_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'plan_and_reply',
    description: 'Analyze the conversation context, plan the next action, and generate a reply',
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: [
            'greeting', 'product_inquiry', 'category_browse', 'availability_check',
            'price_inquiry', 'order_intent', 'order_details', 'delivery_question',
            'payment_question', 'general_question', 'complaint', 'thanks', 'unknown',
          ],
        },
        dialogue_act: {
          type: 'string',
          enum: [
            'new_inquiry',
            'ask_recommendation',
            'confirm_choice',
            'provide_details',
            'ask_about_shown_products',
            'short_contextual_reply',
            'clarification',
            'general_chat',
          ],
          description: 'What the user is actually doing in the conversation context. "short_contextual_reply" = user gave a brief answer to the bot\'s previous question. "ask_recommendation" = user wants the bot to suggest from already shown options. "confirm_choice" = user is saying yes/agreeing.',
        },
        dialogue_state: {
          type: 'string',
          enum: [
            'idle',
            'product_category_selected',
            'product_list_shown',
            'waiting_for_choice',
            'product_selected',
            'checkout_started',
            'collecting_delivery_info',
          ],
          description: 'The current state of the conversation AFTER processing this message.',
        },
        product_keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Product names/categories to search in the database. Include the customer\'s original term AND closest matching categories from the available list. Empty only for non-product intents.',
        },
        next_action: {
          type: 'string',
          enum: [
            'search_products',
            'present_options',
            'recommend_from_shown',
            'confirm_selection',
            'start_checkout',
            'ask_delivery_details',
            'answer_question',
            'greet',
            'clarify',
            'handoff',
          ],
          description: 'What the bot should do next.',
        },
        needs_handoff: {
          type: 'boolean',
          description: 'True ONLY for truly impossible requests (complex complaints, refunds, completely outside scope). False for everything else.',
        },
        handoff_reason: { type: 'string', nullable: true },
        reply: {
          type: 'string',
          description: 'The reply to send to the customer. Must follow the conversation flow rules.',
        },
      },
      required: [
        'intent', 'dialogue_act', 'dialogue_state', 'product_keywords',
        'next_action', 'needs_handoff', 'reply',
      ],
    },
  },
};

const LOG_FILE = path.join(process.cwd(), 'conversations.log');

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class ReplyEngineService {
  private readonly logger = new Logger(ReplyEngineService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  private logToFile(entry: Record<string, unknown>) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFile(LOG_FILE, line, () => {});
  }

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

  // ─── Main entry point ────────────────────────────────────────

  async process(input: ReplyEngineInput): Promise<ReplyEngineOutput> {
    const settings = await this.settingsRepo.findOne({
      where: { tenantId: input.tenantId },
    });

    const memory: AssistantMemory = (input.state.contextJson as AssistantMemory) ?? {};
    const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 5;

    if ((memory.failedTurns ?? 0) >= maxFailedTurns) {
      return this.doHandoff(input, 'max_failed_turns');
    }

    const [examples, categories] = await Promise.all([
      this.examplesRepo.find({ where: { tenantId: input.tenantId, isActive: true }, take: 10 }),
      this.availabilityService.getCategories(input.tenantId),
    ]);

    // ── Step 1: AI plans the response ──────────────────────────
    let plan: AIPlan;
    try {
      plan = await this.planResponse({
        brandTone: settings?.brandTonePrompt ?? '',
        examples,
        messageText: input.messageText,
        recentMessages: input.recentMessages,
        memory,
        categories,
        language: settings?.supportedLanguages?.[0] ?? 'uk',
      });
    } catch (err) {
      this.logger.error('AI plan failed', err);
      return this.doHandoff(input, 'ai_failure');
    }

    this.logger.log(
      `Plan: intent=${plan.intent} act=${plan.dialogue_act} state=${plan.dialogue_state} action=${plan.next_action} keywords=[${plan.product_keywords.join(',')}] handoff=${plan.needs_handoff}`,
    );

    this.logToFile({
      event: 'plan',
      conversationId: input.conversationId,
      inbound: input.messageText,
      plan: {
        intent: plan.intent,
        dialogueAct: plan.dialogue_act,
        dialogueState: plan.dialogue_state,
        nextAction: plan.next_action,
        keywords: plan.product_keywords,
        handoff: plan.needs_handoff,
      },
      memory,
    });

    // ── Handoff verification with stronger model ───────────────
    if (plan.needs_handoff) {
      const fallbackModel = this.config.get<string>('openai.fallbackModel');
      if (fallbackModel) {
        try {
          const secondOpinion = await this.planResponse({
            brandTone: settings?.brandTonePrompt ?? '',
            examples,
            messageText: input.messageText,
            recentMessages: input.recentMessages,
            memory,
            categories,
            language: settings?.supportedLanguages?.[0] ?? 'uk',
            modelOverride: fallbackModel,
          });

          this.logToFile({
            event: 'handoff_verification',
            conversationId: input.conversationId,
            miniSaysHandoff: true,
            fallbackSaysHandoff: secondOpinion.needs_handoff,
            fallbackReply: secondOpinion.reply,
          });

          if (!secondOpinion.needs_handoff) {
            this.logger.log(`Fallback model overrode handoff`);
            plan = secondOpinion;
          }
        } catch {
          this.logger.warn('Fallback verification failed');
        }
      }
    }

    if (plan.needs_handoff) {
      return this.doHandoff(input, plan.handoff_reason ?? plan.intent);
    }

    // ── Step 2: Product search if needed ────────────────────────
    const stateUpdate: Partial<ConversationState> = {};
    let finalReply = plan.reply;

    const needsSearch = plan.next_action === 'search_products' && plan.product_keywords.length > 0;

    if (needsSearch) {
      const searchResult = await this.searchProducts(
        input.tenantId,
        input.conversationId,
        plan.product_keywords,
      );

      this.logToFile({
        event: 'product_search',
        conversationId: input.conversationId,
        keywords: plan.product_keywords,
        found: searchResult.found,
        products: searchResult.presentedProducts?.map((p) => p.title),
      });

      if (searchResult.found) {
        // ── Step 3: Re-generate reply with real product data ───
        try {
          const enriched = await this.planResponse({
            brandTone: settings?.brandTonePrompt ?? '',
            examples,
            messageText: input.messageText,
            recentMessages: input.recentMessages,
            memory,
            categories,
            language: settings?.supportedLanguages?.[0] ?? 'uk',
            productContext: searchResult.context,
          });
          finalReply = enriched.reply;
          plan.dialogue_state = enriched.dialogue_state;
          plan.next_action = enriched.next_action;
        } catch { /* use plan reply */ }

        stateUpdate.selectedVariantId = searchResult.variantId;
        stateUpdate.selectedProductId = searchResult.productId;

        // Update memory with presented products
        memory.lastAction = 'presented_product_options';
        memory.lastPresentedProducts = searchResult.presentedProducts;
        memory.awaitingField = 'product_choice_or_recommendation_request';
        memory.selectedCategory = plan.product_keywords[0];
      }
    }

    // ── Update conversation state ──────────────────────────────
    const stateMap: Record<string, ConversationStateStatus> = {
      'product_list_shown': ConversationStateStatus.StockConfirmed,
      'waiting_for_choice': ConversationStateStatus.StockConfirmed,
      'product_selected': ConversationStateStatus.StockConfirmed,
      'checkout_started': ConversationStateStatus.CollectingCustomerInfo,
      'collecting_delivery_info': ConversationStateStatus.CollectingCustomerInfo,
    };
    const mappedStatus = stateMap[plan.dialogue_state];
    if (mappedStatus) {
      stateUpdate.stateStatus = mappedStatus;
    }

    // Update memory based on what the bot just did
    if (plan.next_action === 'recommend_from_shown') {
      memory.lastAction = 'gave_recommendation';
      memory.awaitingField = 'product_choice';
    } else if (plan.next_action === 'confirm_selection') {
      memory.lastAction = 'confirmed_product';
      memory.awaitingField = 'order_confirmation';
    } else if (plan.next_action === 'ask_delivery_details') {
      memory.lastAction = 'asked_delivery_details';
      memory.awaitingField = 'delivery_info';
    } else if (plan.next_action === 'greet') {
      memory.lastAction = 'greeted';
      memory.awaitingField = 'product_inquiry';
    }

    stateUpdate.contextJson = memory as any;

    await this.auditService.log({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: AuditLogType.AiDecision,
      details: {
        decision: ReplyDecision.Reply,
        intent: plan.intent,
        dialogueAct: plan.dialogue_act,
        nextAction: plan.next_action,
      },
    });

    this.logToFile({
      event: 'reply',
      conversationId: input.conversationId,
      inbound: input.messageText,
      outbound: finalReply,
      dialogueState: plan.dialogue_state,
      nextAction: plan.next_action,
      memory,
    });

    return {
      decision: ReplyDecision.Reply,
      reply: { text: finalReply, sendNow: true },
      handoff: { required: false, reason: null },
      stateUpdate,
    };
  }

  // ─── AI planning call ────────────────────────────────────────

  private async planResponse(params: {
    brandTone: string;
    examples: ManagerExample[];
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    language: string;
    productContext?: string;
    modelOverride?: string;
  }): Promise<AIPlan> {
    const lang = params.language ?? 'uk';
    const langMap: Record<string, string> = { uk: 'Ukrainian', en: 'English' };
    const langName = langMap[lang] ?? lang;

    // Build memory context for the AI
    const memoryContext = this.buildMemoryContext(params.memory);

    const systemPrompt = [
      `You are a sales manager for an online store. Reply ONLY in ${langName}.`,
      params.brandTone ? `\nTone:\n${params.brandTone}` : '',

      // Product data
      params.productContext
        ? `\nProduct data from database:\n${params.productContext}`
        : '',

      // Categories
      params.categories.length
        ? `\nAvailable categories: ${params.categories.join(', ')}.`
        : '',

      // Assistant memory — what happened before
      memoryContext ? `\n${memoryContext}` : '',

      // Core rules
      `\nCONVERSATION RULES:`,
      `1. NEVER repeat what you already said. If you showed a product list or recommended something, don't repeat it.`,
      `2. SHORT REPLIES from the user (e.g. "підкажіть", "цей", "рожевий", "так", "добре", "давайте", "блиск") must be interpreted in context of your LAST question/action.`,
      `3. If you showed options and user asks for recommendation → recommend specific product(s) with a reason, don't re-ask.`,
      `4. If user says a color/variant name → match it to the products you already showed.`,
      `5. When presenting products: be conversational, not tabular. Group by price if same. Highlight differences.`,
      `6. NEVER say "contact manager" or reveal you are AI.`,
      `7. If product not found, say you'll check and follow up.`,
      `8. Lead the conversation forward — always give the user a clear next step.`,
      ``,
      `CRITICAL FLOW AFTER RECOMMENDATION:`,
      `- After you recommend a specific product and user AGREES ("добре", "так", "давайте", "ок", "цей") → immediately ask "Оформлюємо замовлення? 💛" Do NOT repeat the product description again.`,
      `- After user confirms order ("так", "давайте", "оформлюємо", "давайте оформимо") → immediately ask for delivery details (name, phone, city, Nova Poshta). Do NOT re-describe the product.`,
      `- NEVER ask the same question twice. If user already agreed, MOVE FORWARD.`,

      `\nExtract product_keywords for product-related intents. Include the customer's term AND the closest matching category name(s).`,
      `\nSet next_action to "search_products" when you need product data from the database. Set it to other values when you already have the data or don't need it.`,

      `\nCall plan_and_reply with your analysis and response.`,
    ].filter(Boolean).join('\n');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const ex of params.examples) {
      messages.push({ role: 'user', content: ex.customerMessage });
      messages.push({ role: 'assistant', content: ex.managerReply });
    }

    for (const msg of params.recentMessages) {
      const role = msg.role === MessageRole.User ? 'user' : 'assistant';
      messages.push({ role, content: msg.text ?? '' });
    }

    const completion = await this.openai.chat.completions.create({
      model: params.modelOverride ?? this.model,
      messages,
      tools: [PLAN_AND_REPLY_TOOL],
      tool_choice: { type: 'function', function: { name: 'plan_and_reply' } },
      max_completion_tokens: 600,
      temperature: 0.3,
    } as any);

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return {
        intent: 'unknown', dialogue_act: 'general_chat', dialogue_state: 'idle',
        product_keywords: [], next_action: 'clarify', needs_handoff: false,
        handoff_reason: null,
        reply: completion.choices[0]?.message?.content?.trim() ?? '',
      };
    }

    return JSON.parse((toolCall as any).function.arguments) as AIPlan;
  }

  // ─── Memory context builder ──────────────────────────────────

  private buildMemoryContext(memory: AssistantMemory): string {
    if (!memory.lastAction) return '';

    const parts = [`\nASSISTANT MEMORY (what happened before):`];
    parts.push(`Last action: ${memory.lastAction}`);

    if (memory.lastPresentedProducts?.length) {
      parts.push(`Products shown to customer:`);
      for (const p of memory.lastPresentedProducts) {
        const variants = p.variants.join(', ');
        parts.push(`  • ${p.title} (${variants}) — ${p.price}`);
      }
    }

    if (memory.awaitingField) {
      parts.push(`Currently waiting for: ${memory.awaitingField}`);
    }
    if (memory.selectedCategory) {
      parts.push(`Selected category: ${memory.selectedCategory}`);
    }

    return parts.join('\n');
  }

  // ─── Product search ──────────────────────────────────────────

  private async searchProducts(
    tenantId: string,
    conversationId: string,
    keywords: string[],
  ): Promise<{
    found: boolean;
    context?: string;
    variantId?: string;
    productId?: string;
    presentedProducts?: Array<{ title: string; variants: string[]; price: string }>;
  }> {
    for (const keyword of keywords) {
      const results = await this.availabilityService.checkAll(tenantId, { query: keyword });

      await this.auditService.log({
        tenantId, conversationId,
        type: AuditLogType.AvailabilityCheck,
        details: { keyword, productsFound: results.length },
      });

      if (results.length > 0) {
        const contextParts: string[] = [];
        const presentedProducts: Array<{ title: string; variants: string[]; price: string }> = [];

        for (const r of results) {
          const variantDescs: string[] = [];
          const variantNames: string[] = [];
          for (const v of r.variants) {
            const details = [v.size, v.color].filter(Boolean).join(', ');
            const stock = v.effectiveAvailable > 0 ? 'в наявності' : 'немає';
            variantDescs.push(`${details || 'standard'}: ${v.price} ${v.currency} (${stock})`);
            variantNames.push(details || 'standard');
          }
          contextParts.push(`- ${r.product.title}: ${variantDescs.join('; ')}`);

          const prices = [...new Set(r.variants.map((v) => `${v.price} ${v.currency}`))];
          presentedProducts.push({
            title: r.product.title,
            variants: variantNames,
            price: prices.join(' / '),
          });
        }

        const firstResult = results[0];
        const firstInStock = firstResult.variants.find((v) => v.effectiveAvailable > 0);

        return {
          found: true,
          context: `Products found:\n${contextParts.join('\n')}`,
          variantId: firstInStock?.id ?? firstResult.variants[0]?.id,
          productId: firstResult.product.id,
          presentedProducts,
        };
      }
    }

    return { found: false };
  }

  // ─── Handoff helper ──────────────────────────────────────────

  private async doHandoff(input: ReplyEngineInput, reason: string): Promise<ReplyEngineOutput> {
    await this.auditService.log({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: AuditLogType.Handoff,
      details: { reason },
    });
    this.logToFile({
      event: 'handoff',
      conversationId: input.conversationId,
      inbound: input.messageText,
      reason,
    });
    return {
      decision: ReplyDecision.Handoff,
      reply: null,
      handoff: { required: true, reason },
      stateUpdate: null,
    };
  }
}
