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

    // 2.5. Short reply resolver: override low-confidence classification using memory context
    this.resolveShortReply(classification, memory, input.messageText);

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
        slotAction: classification.slotAction,
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
    let isFirstProductPresentation = false;
    const needsSearch = this.shouldSearchProducts(classification, memory);

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

      // Product not found → try product_not_found template, then handoff
      if ((!productData || productData.length === 0) &&
          ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse'].includes(classification.primaryIntent)) {
        this.logger.log('Product not found — using product_not_found template + handoff');
        classification.recommendedAction = 'product_not_found';

        // Try to use product_not_found template for a soft message
        const pnfResult = await this.templateEngine.render({
          tenantId: input.tenantId,
          classification,
          memory,
          recentTemplateIds: memory.recentTemplateIds ?? [],
          messageText: input.messageText,
        });

        const softMessage = pnfResult?.text ?? 'Секунду, уточню наявність 💛';
        return this.doHandoff(input, 'product_not_found', softMessage);
      }

      if (productData && productData.length > 0) {
        // Check if this is the first time showing products in this conversation
        isFirstProductPresentation = !memory.lastPresentedProducts?.length;

        // Update memory with presented products BEFORE template selection
        memory.lastPresentedProducts = productData.map((p) => ({
          title: p.product.title,
          variants: [...new Set(p.variants.map((v) =>
            [...new Set([v.size, v.color].filter(Boolean))].join(', ') || 'standard',
          ))],
          price: [
            ...new Set(p.variants.map((v) => `${v.price} ${v.currency}`)),
          ].join(' / '),
        }));
        memory.selectedCategory =
          classification.entities.category ?? searchKeywords[0];

        // Store available variant names for classifier context
        if (productData.length === 1) {
          memory.availableVariants = productData[0].variants
            .filter((v) => v.effectiveAvailable > 0)
            .map((v) => [v.color, v.size].filter(Boolean).join(', '))
            .filter(Boolean)
            .join(', ');

          // Single product match — set product ID in memory
          memory.selectedProductId = productData[0].product.id;
          memory.selectedProductTitle = productData[0].product.title;
        }

        // Selection state management
        if (isFirstProductPresentation) {
          memory.selectionState = 'awaiting_product';
        }
      }
    }

    // 5.5a Full selection confirmed: product + variant both set + user confirms → proceed to checkout
    this.logger.log(`5.5a check: slotAction=${classification.slotAction} selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId}`);
    if (
      classification.slotAction === 'confirmation' &&
      memory.selectionState === 'awaiting_confirmation' &&
      memory.selectedProductId &&
      memory.selectedVariantId
    ) {
      memory.selectionState = 'confirmed';
      classification.primaryIntent = 'ready_to_order';
      classification.recommendedAction = 'start_checkout';
      classification.conversationStage = 'checkout_started';
      this.logger.log('5.5a FIRED: Selection fully confirmed, proceeding to checkout');
      this.logToFile({
        event: 'selection_confirmed',
        conversationId: input.conversationId,
        selectionState: memory.selectionState,
        selectedProductId: memory.selectedProductId,
        selectedVariantId: memory.selectedVariantId,
        action: 'start_checkout',
      });
    }

    // 5.5b Variant check: after recommendation + confirmation, check if variant selection needed
    if (
      classification.slotAction === 'confirmation' &&
      memory.selectionState === 'awaiting_confirmation' &&
      memory.selectedProductId &&
      !memory.selectedVariantId
    ) {
      const rawVariants = memory.availableVariants;
      const variants = Array.isArray(rawVariants) ? rawVariants : [];
      const userColor = classification.entities.color;
      const userSize = classification.entities.size;

      if (variants.length === 1) {
        // Single variant → auto-select, proceed to confirm
        memory.selectedVariantId = variants[0].id;
        memory.selectedVariantName = variants[0].name;
        memory.selectionState = 'awaiting_confirmation';
        classification.recommendedAction = 'confirm_selection';
        this.logger.log('Single variant → auto-selected, proceeding to confirm_selection');
      } else if (variants.length > 1 && (userColor || userSize)) {
        // User specified a variant — try to match
        const matched = this.matchVariant(variants, userColor, userSize);
        if (matched) {
          memory.selectedVariantId = matched.id;
          memory.selectedVariantName = matched.name;
          memory.selectionState = 'awaiting_confirmation';
          classification.recommendedAction = 'confirm_selection';
          this.logger.log(`Variant matched: ${matched.name}`);
        } else {
          // No confident match → ask for variant
          memory.selectionState = 'awaiting_variant';
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log('Variant not matched confidently, asking user');
        }
      } else if (variants.length > 1) {
        // Multiple variants, user didn't specify → ask
        memory.selectionState = 'awaiting_variant';
        classification.primaryIntent = 'ask_variant_choice';
        classification.recommendedAction = 'ask_variant_choice';
        this.logger.log(`Multiple variants (${variants.length}), asking user to choose`);
      }
    }

    // 5.5c Variant check for fills_missing_slot: user picked a product, check if variant needed
    if (
      classification.slotAction === 'fills_missing_slot' &&
      memory.selectedProductId &&
      !memory.selectedVariantId &&
      productData && productData.length === 1
    ) {
      const variants = productData[0].variants.filter(v => v.effectiveAvailable > 0);
      if (variants.length > 1) {
        const userColor = classification.entities.color;
        const userSize = classification.entities.size;
        if (userColor || userSize) {
          const matched = this.matchVariant(
            variants.map(v => ({ id: v.id, name: [...new Set([v.color, v.size].filter(Boolean))].join(', '), color: v.color, size: v.size })),
            userColor, userSize,
          );
          if (matched) {
            memory.selectedVariantId = matched.id;
            memory.selectedVariantName = matched.name;
            memory.selectionState = 'awaiting_confirmation';
            classification.recommendedAction = 'confirm_selection';
          } else {
            memory.selectionState = 'awaiting_variant';
            classification.primaryIntent = 'ask_variant_choice';
            classification.recommendedAction = 'ask_variant_choice';
          }
        } else {
          memory.selectionState = 'awaiting_variant';
          memory.availableVariants = variants.map(v => ({
            id: v.id,
            name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
            color: v.color,
            size: v.size,
          }));
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log(`5.5c: Product selected, ${variants.length} variants — asking user`);
        }
      } else if (variants.length === 1) {
        memory.selectedVariantId = variants[0].id;
        memory.selectedVariantName = [...new Set([variants[0].color, variants[0].size].filter(Boolean))].join(', ') || 'standard';
        memory.selectionState = 'awaiting_confirmation';
        classification.recommendedAction = 'confirm_selection';
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
      isFirstProductPresentation,
      messageText: input.messageText,
    });

    let finalReply: string;
    let usedTemplateId: string | undefined;
    let actualAction: string; // What ACTUALLY happened (not what classifier wanted)

    if (templateResult) {
      // 7. Template found -> use it
      finalReply = templateResult.text;
      usedTemplateId = templateResult.templateId;
      // Use the template's actual scenario for memory tracking (may differ from classifier due to stage gates)
      actualAction = this.scenarioToAction(templateResult.scenario);

      // Log if stage gate overrode the classifier's recommendation
      const classifierAction = classification.recommendedAction;
      if (actualAction !== classifierAction) {
        const reason = !memory.selectedProductId ? 'checkout_blocked_no_product'
          : !memory.selectedVariantId ? 'missing_variant_selection'
          : memory.selectionState !== 'confirmed' ? 'selection_not_confirmed'
          : (classification as any).slotAction === 'correction' ? 'correction_received'
          : 'stage_gate_override';
        this.logToFile({
          event: 'flow_override',
          conversationId: input.conversationId,
          reason,
          classifierSaid: classifierAction,
          engineDid: actualAction,
          selectionState: memory.selectionState,
        });
      }

      // Track for anti-repetition
      memory.recentTemplateIds = [
        templateResult.templateId,
        ...recentTemplateIds,
      ].slice(0, 10);

      this.logger.log(`Template selected: ${templateResult.templateId}`);
    } else {
      // 8. No template -> check if AI fallback is allowed
      // Check if product-related intent but no products found → handoff
      const productIntents = ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse', 'ask_price'];
      if (productIntents.includes(classification.primaryIntent) && (!productData || productData.length === 0)) {
        this.logger.log('No template + no products found for product intent → handoff');
        return this.doHandoff(input, 'product_not_found', 'Секунду, уточню наявність 💛');
      }

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
          actualAction = 'ai_fallback_clarification';
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

    // Map what actually happened to conversation state
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

    // Update memory based on what ACTUALLY happened, not classifier's recommendation
    this.updateMemoryFromAction(actualAction, memory, templateResult, classification, productData);

    // Update selected variant ID from template variable matching
    if (templateResult?.matchedVariantId) {
      memory.selectedVariantId = templateResult.matchedVariantId;
      memory.selectedVariantName = classification.entities.color ?? classification.entities.size ?? memory.selectedVariantName;
    }

    // Set product IDs if product search found results — sync to BOTH state and memory
    if (productData && productData.length > 0) {
      const first = productData[0];
      stateUpdate.selectedProductId = first.product.id;
      memory.selectedProductId = first.product.id;
      memory.selectedProductTitle = memory.selectedProductTitle || first.product.title;
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
      templateScenario: templateResult?.scenario ?? 'ai_fallback',
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

  // ─── Scenario to action mapping ────────────────────────────────

  private scenarioToAction(scenario: string): string {
    const map: Record<string, string> = {
      greeting: 'greet',
      show_products: 'show_products',
      show_price: 'show_price',
      recommend_product: 'recommend',
      ask_recommendation_from_shown: 'recommend',
      confirm_selection: 'confirm_selection',
      collect_checkout_info: 'start_checkout',
      order_confirmed_ask_delivery: 'ask_delivery',
      confirm_order: 'confirm_order',
      answer_delivery: 'answer_faq',
      answer_payment: 'answer_faq',
      out_of_stock: 'show_products',
      ask_variant_choice: 'ask_variant_choice',
      product_not_found: 'ai_fallback_clarification',
    };
    return map[scenario] ?? scenario;
  }

  // ─── Short reply resolver ─────────────────────────────────────

  /**
   * Minimal safety net for truly ambiguous single-word messages.
   * The enriched classifier + slotAction should handle most cases now.
   * This only patches cases where the classifier can't determine meaning.
   */
  private resolveShortReply(
    classification: ClassificationResult,
    memory: AssistantMemory,
    messageText: string,
  ): void {
    const text = messageText.trim().toLowerCase();

    // Only intervene on very short messages with low confidence
    if (text.length > 8 || classification.confidence >= 0.8) return;

    const isConfirmation = /^(так|да|ок|добре|беру|го|давайте|звісно)$/i.test(text);
    const isRejection = /^(ні|нет|не)$/i.test(text);

    if (isConfirmation) {
      (classification as any).slotAction = 'confirmation';
      classification.confidence = 0.95;
      this.logger.log(`Short reply safety net: "${text}" → confirmation`);
    } else if (isRejection) {
      (classification as any).slotAction = 'rejection';
      classification.confidence = 0.95;
      this.logger.log(`Short reply safety net: "${text}" → rejection`);
    }
  }

  // ─── Product search helpers ────────────────────────────────────

  private matchVariant(
    variants: Array<{ id: string; name: string; color?: string | null; size?: string | null }>,
    userColor?: string,
    userSize?: string,
  ): { id: string; name: string } | null {
    const normalize = (s: string) => s.toLowerCase().replace(/[ʼ'ь]/g, '').trim();

    for (const v of variants) {
      // Exact match on color or size
      if (userColor && v.color && normalize(v.color) === normalize(userColor)) return v;
      if (userColor && v.size && normalize(v.size) === normalize(userColor)) return v;
      if (userSize && v.size && normalize(v.size) === normalize(userSize)) return v;
      if (userSize && v.color && normalize(v.color) === normalize(userSize)) return v;
    }

    // Partial/contains match
    for (const v of variants) {
      const val = normalize(v.color || v.size || v.name);
      if (userColor && val.includes(normalize(userColor))) return v;
      if (userColor && normalize(userColor).includes(val)) return v;
      if (userSize && val.includes(normalize(userSize))) return v;
    }

    // Word overlap
    for (const v of variants) {
      const val = normalize(v.color || v.size || v.name);
      const userWords = normalize(userColor || userSize || '').split(/\s+/);
      for (const w of userWords) {
        if (w.length > 2 && val.includes(w)) return v;
      }
    }

    return null; // No confident match — ask user
  }

  private shouldSearchProducts(classification: ClassificationResult, memory: AssistantMemory): boolean {
    const searchActions = [
      'show_products',
      'recommend',
      'show_price',
      'confirm_selection',
      'start_checkout',
    ];
    const searchIntents = [
      'product_inquiry',
      'category_browse',
      'ask_price',
      'availability_check',
      'ask_recommendation',
      'ready_to_order',
      'confirm_choice',
    ];

    // Always search if user mentions a product/category and we haven't shown products yet
    const hasEntities = !!(classification.entities.category || classification.entities.productName || classification.entities.color);
    const noProductsShownYet = !memory.lastPresentedProducts?.length;

    return (
      searchActions.includes(classification.recommendedAction) ||
      searchIntents.includes(classification.primaryIntent) ||
      (hasEntities && noProductsShownYet)
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
    actualAction: string,
    memory: AssistantMemory,
    templateResult?: { text: string; templateId: string; scenario: string } | null,
    classification?: any,
    productData?: any[],
  ): void {
    switch (actualAction) {
      case 'recommend':
        memory.lastAction = 'gave_recommendation';
        memory.awaitingField = 'product_choice';
        memory.selectionState = 'awaiting_confirmation';
        // Store the recommended product in memory
        if (productData && productData.length > 0) {
          const recommended = productData[0];
          memory.selectedProductId = recommended.product.id;
          memory.selectedProductTitle = recommended.product.title;
          memory.availableVariants = recommended.variants.map((v: any) => ({
            id: v.id,
            name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
            color: v.color,
            size: v.size,
          }));
        }
        break;
      case 'confirm_selection':
        memory.lastAction = 'confirmed_product';
        memory.awaitingField = 'order_confirmation';
        memory.selectionState = 'awaiting_confirmation';
        // Store selected product/variant from template variables
        if (templateResult && classification) {
          memory.selectedProductTitle = classification.entities?.productName ?? memory.selectedProductTitle;
          memory.selectedVariantName = classification.entities?.color ?? classification.entities?.size ?? memory.selectedVariantName;
        }
        break;
      case 'ask_delivery':
      case 'start_checkout':
        memory.lastAction = 'asked_delivery_details';
        memory.awaitingField = 'delivery_info';
        memory.selectionState = 'confirmed';
        break;
      case 'greet':
        memory.lastAction = 'greeted';
        memory.awaitingField = 'product_inquiry';
        memory.selectionState = undefined;
        break;
      case 'show_products':
        memory.lastAction = 'presented_product_options';
        memory.awaitingField = 'product_choice_or_recommendation_request';
        memory.selectionState = 'awaiting_product';
        break;
      case 'show_price':
        memory.lastAction = 'showed_price';
        memory.awaitingField = 'order_decision';
        break;
      case 'ai_fallback_clarification':
        memory.lastAction = 'asked_clarification';
        memory.awaitingField = 'clarification';
        break;
      case 'ask_variant_choice':
        memory.lastAction = 'asked_variant';
        memory.awaitingField = 'variant_selection';
        memory.selectionState = 'awaiting_variant';
        break;
      case 'answer_faq':
        memory.lastAction = 'answered_faq';
        break;
      case 'confirm_order':
        memory.lastAction = 'confirmed_order';
        memory.awaitingField = 'order_finalized';
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
    softMessage?: string,
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
      softMessage,
    });
    return {
      decision: ReplyDecision.Handoff,
      reply: softMessage ? { text: softMessage, sendNow: true } : null,
      handoff: { required: true, reason },
      stateUpdate: null,
    };
  }
}
