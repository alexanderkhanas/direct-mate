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
import { StoreConfig } from '../engine/entities/store-config.entity';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../audit/audit.service';
import {
  ClassifierService,
  ClassificationResult,
  AssistantMemory,
} from '../engine/classifier.service';
import {
  TemplateEngineService,
  ProductSearchResult,
} from '../engine/template-engine.service';
import { PolicyEngineService } from '../engine/policy-engine.service';
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

const LOG_FILE = path.join(process.cwd(), 'conversations.log');

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class ReplyEngineService {
  private readonly logger = new Logger(ReplyEngineService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  private logToFile(entry: Record<string, unknown>) {
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFile(LOG_FILE, line, () => {});
  }

  constructor(
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
    @InjectRepository(ManagerExample)
    private readonly examplesRepo: Repository<ManagerExample>,
    @InjectRepository(StoreConfig)
    private readonly storeConfigRepo: Repository<StoreConfig>,
    private readonly availabilityService: AvailabilityService,
    private readonly auditService: AuditService,
    private readonly classifierService: ClassifierService,
    private readonly templateEngine: TemplateEngineService,
    private readonly policyEngine: PolicyEngineService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('openai.apiKey'),
    });
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o';
  }

  // ─── Main entry point ──────────────────────────────────────────

  async process(input: ReplyEngineInput): Promise<ReplyEngineOutput> {
    // 1. Load store config, settings, examples, categories
    const [settings, storeConfig, examples, categories] = await Promise.all([
      this.settingsRepo.findOne({ where: { tenantId: input.tenantId } }),
      this.storeConfigRepo.findOne({ where: { tenantId: input.tenantId } }),
      this.examplesRepo.find({
        where: { tenantId: input.tenantId, isActive: true },
        take: 10,
      }),
      this.availabilityService.getCategories(input.tenantId),
    ]);

    const memory: AssistantMemory =
      (input.state.contextJson as AssistantMemory) ?? {};
    const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 5;

    // Pre-check: max failed turns
    if ((memory.failedTurns ?? 0) >= maxFailedTurns) {
      return this.doHandoff(input, 'max_failed_turns');
    }

    // Use a default store config if none exists
    const effectiveConfig = storeConfig ??
      ({
        escalationConfig: {},
        fallbackConfig: {
          mode: 'template_first_with_safe_fallback',
        },
        brandConfig: {},
      } as unknown as StoreConfig);

    // 2. AI Classifier: classify intent + extract entities (NO reply text)
    let classification: ClassificationResult;
    try {
      classification = await this.classifierService.classify({
        messageText: input.messageText,
        recentMessages: input.recentMessages,
        memory,
        categories,
        currentStage: this.getCurrentStage(input.state),
      });
    } catch (err) {
      this.logger.error('AI classification failed', err);
      return this.doHandoff(input, 'ai_failure');
    }

    this.logger.log(
      `Classification: intent=${classification.primaryIntent} stage=${classification.conversationStage} ` +
        `action=${classification.recommendedAction} confidence=${classification.confidence} sentiment=${classification.sentiment}`,
    );

    this.logToFile({
      event: 'classification',
      conversationId: input.conversationId,
      inbound: input.messageText,
      classification: {
        intent: classification.primaryIntent,
        entities: classification.entities,
        stage: classification.conversationStage,
        sentiment: classification.sentiment,
        confidence: classification.confidence,
        dialogueAct: classification.dialogueAct,
        action: classification.recommendedAction,
      },
      memory,
    });

    // 3. Policy Engine: check escalation rules
    const policy = this.policyEngine.evaluate({
      classification,
      storeConfig: effectiveConfig,
      state: {
        failedTurns: memory.failedTurns ?? 0,
        maxFailedTurns,
      },
    });

    // 4. If escalate -> handoff verification with fallback model, then return handoff
    if (policy.action === 'escalate') {
      // Handoff verification with stronger model
      const fallbackModel = this.config.get<string>('openai.fallbackModel');
      if (fallbackModel) {
        try {
          const secondOpinion =
            await this.classifierService.classifyWithFallback({
              messageText: input.messageText,
              recentMessages: input.recentMessages,
              memory,
              categories,
              currentStage: this.getCurrentStage(input.state),
            });

          this.logToFile({
            event: 'handoff_verification',
            conversationId: input.conversationId,
            primarySaysEscalate: true,
            fallbackIntent: secondOpinion.primaryIntent,
            fallbackAction: secondOpinion.recommendedAction,
            fallbackConfidence: secondOpinion.confidence,
          });

          // If fallback model disagrees with escalation, override
          const fallbackPolicy = this.policyEngine.evaluate({
            classification: secondOpinion,
            storeConfig: effectiveConfig,
            state: {
              failedTurns: memory.failedTurns ?? 0,
              maxFailedTurns,
            },
          });

          if (fallbackPolicy.action !== 'escalate') {
            this.logger.log(`Fallback model overrode escalation`);
            classification = secondOpinion;
            // Continue processing instead of escalating
          } else {
            return this.doHandoff(input, policy.reason ?? 'policy_escalation');
          }
        } catch {
          this.logger.warn('Fallback verification failed');
          return this.doHandoff(input, policy.reason ?? 'policy_escalation');
        }
      } else {
        return this.doHandoff(input, policy.reason ?? 'policy_escalation');
      }
    }

    // 5. Product search if needed (based on classification entities/keywords)
    let productData: ProductSearchResult[] | undefined;
    const needsSearch = this.shouldSearchProducts(classification);

    if (needsSearch) {
      const searchKeywords = this.extractSearchKeywords(classification);
      productData = await this.searchProducts(
        input.tenantId,
        input.conversationId,
        searchKeywords,
      );

      this.logToFile({
        event: 'product_search',
        conversationId: input.conversationId,
        keywords: searchKeywords,
        found: productData ? productData.length : 0,
      });

      if (productData && productData.length > 0) {
        // Update memory with presented products
        memory.lastAction = 'presented_product_options';
        memory.lastPresentedProducts = productData.map((p) => ({
          title: p.product.title,
          variants: p.variants.map((v) =>
            [v.size, v.color].filter(Boolean).join(', ') || 'standard',
          ),
          price: [
            ...new Set(p.variants.map((v) => `${v.price} ${v.currency}`)),
          ].join(' / '),
        }));
        memory.awaitingField = 'product_choice_or_recommendation_request';
        memory.selectedCategory =
          classification.entities.category ?? searchKeywords[0];
      }
    }

    // 6. Template Engine: select + render template
    const recentTemplateIds = memory.recentTemplateIds ?? [];
    const templateResult = await this.templateEngine.render({
      tenantId: input.tenantId,
      classification,
      productData,
      memory,
      recentTemplateIds,
    });

    let finalReply: string;
    let usedTemplateId: string | undefined;

    if (templateResult) {
      // 7. Template found -> use it
      finalReply = templateResult.text;
      usedTemplateId = templateResult.templateId;

      // Track for anti-repetition
      memory.recentTemplateIds = [
        templateResult.templateId,
        ...recentTemplateIds,
      ].slice(0, 10);

      this.logger.log(`Template selected: ${templateResult.templateId}`);
    } else {
      // 8. No template -> check if AI fallback is allowed
      if (
        policy.action === 'fallback' ||
        this.policyEngine.isFallbackAllowed(classification, effectiveConfig)
      ) {
        this.logger.log('No template matched, using AI fallback');
        try {
          finalReply = await this.aiFallbackReply({
            brandTone: settings?.brandTonePrompt ?? '',
            examples,
            messageText: input.messageText,
            recentMessages: input.recentMessages,
            memory,
            categories,
            language: settings?.supportedLanguages?.[0] ?? 'uk',
            productData,
            classification,
          });
        } catch (err) {
          this.logger.error('AI fallback failed', err);
          memory.failedTurns = (memory.failedTurns ?? 0) + 1;
          return this.doHandoff(input, 'ai_fallback_failure');
        }
      } else {
        // Strict mode: no template + no fallback = escalate
        this.logger.log(
          'No template and fallback not allowed, escalating',
        );
        return this.doHandoff(input, 'no_template_strict_mode');
      }
    }

    // 9. Update conversation state + memory
    const stateUpdate: Partial<ConversationState> = {};

    // Map classification stage to conversation state status
    const stageStatusMap: Record<string, ConversationStateStatus> = {
      showing_options: ConversationStateStatus.StockConfirmed,
      selection_help: ConversationStateStatus.StockConfirmed,
      product_selected: ConversationStateStatus.StockConfirmed,
      checkout_started: ConversationStateStatus.CollectingCustomerInfo,
      collecting_customer_info: ConversationStateStatus.CollectingCustomerInfo,
      order_confirmation: ConversationStateStatus.CollectingCustomerInfo,
    };
    const mappedStatus = stageStatusMap[classification.conversationStage];
    if (mappedStatus) {
      stateUpdate.stateStatus = mappedStatus;
    }

    // Update memory based on recommended action
    this.updateMemoryFromAction(classification, memory);

    // Set product IDs if product search found results
    if (productData && productData.length > 0) {
      const first = productData[0];
      stateUpdate.selectedProductId = first.product.id;
      const inStockVariant = first.variants.find(
        (v) => v.effectiveAvailable > 0,
      );
      stateUpdate.selectedVariantId =
        inStockVariant?.id ?? first.variants[0]?.id;
    }

    stateUpdate.contextJson = memory as any;

    await this.auditService.log({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: AuditLogType.AiDecision,
      details: {
        decision: ReplyDecision.Reply,
        intent: classification.primaryIntent,
        dialogueAct: classification.dialogueAct,
        action: classification.recommendedAction,
        templateId: usedTemplateId ?? 'ai_fallback',
      },
    });

    this.logToFile({
      event: 'reply',
      conversationId: input.conversationId,
      inbound: input.messageText,
      outbound: finalReply,
      templateId: usedTemplateId ?? 'ai_fallback',
      stage: classification.conversationStage,
      action: classification.recommendedAction,
      memory,
    });

    return {
      decision: ReplyDecision.Reply,
      reply: { text: finalReply, sendNow: true },
      handoff: { required: false, reason: null },
      stateUpdate,
    };
  }

  // ─── Product search helpers ────────────────────────────────────

  private shouldSearchProducts(classification: ClassificationResult): boolean {
    const searchActions = [
      'show_products',
      'recommend',
      'show_price',
      'confirm_selection',
    ];
    const searchIntents = [
      'product_inquiry',
      'category_browse',
      'ask_price',
      'availability_check',
      'ask_recommendation',
    ];

    return (
      searchActions.includes(classification.recommendedAction) ||
      searchIntents.includes(classification.primaryIntent)
    );
  }

  private extractSearchKeywords(
    classification: ClassificationResult,
  ): string[] {
    const keywords: string[] = [];
    if (classification.entities.productName)
      keywords.push(classification.entities.productName);
    if (classification.entities.category)
      keywords.push(classification.entities.category);
    if (classification.entities.color)
      keywords.push(classification.entities.color);
    return keywords.length > 0 ? keywords : [''];
  }

  private async searchProducts(
    tenantId: string,
    conversationId: string,
    keywords: string[],
  ): Promise<ProductSearchResult[] | undefined> {
    for (const keyword of keywords) {
      if (!keyword) continue;
      const results = await this.availabilityService.checkAll(tenantId, {
        query: keyword,
      });

      await this.auditService.log({
        tenantId,
        conversationId,
        type: AuditLogType.AvailabilityCheck,
        details: { keyword, productsFound: results.length },
      });

      if (results.length > 0) {
        return results.map((r) => ({
          product: r.product,
          variants: r.variants,
        }));
      }
    }
    return undefined;
  }

  // ─── Memory update based on action ─────────────────────────────

  private updateMemoryFromAction(
    classification: ClassificationResult,
    memory: AssistantMemory,
  ): void {
    switch (classification.recommendedAction) {
      case 'recommend':
        memory.lastAction = 'gave_recommendation';
        memory.awaitingField = 'product_choice';
        break;
      case 'confirm_selection':
        memory.lastAction = 'confirmed_product';
        memory.awaitingField = 'order_confirmation';
        break;
      case 'ask_delivery':
      case 'start_checkout':
        memory.lastAction = 'asked_delivery_details';
        memory.awaitingField = 'delivery_info';
        break;
      case 'greet':
        memory.lastAction = 'greeted';
        memory.awaitingField = 'product_inquiry';
        break;
      case 'show_products':
        memory.lastAction = 'presented_product_options';
        memory.awaitingField = 'product_choice_or_recommendation_request';
        break;
      case 'show_price':
        memory.lastAction = 'showed_price';
        memory.awaitingField = 'order_decision';
        break;
    }
  }

  // ─── Get current stage from state ──────────────────────────────

  private getCurrentStage(state: ConversationState): string {
    const statusStageMap: Record<string, string> = {
      [ConversationStateStatus.Browsing]: 'need_discovery',
      [ConversationStateStatus.StockConfirmed]: 'showing_options',
      [ConversationStateStatus.CollectingCustomerInfo]:
        'collecting_customer_info',
    };
    return statusStageMap[state.stateStatus] ?? 'greeting';
  }

  // ─── AI fallback reply generation ──────────────────────────────

  private async aiFallbackReply(params: {
    brandTone: string;
    examples: ManagerExample[];
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    language: string;
    productData?: ProductSearchResult[];
    classification: ClassificationResult;
  }): Promise<string> {
    const lang = params.language ?? 'uk';
    const langMap: Record<string, string> = { uk: 'Ukrainian', en: 'English' };
    const langName = langMap[lang] ?? lang;

    const productContext = params.productData
      ? this.buildProductContext(params.productData)
      : '';

    const memoryContext = this.buildMemoryContext(params.memory);

    const systemPrompt = [
      `You are a sales manager for an online store. Reply ONLY in ${langName}.`,
      params.brandTone ? `\nTone:\n${params.brandTone}` : '',
      productContext ? `\nProduct data from database:\n${productContext}` : '',
      params.categories.length
        ? `\nAvailable categories: ${params.categories.join(', ')}.`
        : '',
      memoryContext ? `\n${memoryContext}` : '',
      `\nCONVERSATION RULES:`,
      `1. NEVER repeat what you already said. Don't re-list products, don't re-describe, don't re-greet.`,
      `2. SHORT REPLIES = interpreted in context of your LAST action.`,
      `3. If you showed options and user asks for recommendation -> recommend with a reason. Don't re-ask.`,
      `4. When presenting products: ALWAYS include the price. Be conversational, not tabular.`,
      `5. NEVER say "contact manager", "зараз перевірю ціну", or reveal you are AI.`,
      `6. If product not found, say you'll check and follow up.`,
      `7. Lead the conversation forward.`,
      `8. NEVER greet mid-conversation.`,
      `9. Keep replies SHORT (1-3 sentences max).`,
      `\nClassification context:`,
      `Intent: ${params.classification.primaryIntent}`,
      `Stage: ${params.classification.conversationStage}`,
      `Action: ${params.classification.recommendedAction}`,
      `\nGenerate a natural, helpful reply. Keep it concise.`,
    ]
      .filter(Boolean)
      .join('\n');

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

    messages.push({ role: 'user', content: params.messageText });

    const completion = await (this.openai.chat.completions.create as any)({
      model: this.model,
      messages,
      max_completion_tokens: 300,
      temperature: 0.3,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error('Empty AI fallback response');
    }
    return reply;
  }

  // ─── Helper: build product context string ──────────────────────

  private buildProductContext(productData: ProductSearchResult[]): string {
    const parts: string[] = [];
    for (const p of productData) {
      const variantDescs = p.variants.map((v) => {
        const details = [v.size, v.color].filter(Boolean).join(', ');
        const stock =
          v.effectiveAvailable > 0 ? 'в наявності' : 'немає';
        return `${details || 'standard'}: ${v.price} ${v.currency} (${stock})`;
      });
      parts.push(`- ${p.product.title}: ${variantDescs.join('; ')}`);
    }
    return `Products found:\n${parts.join('\n')}`;
  }

  // ─── Helper: build memory context string ───────────────────────

  private buildMemoryContext(memory: AssistantMemory): string {
    if (!memory.lastAction) return '';

    const parts = [
      `\nASSISTANT MEMORY (what happened before):`,
      `Last action: ${memory.lastAction}`,
    ];

    if (memory.lastPresentedProducts?.length) {
      parts.push(`Products shown to customer:`);
      for (const p of memory.lastPresentedProducts) {
        const variants = p.variants.join(', ');
        parts.push(
          `  - ${p.title} — Price: ${p.price} — Variants: ${variants}`,
        );
      }
    }

    if (memory.orderItems?.length) {
      parts.push(`Current order items: ${memory.orderItems.join(', ')}`);
    }

    if (memory.awaitingField) {
      parts.push(`Currently waiting for: ${memory.awaitingField}`);
    }
    if (memory.selectedCategory) {
      parts.push(`Selected category: ${memory.selectedCategory}`);
    }

    return parts.join('\n');
  }

  // ─── Handoff helper ────────────────────────────────────────────

  private async doHandoff(
    input: ReplyEngineInput,
    reason: string,
  ): Promise<ReplyEngineOutput> {
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
