import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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
import { PolicyEngineService, PolicyEvaluation } from '../engine/policy-engine.service';
import { formatCurrency } from '../../common/format';
import {
  AuditLogType,
  ConversationStateStatus,
  MessageRole,
  ReplyDecision,
} from '@direct-mate/shared';
import { OrderPayload } from '../orders/interfaces/order-payload.interface';
import { InstagramContentService } from '../channels/instagram/instagram-content.service';
import { SizeChartsService } from '../size-charts/size-charts.service';

// ─── Public interfaces ───────────────────────────────────────────

export interface ReplyEngineInput {
  tenantId: string;
  conversationId: string;
  messageText: string;
  state: ConversationState;
  recentMessages: Array<{ role: string; text: string | null }>;
  mediaReference?: { mediaId: string; type: string };
}

export interface ReplyEngineOutput {
  decision: ReplyDecision;
  reply: { text: string; sendNow: boolean; imageUrls?: string[] } | null;
  /**
   * Optional follow-up replies appended after the primary reply. Currently
   * consumed by the demo channel (renders sequentially in the widget).
   * Production Instagram path ignores; track tech debt to iterate on prod.
   */
  extraReplies?: Array<{ text: string; sendNow: boolean; imageUrls?: string[] }>;
  handoff: { required: boolean; reason: string | null };
  stateUpdate: Partial<ConversationState> | null;
  orderPayload?: OrderPayload;
  // Populated in learning mode — what the engine would have done
  classification?: ClassificationResult;
  templateScenario?: string;
  /** Debug trace — populated during process(), useful for simulator diagnostics */
  trace?: string[];
}

// ─── Internal processing context ─────────────────────────────────

interface ProcessingContext {
  memory: AssistantMemory;
  classification: ClassificationResult;
  policy: PolicyEvaluation;
  settings: TenantSettings | null;
  storeConfig: StoreConfig | null;
  effectiveConfig: StoreConfig;
  examples: ManagerExample[];
  categories: string[];
  productData: ProductSearchResult[] | undefined;
  mediaProductData: ProductSearchResult[] | undefined;
  isFirstProductPresentation: boolean;
  flowConfig: Record<string, unknown> | undefined;
  trace: string[];
}

const LOG_FILE = path.join(process.cwd(), 'conversations.log');

// ─── Service ─────────────────────────────────────────────────────

const RECOMMENDED_SIZE_PREFIX = (size: string) =>
  `За вашими параметрами рекомендую розмір ${size} 💛`;

const ASK_FOR_MEASUREMENTS_HELP =
  'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛';

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
    private readonly instagramContentService: InstagramContentService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
    private readonly sizeChartsService: SizeChartsService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('openai.apiKey'),
    });
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o';
  }

  // ─── Main entry point ──────────────────────────────────────────

  async process(input: ReplyEngineInput): Promise<ReplyEngineOutput> {
    const ctx = await this.loadContext(input);
    const withTrace = (r: ReplyEngineOutput) => { r.trace = ctx.trace; return r; };

    // 1.5. Subscription gate: soft-block if trial expired or plan inactive
    const planActive = await this.subscriptionsService.isActive(input.tenantId);
    if (!planActive) {
      ctx.trace.push('subscription: inactive → soft block');
      return withTrace({
        decision: ReplyDecision.Reply,
        reply: { text: null as any, sendNow: false },
        handoff: { required: true, reason: 'subscription_expired' },
        stateUpdate: {},
      });
    }

    // Pre-check: max failed turns
    const maxFailedTurns = ctx.settings?.handoffRules?.maxFailedTurns ?? 5;
    if ((ctx.memory.failedTurns ?? 0) >= maxFailedTurns) {
      ctx.trace.push('pre-check: max_failed_turns exceeded');
      return withTrace(await this.doHandoff(input, 'max_failed_turns'));
    }

    const classifyResult = await this.classifyMessage(input, ctx);
    if (classifyResult) return withTrace(classifyResult);

    const mediaResult = await this.resolveMediaProduct(input, ctx);
    if (mediaResult) return withTrace(mediaResult);

    const sizeChartResult = await this.handleSizeChartRequest(input, ctx);
    if (sizeChartResult) return withTrace(sizeChartResult);

    const preQualifyResult = await this.handlePreQualify(input, ctx);
    if (preQualifyResult) return withTrace(preQualifyResult);

    const searchResult = await this.searchAndFilterProducts(input, ctx);
    if (searchResult) return withTrace(searchResult);

    this.resolveVariantSelection(input, ctx);

    const result = await this.buildResponse(input, ctx);

    // Conversation-start greeting: fire ONCE per conversation, before the
    // contextual reply. Skip if classifier resolved greeting intent (the
    // existing `greeting` scenario covers that flow on its own — avoid
    // double "Вітаю"). Template-driven opt-in: tenants without an active
    // `conversation_start_greeting` template render null here and nothing
    // happens.
    if (
      !ctx.memory.welcomedAt &&
      ctx.classification?.primaryIntent !== 'greeting' &&
      result.reply?.text
    ) {
      const greeting = await this.templateEngine.renderCustomScenario(
        input.tenantId,
        'conversation_start_greeting',
        {},
      );
      if (greeting) {
        ctx.trace.push('first-turn welcome prepended');
        ctx.memory.welcomedAt = new Date().toISOString();
        result.stateUpdate = {
          ...result.stateUpdate,
          contextJson: { ...ctx.memory },
        };
        const contextualReply = result.reply;
        result.reply = { text: greeting.text, sendNow: true };
        result.extraReplies = [
          {
            text: contextualReply.text!,
            sendNow: true,
            imageUrls: contextualReply.imageUrls,
          },
          ...(result.extraReplies ?? []),
        ];
      }
    }

    return withTrace(result);
  }

  // ─── Step 1: Load tenant context ───────────────────────────────

  private async loadContext(
    input: ReplyEngineInput,
  ): Promise<ProcessingContext> {
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

    // Use a default store config if none exists
    const effectiveConfig = storeConfig ??
      ({
        escalationConfig: {},
        fallbackConfig: {
          mode: 'template_first_with_safe_fallback',
        },
        brandConfig: {},
      } as unknown as StoreConfig);

    const flowConfig = effectiveConfig?.flowConfig as
      | Record<string, unknown>
      | undefined;

    return {
      memory,
      classification: undefined as unknown as ClassificationResult,
      policy: undefined as unknown as PolicyEvaluation,
      settings,
      storeConfig,
      effectiveConfig,
      examples,
      categories,
      productData: undefined,
      mediaProductData: undefined,
      isFirstProductPresentation: false,
      flowConfig,
      trace: [],
    };
  }

  // ─── Step 2: Classify + policy + post-order + adds_to_cart ─────

  private async classifyMessage(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    const { memory, settings, effectiveConfig, categories } = ctx;
    const maxFailedTurns = settings?.handoffRules?.maxFailedTurns ?? 5;
    const tenantBusinessType: 'clothing' | 'cosmetics' =
      ((effectiveConfig?.flowConfig as any)?.businessType as 'clothing' | 'cosmetics') ?? 'clothing';

    // 2. AI Classifier: classify intent + extract entities (NO reply text)
    let classification: ClassificationResult;
    try {
      classification = await this.classifierService.classify({
        messageText: input.messageText,
        recentMessages: input.recentMessages,
        memory,
        categories,
        currentStage: this.getCurrentStage(input.state),
        tenantBusinessType,
      });
    } catch (err) {
      this.logger.error('AI classification failed', err);
      ctx.trace.push('classify: ai_failure → handoff');
      return this.doHandoff(input, 'ai_failure');
    }

    // 2.5. Short reply resolver: override low-confidence classification using memory context
    this.resolveShortReply(classification, memory, input.messageText);

    ctx.trace.push(`classify: intent=${classification.primaryIntent} action=${classification.recommendedAction} slot=${classification.slotAction} conf=${classification.confidence}`);

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
    ctx.policy = policy;

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
              tenantBusinessType,
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
            ctx.trace.push(`classify: fallback model overrode escalation → continue`);
            classification = secondOpinion;
            // Continue processing instead of escalating
          } else {
            ctx.trace.push(`classify: policy escalation confirmed by fallback → handoff (${policy.reason ?? 'policy_escalation'})`);
            return this.doHandoff(input, policy.reason ?? 'policy_escalation');
          }
        } catch {
          this.logger.warn('Fallback verification failed');
          ctx.trace.push(`classify: fallback verification failed → handoff (${policy.reason ?? 'policy_escalation'})`);
          return this.doHandoff(input, policy.reason ?? 'policy_escalation');
        }
      } else {
        ctx.trace.push(`classify: policy escalation, no fallback model → handoff (${policy.reason ?? 'policy_escalation'})`);
        return this.doHandoff(input, policy.reason ?? 'policy_escalation');
      }
    }

    // 4.4. Greeting reset: fresh start when customer greets with stale selection state
    // Guard: only reset if greeting is pure (no product/category entities — "Привіт, є куртки?" should keep entities)
    if (
      classification.primaryIntent === 'greeting' &&
      memory.selectionState &&
      !memory.orderCreated &&
      !classification.entities.category &&
      !classification.entities.productName
    ) {
      ctx.trace.push('classify: greeting with stale state → reset');
      memory.selectedProductId = undefined;
      memory.selectedProductTitle = undefined;
      memory.selectedVariantId = undefined;
      memory.selectedVariantName = undefined;
      memory.selectionState = undefined;
      memory.lastPresentedProducts = undefined;
      memory.availableVariants = undefined;
      memory.lastAction = undefined;
      memory.awaitingField = undefined;
      memory.cartItems = undefined;
      memory.variantStep = null;
      memory.selectedColor = undefined;
      memory.selectedSize = undefined;
      memory.preQualifyCollected = undefined;
      memory.preQualifyData = undefined;
      memory.recommendedSize = undefined;
      memory.skinTypeCollected = undefined;
      memory.recommendedSkinType = undefined;
      memory.shouldOfferSizeHelp = undefined;
      memory.awaitingPreQualifyAnswer = undefined;
    }

    // 4.5. Post-order state management
    const POST_ORDER_PASSIVE_INTENTS = ['gratitude', 'thanks', 'small_talk', 'confirmation', 'goodbye'];

    if (memory.orderCreated) {
      if (POST_ORDER_PASSIVE_INTENTS.includes(classification.primaryIntent)) {
        // Passive message after order → acknowledge without resetting state
        ctx.trace.push(`classify: post-order passive intent=${classification.primaryIntent} → ack reply`);
        this.logger.log('Post-order passive intent: ' + classification.primaryIntent);
        const ackReply = 'Будь ласка 💛 Якщо захочете ще щось — пишіть!';
        const stateUpdate: Partial<ConversationState> = {};
        stateUpdate.contextJson = memory as any;
        ctx.classification = classification;
        return {
          decision: ReplyDecision.Reply,
          reply: { text: ackReply, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate,
        };
      }

      // Any non-passive intent after order completion = user is moving on to
      // something new. Reset selection state so the fresh inquiry starts clean.
      if (!POST_ORDER_PASSIVE_INTENTS.includes(classification.primaryIntent)) {
        // New inquiry after completed order → reset ALL state including cart
        ctx.trace.push(`classify: post-order state reset (slotAction=${classification.slotAction} intent=${classification.primaryIntent})`);
        memory.selectedProductId = undefined;
        memory.selectedProductTitle = undefined;
        memory.selectedVariantId = undefined;
        memory.selectedVariantName = undefined;
        memory.selectionState = undefined;
        memory.lastPresentedProducts = undefined;
        memory.availableVariants = undefined;
        memory.lastAction = undefined;
        memory.awaitingField = undefined;
        memory.orderCreated = undefined;
        memory.cartItems = undefined;
        memory.variantStep = null;
        memory.selectedColor = undefined;
        memory.selectedSize = undefined;
        memory.preQualifyCollected = undefined;
        memory.preQualifyData = undefined;
        memory.recommendedSize = undefined;
        memory.skinTypeCollected = undefined;
        memory.recommendedSkinType = undefined;
        memory.shouldOfferSizeHelp = undefined;
        memory.awaitingPreQualifyAnswer = undefined;
        this.logger.log('State reset: new inquiry after completed order');
      }
    }

    // 4.6 Handle adds_to_cart: customer wants to add another product to cart
    if (classification.slotAction === 'adds_to_cart' && !memory.orderCreated) {
      const sameProduct = memory.selectedProductTitle &&
        (!classification.entities.productName ||
         memory.selectedProductTitle.toLowerCase().includes(classification.entities.productName.toLowerCase()) ||
         classification.entities.productName.toLowerCase().includes(memory.selectedProductTitle.toLowerCase()));

      // If the pending variant was already confirmed ("так" → awaiting_confirmation)
      // and the user is pivoting to another variant/product ("і ще Rosewood" / "і ще Color Veil"),
      // commit the pending one to the cart before clearing. Applies to both same-product
      // and different-product branches — otherwise the earlier selection is lost.
      // Idempotent via the alreadyInCart guard.
      if (
        memory.selectionState === 'awaiting_confirmation' &&
        memory.selectedProductId &&
        memory.selectedVariantId &&
        memory.selectedVariantName
      ) {
        if (!memory.cartItems) memory.cartItems = [];
        const alreadyInCart = memory.cartItems.some(
          (it) =>
            it.productId === memory.selectedProductId &&
            it.variantId === memory.selectedVariantId,
        );
        if (!alreadyInCart) {
          let itemPrice = 0;
          let itemCurrency = 'UAH';
          const memVar = Array.isArray(memory.availableVariants)
            ? (memory.availableVariants as any[]).find(
                (v) => v.id === memory.selectedVariantId,
              )
            : null;
          if (memVar?.price) {
            itemPrice = memVar.price;
            itemCurrency = memVar.currency ?? 'UAH';
          }
          memory.cartItems.push({
            productId: memory.selectedProductId,
            variantId: memory.selectedVariantId,
            externalProductId: null,
            externalVariantId: null,
            title: memory.selectedProductTitle ?? '',
            variantName: memory.selectedVariantName,
            price: itemPrice,
            currency: itemCurrency,
          });
          ctx.trace.push(
            `4.6: committed pending ${memory.selectedVariantName} before switching (cart=${memory.cartItems.length})`,
          );
        }
      }

      if (sameProduct) {
        // Same product, different variant — keep product-level state, clear variant only
        memory.selectedVariantId = undefined;
        memory.selectedVariantName = undefined;
        memory.selectionState = 'awaiting_product';
        memory.variantStep = null;
        memory.selectedColor = undefined;
        memory.selectedSize = undefined;
        ctx.trace.push(`4.6: adds_to_cart same product (${memory.selectedProductTitle}), cleared variant only, selectionState=awaiting_product`);
        this.logger.log('adds_to_cart: same product, clearing variant for new selection');
      } else {
        // New product entirely — clear everything
        memory.selectedProductId = undefined;
        memory.selectedProductTitle = undefined;
        memory.selectedVariantId = undefined;
        memory.selectedVariantName = undefined;
        memory.selectionState = undefined;
        memory.availableVariants = undefined;
        memory.variantStep = null;
        memory.selectedColor = undefined;
        memory.selectedSize = undefined;
        ctx.trace.push(`4.6: adds_to_cart new product, cleared all selection`);
        this.logger.log('adds_to_cart: clearing selection for new product, keeping cart');
      }
    }

    // 4.6b Cart correction: "хочу тільки X" / "ні, давайте тільки Y"
    if (
      classification.slotAction === 'correction' &&
      memory.cartItems?.length &&
      memory.selectionState === 'cart_item_added'
    ) {
      const wantedProduct = classification.entities.productName;
      const wantedColor = classification.entities.color;

      if (wantedProduct || wantedColor) {
        const before = memory.cartItems.length;

        // Filter cart to keep only matching item(s)
        memory.cartItems = memory.cartItems.filter(item => {
          if (wantedProduct && !item.title.toLowerCase().includes(wantedProduct.toLowerCase())) return false;
          if (wantedColor && !item.variantName.toLowerCase().includes(wantedColor.toLowerCase())) return false;
          return true;
        });

        // If filtered result is still ambiguous (>1 item), narrow by color
        if (memory.cartItems.length > 1 && wantedColor) {
          const narrower = memory.cartItems.filter(item =>
            item.variantName.toLowerCase().includes(wantedColor.toLowerCase()),
          );
          if (narrower.length > 0) memory.cartItems = narrower;
        }

        ctx.trace.push(`cart-correction: ${before} → ${memory.cartItems.length} items (kept matching "${wantedProduct ?? wantedColor}")`);

        if (memory.cartItems.length === 0) {
          // Nothing matched in cart — user wants a completely new product, clear and re-search
          ctx.trace.push('cart-correction: no match in cart → clear + fresh search');
          memory.selectedProductId = undefined;
          memory.selectedProductTitle = undefined;
          memory.selectedVariantId = undefined;
          memory.selectedVariantName = undefined;
          memory.selectionState = undefined;
          memory.lastAction = undefined;
          memory.awaitingField = undefined;
          memory.availableVariants = undefined;
          memory.variantStep = null;
          memory.selectedColor = undefined;
          memory.selectedSize = undefined;
        } else {
          // Cart filtered — confirm what's left
          memory.selectionState = 'cart_item_added';
          memory.lastAction = 'cart_corrected';
          classification.recommendedAction = 'ask_continue_or_checkout';
        }
      }
    }

    ctx.classification = classification;
    return null;
  }

  // ─── Step 3: Media reference resolution (block 4.7) ────────────

  private async resolveMediaProduct(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    if (!input.mediaReference) return null;

    if (input.mediaReference.type === 'customer_photo') {
      // Try to match customer screenshot to a linked product before handoff
      try {
        const match = await this.instagramContentService.matchCustomerPhoto(
          input.tenantId,
          input.mediaReference.mediaId,
        );
        if (match) {
          ctx.trace.push(`customer_photo: matched to product ${match.productId} (confidence=${match.confidence})`);
          // Always load the FULL variant set (not filtered by match.variantId)
          // so memory.totalVariantsForSelectedProduct reflects the catalog
          // truth — needed for the "last in stock" detection in 5.5d.
          // Variant pre-selection of match.variantId is handled by 5.5m's
          // auto-select / variant-match branches based on what's actually
          // in stock, which is what the customer can buy anyway.
          const mediaProductData = await this.availabilityService.findAllByProductId(
            match.productId,
          );
          ctx.mediaProductData = mediaProductData;
          this.logToFile({
            event: 'customer_photo_matched',
            conversationId: input.conversationId,
            productId: match.productId,
            confidence: match.confidence,
          });
          return null; // continue normal flow with resolved product
        }
      } catch (err) {
        this.logger.error('Customer photo matching failed, falling back to handoff', err);
      }

      ctx.trace.push('customer_photo: no product match → handoff');
      return this.doHandoff(input, 'customer_photo', 'Секунду, зараз перевірю 💛');
    }

    const mapping = await this.instagramContentService.findByMediaId(
      input.tenantId,
      input.mediaReference.mediaId,
    );

    if (mapping?.productId) {
      // Known product — load full product data for use in product search step
      const mediaProductData = await this.availabilityService.findAllByProductId(
        mapping.productId,
        mapping.variantId ?? undefined,
      );
      ctx.mediaProductData = mediaProductData;
      this.logToFile({
        event: 'media_product_resolved',
        conversationId: input.conversationId,
        mediaId: input.mediaReference.mediaId,
        mediaType: input.mediaReference.type,
        productId: mapping.productId,
        variantId: mapping.variantId,
        productsFound: mediaProductData.length,
      });
    } else {
      this.instagramContentService
        .saveUnlinkedMedia(
          input.tenantId,
          input.mediaReference.mediaId,
          input.mediaReference.type,
        )
        .catch((err) => this.logger.error('Failed to save unlinked media', err));
      return this.doHandoff(
        input,
        'unlinked_media_reference',
        'Секунду, зараз перевірю 💛',
      );
    }

    return null;
  }

  // ─── Step 4: Pre-qualification gate (block 4.8) ────────────────

  private async handlePreQualify(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    const businessType =
      ((ctx.effectiveConfig?.flowConfig as any)?.businessType as 'clothing' | 'cosmetics') ?? 'clothing';
    if (businessType === 'cosmetics') {
      return this.handlePreQualifyCosmetics(input, ctx);
    }
    return this.handlePreQualifyClothing(input, ctx);
  }

  private async handlePreQualifyClothing(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    const { memory, effectiveConfig, mediaProductData } = ctx;
    const classification = ctx.classification;

    const preQualifyFlowConfig = effectiveConfig?.flowConfig as any;
    const strategy: 'before_search' | 'after_search_offered' =
      preQualifyFlowConfig?.preQualifyStrategy ?? 'after_search_offered';
    const awaitingPreQualify =
      memory.lastAction === 'asked_pre_qualify' &&
      memory.awaitingField === 'pre_qualify_data';

    // ─── Yes/no answer to a previous offer (after_search_offered T2) ───
    // Must run BEFORE the gate, because the user's "так" doesn't carry
    // product intent — the outer gate's shouldSearchProducts would say no.
    //
    // Defense-in-depth: if the operator just toggled preQualify.enabled
    // off while a conversation has memory.awaitingPreQualifyAnswer set
    // from a prior turn, drop that flag instead of asking height/weight.
    if (memory.awaitingPreQualifyAnswer && !preQualifyFlowConfig?.preQualify?.enabled) {
      ctx.trace.push('preQualify: disabled mid-conversation → dropping pending offer answer');
      memory.awaitingPreQualifyAnswer = false;
      memory.shouldOfferSizeHelp = false;
    }
    if (memory.awaitingPreQualifyAnswer) {
      const yesNo = this.classifyOfferAnswer(classification);
      if (yesNo === 'yes') {
        ctx.trace.push('preQualify: offer accepted → ask height/weight');
        memory.awaitingPreQualifyAnswer = false;
        memory.shouldOfferSizeHelp = false;
        const prompt =
          preQualifyFlowConfig.preQualify?.prompt ||
          'Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛';
        memory.lastAction = 'asked_pre_qualify';
        memory.awaitingField = 'pre_qualify_data';
        return {
          decision: ReplyDecision.Reply,
          reply: { text: prompt, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }
      if (yesNo === 'no') {
        ctx.trace.push('preQualify: offer declined → short ack');
        memory.awaitingPreQualifyAnswer = false;
        memory.shouldOfferSizeHelp = false;
        memory.lastAction = 'declined_offer';
        return {
          decision: ReplyDecision.Reply,
          reply: {
            text: 'Окей 💛 Як визначитесь — пишіть',
            sendNow: true,
          },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }
      // 'other' → user moved on (named a product / asked something else).
      // Clear the offer flags and fall through to normal flow.
      ctx.trace.push('preQualify: offer ignored (user moved on) → clear flags');
      memory.awaitingPreQualifyAnswer = false;
      memory.shouldOfferSizeHelp = false;
    }

    // ─── Mid-flow size-help branch ────────────────────────────────────
    // Catches "Я 180 см 80 кг, який розмір?" / "який розмір підібрати?"
    // mid-conversation (after product selection), which the pre-qualify
    // gate below blocks once selectionState=awaiting_variant or
    // entities.productName is set.
    const midFlow = await this.maybeMidFlowSizeHelp(input, ctx);
    if (midFlow) return midFlow;

    // ─── Pre-qualify gate ──────────────────────────────────────────
    if (
      preQualifyFlowConfig?.preQualify?.enabled &&
      !memory.preQualifyCollected &&
      !memory.orderCreated &&
      !mediaProductData &&
      !memory.cartItems?.length &&
      memory.selectionState !== 'cart_item_added' &&
      memory.selectionState !== 'awaiting_variant' &&
      memory.selectionState !== 'awaiting_confirmation' &&
      !classification.entities.size &&        // size already provided → skip
      !classification.entities.productName && // specific product → skip (NEW short-circuit)
      (awaitingPreQualify || this.shouldSearchProducts(classification, memory))
    ) {
      // Branch (a): user supplied pre-qualify data this turn
      if (
        awaitingPreQualify ||
        classification.primaryIntent === 'provide_details' ||
        this.looksLikePreQualifyData(input.messageText, preQualifyFlowConfig.preQualify.fields)
      ) {
        memory.preQualifyData = this.extractPreQualifyData(
          input.messageText,
          preQualifyFlowConfig.preQualify.fields,
        );
        memory.preQualifyCollected = true;
        ctx.trace.push(`preQualify: data collected ${JSON.stringify(memory.preQualifyData)}`);
        this.logger.log(`Pre-qualify data collected: ${JSON.stringify(memory.preQualifyData)}`);

        const sizeChart = preQualifyFlowConfig.sizeChart as
          | Record<string, { heightMin: number; heightMax: number; weightMin: number; weightMax: number }>
          | undefined;
        if (sizeChart && memory.preQualifyData) {
          const recommended = this.recommendSize(memory.preQualifyData, sizeChart);
          if (recommended) {
            memory.recommendedSize = recommended;
            this.logger.log(`Recommended size: ${recommended}`);
            memory.lastAction = 'recommended_size';
          }
        }
        if (!classification.entities.category && memory.selectedCategory) {
          classification.entities.category = memory.selectedCategory;
        }
        const hasSpecificChoice = !!(
          classification.entities.productName ||
          (classification.entities.color && classification.entities.size)
        );
        if (!hasSpecificChoice) {
          classification.primaryIntent = 'category_browse';
          classification.recommendedAction = 'show_products';
          // Also reset dialogueAct: classifier may have labelled "170 60" as
          // 'ask_recommendation', which template-engine routes to
          // ask_recommendation_from_shown (singular product). When no specific
          // choice, we want show_products (lists all matches) so user sees the
          // full set narrowed by their size.
          classification.dialogueAct = 'general_chat';
        }
        return null;
      }

      // Branch (b): no data yet. Strategy decides whether to ask now or offer later.
      if (strategy === 'before_search') {
        ctx.trace.push('preQualify: before_search → ask height/weight');
        if (classification.entities.category) {
          memory.selectedCategory = classification.entities.category;
        }
        const prompt =
          preQualifyFlowConfig.preQualify.prompt ||
          'Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛';
        memory.lastAction = 'asked_pre_qualify';
        memory.awaitingField = 'pre_qualify_data';
        return {
          decision: ReplyDecision.Reply,
          reply: { text: prompt, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }

      // strategy === 'after_search_offered': fall through to product search.
      // buildResponse will append the offer suffix after rendering products.
      ctx.trace.push('preQualify: after_search_offered → continue to search, will append offer');
      if (classification.entities.category) {
        memory.selectedCategory = classification.entities.category;
      }
    }

    return null;
  }

  /**
   * Detect whether a turn is a yes/no answer to the offer.
   *
   * 'yes'   — pure confirmation, no NEW product entities (e.g. "так", "давайте")
   * 'no'    — pure rejection (e.g. "ні", "не треба")
   * 'other' — user moved on (named a product/variant, asked something else,
   *           or otherwise signalled topic shift)
   *
   * `entities.category` is intentionally NOT in the moved-on check: the
   * classifier carries category forward as conversation context (e.g.
   * T1 "хочу футболку" → category='Футболки' persists into T2 "так"),
   * so its presence does not mean the user introduced new info.
   */
  private classifyOfferAnswer(
    classification: ClassificationResult,
  ): 'yes' | 'no' | 'other' {
    const hasProductEntities = !!(
      classification.entities.productName ||
      classification.entities.color ||
      classification.entities.size ||
      classification.entities.skinType
    );
    if (hasProductEntities) return 'other';
    if (classification.slotAction === 'confirmation') return 'yes';
    if (classification.slotAction === 'rejection') return 'no';
    return 'other';
  }

  private async handlePreQualifyCosmetics(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    const { memory, effectiveConfig, mediaProductData } = ctx;
    const classification = ctx.classification;

    const preQualifyFlowConfig = effectiveConfig?.flowConfig as any;
    const strategy: 'before_search' | 'after_search_offered' =
      preQualifyFlowConfig?.preQualifyStrategy ?? 'after_search_offered';
    const awaitingPreQualify =
      memory.lastAction === 'asked_pre_qualify' &&
      memory.awaitingField === 'pre_qualify_data';

    // Capture skin type whenever it's extracted, regardless of gate. This
    // means a user saying "хочу крем для жирної шкіри" sets recommendedSkinType
    // even if a productName short-circuit would otherwise skip the gate.
    if (classification.entities.skinType && !memory.skinTypeCollected) {
      memory.recommendedSkinType = classification.entities.skinType;
      memory.skinTypeCollected = true;
      memory.preQualifyData = { skinType: classification.entities.skinType };
      memory.preQualifyCollected = true;
      memory.lastAction = 'recommended_skin_type';
      ctx.trace.push(`preQualifyCosmetics: skinType=${classification.entities.skinType} captured`);
      if (!classification.entities.category && memory.selectedCategory) {
        classification.entities.category = memory.selectedCategory;
      }
      if (!classification.entities.productName) {
        classification.primaryIntent = 'category_browse';
        classification.recommendedAction = 'show_products';
      }
      return null;
    }

    // Yes/no answer to a previous offer — runs BEFORE the gate (mirror of clothing).
    // Defense-in-depth: if preQualify.enabled was just toggled off, drop the pending flag.
    if (memory.awaitingPreQualifyAnswer && !preQualifyFlowConfig?.preQualify?.enabled) {
      ctx.trace.push('preQualifyCosmetics: disabled mid-conversation → dropping pending offer answer');
      memory.awaitingPreQualifyAnswer = false;
      memory.shouldOfferSizeHelp = false;
    }
    if (memory.awaitingPreQualifyAnswer) {
      const yesNo = this.classifyOfferAnswer(classification);
      if (yesNo === 'yes') {
        ctx.trace.push('preQualifyCosmetics: offer accepted → ask skin type');
        memory.awaitingPreQualifyAnswer = false;
        memory.shouldOfferSizeHelp = false;
        const prompt =
          preQualifyFlowConfig.preQualify?.prompt ||
          'Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛';
        memory.lastAction = 'asked_pre_qualify';
        memory.awaitingField = 'pre_qualify_data';
        return {
          decision: ReplyDecision.Reply,
          reply: { text: prompt, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }
      if (yesNo === 'no') {
        ctx.trace.push('preQualifyCosmetics: offer declined → short ack');
        memory.awaitingPreQualifyAnswer = false;
        memory.shouldOfferSizeHelp = false;
        memory.lastAction = 'declined_offer';
        return {
          decision: ReplyDecision.Reply,
          reply: {
            text: 'Окей 💛 Як визначитесь — пишіть',
            sendNow: true,
          },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }
      ctx.trace.push('preQualifyCosmetics: offer ignored (user moved on)');
      memory.awaitingPreQualifyAnswer = false;
      memory.shouldOfferSizeHelp = false;
    }

    // Gate
    if (
      preQualifyFlowConfig?.preQualify?.enabled &&
      !memory.skinTypeCollected &&
      !memory.orderCreated &&
      !mediaProductData &&
      !memory.cartItems?.length &&
      memory.selectionState !== 'cart_item_added' &&
      memory.selectionState !== 'awaiting_variant' &&
      memory.selectionState !== 'awaiting_confirmation' &&
      !classification.entities.productName &&  // specific product → skip (NEW short-circuit)
      (awaitingPreQualify || this.shouldSearchProducts(classification, memory))
    ) {
      if (strategy === 'before_search') {
        ctx.trace.push('preQualifyCosmetics: before_search → ask skin type');
        if (classification.entities.category) {
          memory.selectedCategory = classification.entities.category;
        }
        const prompt =
          preQualifyFlowConfig.preQualify.prompt ||
          'Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛';
        memory.lastAction = 'asked_pre_qualify';
        memory.awaitingField = 'pre_qualify_data';
        return {
          decision: ReplyDecision.Reply,
          reply: { text: prompt, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }

      // strategy === 'after_search_offered': fall through; offer suffix appended later.
      ctx.trace.push('preQualifyCosmetics: after_search_offered → continue to search, will append offer');
      if (classification.entities.category) {
        memory.selectedCategory = classification.entities.category;
      }
    }

    return null;
  }

  // ─── Step 5: Product search + filter (block 5 + 5.5m) ──────────

  private async searchAndFilterProducts(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    const { memory, mediaProductData } = ctx;
    const classification = ctx.classification;

    // 5. Product search if needed (based on classification entities/keywords)
    let productData: ProductSearchResult[] | undefined;
    let isFirstProductPresentation = false;

    if (mediaProductData && mediaProductData.length > 0) {
      productData = mediaProductData;
      // Customer already saw the product in the story/post — not a "first presentation".
      // Always overwrite lastPresentedProducts: media context for THIS turn is the
      // authoritative product list. A stale list from a prior media-context turn
      // (different product) would otherwise leak through variable-map fallbacks
      // (template-engine.service.ts:555-556, 742-744) and surface the wrong product
      // name in interpolations like {product_name}.
      isFirstProductPresentation = false;
      memory.lastPresentedProducts = mediaProductData.map((p) => ({
        title: p.product.title,
        variants: [...new Set(p.variants.map((v) =>
          [...new Set([v.size, v.color].filter(Boolean))].join(', ') || 'standard',
        ))],
        price: [
          ...new Set(p.variants.map((v) => `${v.price} ${formatCurrency(v.currency)}`)),
        ].join(' / '),
      }));

      // 5.5m: Pre-seed memory so variant matching works for story/post replies.
      // Without this, memory.selectedProductId is null → 5.5c/5.5d are skipped →
      // template engine falls through to show_products listing all variants generically.
      const first = mediaProductData[0];
      const inStock = first.variants.filter((v) => v.effectiveAvailable > 0);

      memory.selectedProductId = first.product.id;
      memory.selectedProductTitle = first.product.title;
      memory.availableVariants = inStock.map((v) => ({
        id: v.id,
        name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
        color: v.color,
        size: v.size,
        imageUrl: v.imageUrl ?? null,
      }));
      // Record full catalog variant count for "last in stock" detection in 5.5d.
      memory.totalVariantsForSelectedProduct = first.variants.length;

      // Photo arrived with no caption text: the photo IS the inquiry. The
      // classifier sees only conversation history, which can produce
      // misleading actions — e.g. on a 2nd/3rd photo the classifier may
      // return action=confirm_selection because a prior turn had a variant
      // selected, even though the customer is sharing a fresh story
      // screenshot. Coerce to availability_check so the scenario-override
      // block below picks confirm_last_in_stock / ask_variant_choice /
      // confirm_selection based on actual stock state of the resolved
      // product. Photo-with-meaningful-caption (text non-empty) stays
      // untouched so price / delivery / FAQ flows still work.
      const captionEmpty = !(input.messageText ?? '').trim();
      if (captionEmpty) {
        ctx.trace.push(
          `5.5m: photo with empty caption → coerce intent=${classification.primaryIntent}/${classification.recommendedAction}→availability_check`,
        );
        classification.primaryIntent = 'availability_check';
        classification.recommendedAction = 'show_products';
        classification.slotAction = 'new_inquiry';
        // Clear classifier-inferred color/size — with empty text these came
        // from conversation history, not the current turn. Keeping them would
        // route the matcher to confirm_variant_available against the inferred
        // variant instead of the stock-based scenario the photo deserves.
        classification.entities.color = undefined;
        classification.entities.size = undefined;
        // Clear stale variant lock so the auto-select / variant-match logic
        // below treats this as a fresh inquiry instead of inheriting a prior
        // selection that the customer may not have meant to confirm.
        memory.selectedVariantId = undefined;
        memory.selectedVariantName = undefined;
        memory.selectionState = 'awaiting_product';
      }

      // Reconcile classifier-extracted productName with media-resolved title.
      // The classifier reads recent conversation history, so it can extract a
      // product name from prior turns even when the customer has switched to a
      // different story/post. Media context for THIS turn is ground truth —
      // override the stale entity so template-engine's variable map (which
      // checks classification.entities.productName FIRST at line 515-516)
      // doesn't render the wrong product name.
      if (
        classification.entities.productName &&
        classification.entities.productName !== first.product.title
      ) {
        ctx.trace.push(
          `5.5m: overrode classifier productName="${classification.entities.productName}" → media-resolved "${first.product.title}"`,
        );
        classification.entities.productName = first.product.title;
      }

      // Only override scenario for selection-type intents.
      // Price / delivery / FAQ intents already work correctly with productData in context.
      const isSelectionIntent =
        ['availability_check', 'product_inquiry', 'general_question'].includes(classification.primaryIntent) ||
        classification.recommendedAction === 'show_products';

      if (isSelectionIntent) {
        const userColor = classification.entities.color;
        const userSize = classification.entities.size;

        if (userColor || userSize) {
          // Customer mentioned a specific variant — try to match FIRST regardless of inStock count.
          // (Matching first avoids auto-selecting S when customer asked for XL which is out of stock.)
          const matched = this.matchVariant(
            inStock.map((v) => ({
              id: v.id,
              name: [...new Set([v.color, v.size].filter(Boolean))].join(', '),
              color: v.color ?? null,
              size: v.size ?? null,
            })),
            userColor,
            userSize,
          );
          if (matched) {
            // Single confident match → confirm
            memory.selectedVariantId = matched.id;
            memory.selectedVariantName = matched.name;
            memory.selectionState = 'awaiting_confirmation';
            const intent = userSize ? 'confirm_variant_available' : 'confirm_choice';
            const action = userSize ? 'confirm_variant_available' : 'confirm_selection';
            classification.primaryIntent = intent;
            classification.recommendedAction = action;
            ctx.trace.push(`5.5m: matched "${matched.name}" → awaiting_confirmation`);
            this.logger.log(`5.5m: Story reply — variant matched: ${matched.name}`);
          } else {
            // No single match — check if the requested dimension EXISTS but needs the other dimension
            const colorForms = userColor ? this.translateColor(userColor) : [];
            const sizeExists = userSize && inStock.some(v => v.size?.toLowerCase() === userSize.toLowerCase());
            const colorExists = userColor && inStock.some(v => {
              if (!v.color) return false;
              const vc = v.color.toLowerCase();
              return colorForms.some(f => vc === f || vc.includes(f) || f.includes(vc));
            });

            if (sizeExists || colorExists) {
              // Dimension exists but multiple options on the other axis → ask for the missing one
              memory.selectionState = 'awaiting_variant';
              memory.selectedVariantId = undefined;
              memory.selectedVariantName = undefined;
              classification.primaryIntent = 'ask_variant_choice';
              classification.recommendedAction = 'ask_variant_choice';
              ctx.trace.push(`5.5m: "${userSize || userColor}" exists but multiple options → ask_variant_choice`);
              this.logger.log(`5.5m: Story reply — dimension exists, asking for other dimension`);
            } else {
              // Dimension doesn't exist at all → variant_not_available
              memory.selectionState = 'awaiting_variant';
              memory.selectedVariantId = undefined;
              memory.selectedVariantName = undefined;
              memory.requestedVariant = userSize || userColor;
              classification.primaryIntent = 'variant_not_available';
              classification.recommendedAction = 'variant_not_available';
              ctx.trace.push(`5.5m: "${userSize || userColor}" not available → variant_not_available`);
              this.logger.log(`5.5m: Story reply — variant not available, showing alternatives`);
            }
          }
        } else if (inStock.length === 1) {
          // No specific variant mentioned AND only one option → auto-select
          memory.selectedVariantId = inStock[0].id;
          memory.selectedVariantName = (memory.availableVariants as Array<{ name: string }>)[0].name;
          memory.selectionState = 'awaiting_confirmation';
          // Match 5.5d: when the catalog has multiple variants but only
          // one is in stock, route to confirm_last_in_stock so the copy
          // can call out the scarcity. Falls back to confirm_selection
          // when no template authored (template engine handles the
          // fallback).
          const isLastInStockMedia =
            (memory.totalVariantsForSelectedProduct ?? 0) > 1;
          if (isLastInStockMedia) {
            classification.primaryIntent = 'confirm_last_in_stock';
            classification.recommendedAction = 'confirm_last_in_stock';
            ctx.trace.push(
              `5.5m: last-in-stock (1 of ${memory.totalVariantsForSelectedProduct}) → confirm_last_in_stock`,
            );
          } else {
            classification.primaryIntent = 'confirm_choice'; // no size asked — use generic confirm_selection
            classification.recommendedAction = 'confirm_selection';
          }
          this.logger.log(`5.5m: Story reply — single variant auto-selected: ${memory.selectedVariantName} (intent=${classification.primaryIntent})`);
        } else {
          // No specific variant, multiple options → ask which they want
          memory.selectionState = 'awaiting_variant';
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log(`5.5m: Story reply — product pre-seeded, no variant → ask_variant_choice`);
        }
      }
    }

    const needsSearch = !productData && this.shouldSearchProducts(classification, memory);
    ctx.trace.push(`search: needsSearch=${needsSearch}`);

    if (needsSearch) {
      // Clear stale variant on correction so 5.5c can re-match the new one
      if (classification.slotAction === 'correction') {
        memory.selectedVariantId = undefined;
        memory.selectedVariantName = undefined;
        ctx.trace.push('search: correction — cleared selectedVariantId for re-matching');
      }

      const searchKeywords = this.extractSearchKeywords(classification);
      productData = await this.searchProducts(
        input.tenantId,
        input.conversationId,
        searchKeywords,
        classification.entities.category,
      );

      this.logToFile({
        event: 'product_search',
        conversationId: input.conversationId,
        keywords: searchKeywords,
        found: productData ? productData.length : 0,
      });

      // Narrow by selectedCategory when set from a prior turn — prevents the
      // search from drifting across categories when a customer browses a
      // category-specific list ("куртка") then narrows by brand/product
      // ("давайте зара"). The keyword search OR-matches title across all
      // categories, so without this filter "Zara" would surface every Zara
      // product (t-shirts, pants, etc.) and pick productData[0] arbitrarily.
      // Defensive: skip filter if no in-category match (preserve broad result).
      if (
        memory.selectedCategory &&
        productData &&
        productData.length > 1
      ) {
        const cat = memory.selectedCategory.toLowerCase();
        const inCategory = productData.filter(
          (p) => p.product.category?.toLowerCase() === cat,
        );
        if (inCategory.length > 0) {
          ctx.trace.push(
            `search: narrowed by selectedCategory="${memory.selectedCategory}" (${productData.length} → ${inCategory.length})`,
          );
          productData = inCategory;
        }
      }

      // Defensive secondary narrowing: if multiple search results still
      // remain AND any of them was in the just-shown product list, prefer
      // those. Handles "selecting from a shown list" without depending on
      // selectedCategory being populated.
      if (
        Array.isArray(memory.lastPresentedProducts) &&
        memory.lastPresentedProducts.length > 0 &&
        productData &&
        productData.length > 1
      ) {
        const shownTitles = new Set(
          memory.lastPresentedProducts.map((p) => p.title.toLowerCase()),
        );
        const inShown = productData.filter((p) =>
          shownTitles.has(p.product.title.toLowerCase()),
        );
        if (inShown.length > 0) {
          ctx.trace.push(
            `search: narrowed to lastPresentedProducts (${productData.length} → ${inShown.length})`,
          );
          productData = inShown;
        }
      }

      // Filter by recommended size if available (skip on correction or when user explicitly chose a size)
      const isCorrection = classification.slotAction === 'correction';
      const userSpecifiedSize = !!classification.entities.size;
      if (productData && productData.length > 0 && memory.recommendedSize && !isCorrection && !userSpecifiedSize) {
        const recSize = memory.recommendedSize;
        const filtered = productData
          .map(p => ({
            ...p,
            variants: p.variants.filter(v => !v.size || v.size.toLowerCase() === recSize.toLowerCase()),
          }))
          .filter(p => p.variants.length > 0);

        if (filtered.length > 0) {
          productData = filtered;
          this.logger.log(`Filtered products by recommended size ${recSize}: ${filtered.length} products`);
        }
      }

      // Narrow by productName when classifier extracted a specific brand/model.
      // searchProducts uses an OR-of-keywords strategy that stops at the first
      // non-empty match — productName specificity gets lost when the first
      // matched keyword (often a generic "куртка" / "Футболки") returns many
      // products. This step pulls that specificity back at engine layer.
      // No cross-script translit yet — Cyrillic terms like "джек" won't match
      // Latin "JACK"; over-narrowing is guarded inside the helper.
      const userProductName = classification.entities.productName;
      if (userProductName && productData && productData.length > 1) {
        const narrowed = this.narrowByProductName(productData, userProductName);
        if (narrowed && narrowed.length < productData.length) {
          ctx.trace.push(
            `search: narrowed by productName="${userProductName}" (${productData.length} → ${narrowed.length})`,
          );
          productData = narrowed;
        }
      }

      // Filter products/variants by user's explicit color or size (narrows results to what they asked for)
      const userColor = classification.entities.color;
      const userSize = classification.entities.size;
      if (productData && productData.length > 0 && (userColor || userSize)) {
        const userColorForms = userColor ? this.translateColor(userColor) : [];
        const userSizeLower = userSize?.toLowerCase().trim();
        const filtered = productData
          .map(p => {
            // Color-on-title products (e.g. "Кремова футболка") have no color
            // variant axis; the color is baked into the title. For these, match
            // the user's color against the product title instead of variants —
            // if title doesn't contain the requested color, drop the whole product.
            const productHasColorDim = p.variants.some(v => !!v.color);
            if (userColor && !productHasColorDim) {
              const titleLower = p.product.title.toLowerCase();
              const titleMatchesColor = userColorForms.some(f => titleLower.includes(f));
              if (!titleMatchesColor) {
                return { ...p, variants: [] };
              }
            }
            return {
              ...p,
              variants: p.variants.filter(v => {
                if (userColor && productHasColorDim) {
                  if (!v.color) return false;
                  // Canonicalize BOTH sides via translateColor so Ukrainian
                  // gender forms ("чорна" feminine vs "Чорний" masculine
                  // variant) match through their shared "black" canonical
                  // translation. Without this both sides stay raw and
                  // gender mismatch causes the filter to silently drop
                  // legitimate variants.
                  const variantColorForms = this.translateColor(v.color);
                  const overlap = userColorForms.some(uf =>
                    variantColorForms.some(vf =>
                      vf === uf || vf.includes(uf) || uf.includes(vf),
                    ),
                  );
                  if (!overlap) return false;
                }
                if (userSizeLower) {
                  if (!v.size) return false;
                  if (v.size.toLowerCase().trim() !== userSizeLower) return false;
                }
                return true;
              }),
            };
          })
          .filter(p => p.variants.length > 0);

        if (filtered.length > 0) {
          productData = filtered;
          ctx.trace.push(`search: filtered by user color="${userColor ?? ''}" size="${userSize ?? ''}" → ${filtered.length} products`);
        }
      }

      ctx.trace.push(`search: found ${productData?.length ?? 0} products`);

      // Product not found → try product_not_found template, then handoff
      if ((!productData || productData.length === 0) &&
          ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse'].includes(classification.primaryIntent)) {
        ctx.trace.push('search: product not found → handoff');
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
        // Prioritize the already-selected product in search results
        if (productData.length > 1 && memory.selectedProductId) {
          const selectedIdx = productData.findIndex(p => p.product.id === memory.selectedProductId);
          if (selectedIdx > 0) {
            const [selected] = productData.splice(selectedIdx, 1);
            productData.unshift(selected);
          }
        }

        // Check if this is the first time showing products in this conversation
        isFirstProductPresentation = !memory.lastPresentedProducts?.length;
        ctx.trace.push(`search: isFirstPres=${isFirstProductPresentation} selState=${memory.selectionState}`);

        // Update memory with presented products BEFORE template selection
        memory.lastPresentedProducts = productData.map((p) => ({
          title: p.product.title,
          variants: [...new Set(p.variants.map((v) =>
            [...new Set([v.size, v.color].filter(Boolean))].join(', ') || 'standard',
          ))],
          price: [
            ...new Set(p.variants.map((v) => `${v.price} ${formatCurrency(v.currency)}`)),
          ].join(' / '),
        }));
        memory.selectedCategory =
          classification.entities.category ?? searchKeywords[0];

        // Store available variant names for the selected/target product
        const targetProduct = memory.selectedProductId
          ? productData.find(p => p.product.id === memory.selectedProductId) ?? (productData.length === 1 ? productData[0] : null)
          : productData.length === 1 ? productData[0] : null;

        ctx.trace.push(`search: targetProduct=${targetProduct?.product?.title ?? 'none'}, availableVariants=${memory.availableVariants ? (memory.availableVariants as any[]).length : 0}`);

        if (targetProduct) {
          memory.availableVariants = targetProduct.variants
            .filter((v) => v.effectiveAvailable > 0)
            .map((v) => ({
              id: v.id,
              name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
              color: v.color ?? null,
              size: v.size ?? null,
              imageUrl: v.imageUrl ?? null,
            }));

          memory.selectedProductId = targetProduct.product.id;
          memory.selectedProductTitle = targetProduct.product.title;
        }

        // Selection state management
        if (isFirstProductPresentation) {
          memory.selectionState = 'awaiting_product';
        }

        // If variant already matched during search (user specified product + color/size in one message),
        // upgrade to awaiting_confirmation — don't force browsing when they already chose.
        ctx.trace.push(`search: upgrade check selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId}`);
        if (memory.selectionState === 'awaiting_product' && memory.selectedProductId && memory.selectedVariantId) {
          memory.selectionState = 'awaiting_confirmation';
          classification.recommendedAction = 'confirm_selection';
          ctx.trace.push('search: upgraded awaiting_product → awaiting_confirmation (variant matched during search)');
          this.logger.log('Variant already matched during search — upgrading to awaiting_confirmation');
        }
      }
    }

    ctx.productData = productData;
    ctx.isFirstProductPresentation = isFirstProductPresentation;
    return null;
  }

  // ─── Step 6: Variant selection state machine (5.5a-5.5d) ───────

  private resolveVariantSelection(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): void {
    const { memory, effectiveConfig, productData } = ctx;
    const classification = ctx.classification;

    // 5.5a-rej: customer is in `awaiting_confirmation` (variant offered)
    // and rejects without naming an alternative product/category. Route
    // to a polite-decline scenario and clear the selection. Without
    // this branch the engine falls through to the default render path
    // and re-asks the same confirm question, or worse — when classifier
    // mis-classifies the rejection's primary_intent, the search step
    // can fire and surface a DIFFERENT product.
    if (
      classification.slotAction === 'rejection' &&
      memory.selectionState === 'awaiting_confirmation' &&
      memory.selectedProductId &&
      !classification.entities.productName &&
      !classification.entities.category
    ) {
      memory.selectionState = 'awaiting_product';
      memory.selectedVariantId = undefined;
      memory.selectedVariantName = undefined;
      classification.primaryIntent = 'decline_selection';
      classification.recommendedAction = 'decline_selection';
      ctx.trace.push('5.5a-rej: rejection on selected product → decline_selection');
      this.logger.log(
        '5.5a-rej: customer declined the offered variant → decline_selection',
      );
    }

    // 5.5a-pre: customer has a selected product (post-confirmation or
    // mid-flow) and is asking about a variant we don't have. Route to
    // `variant_not_available` so the bot answers "L not in stock, only
    // M available" instead of falling through to handoff.
    //
    // Two trigger shapes:
    //   - classifier extracted a size/color that isn't in availableVariants
    //     (specific ask: "А є в L?")
    //   - intent === 'ask_variant_choice' AND only one variant in stock
    //     (generic ask: "А є в інших розмірах?")
    if (
      memory.selectionState === 'awaiting_confirmation' &&
      memory.selectedProductId &&
      classification.slotAction !== 'confirmation' &&
      classification.slotAction !== 'rejection' &&
      Array.isArray(memory.availableVariants) &&
      memory.availableVariants.length > 0
    ) {
      const available = memory.availableVariants as Array<{
        color?: string | null;
        size?: string | null;
      }>;
      const askedSize = classification.entities.size;
      const askedColor = classification.entities.color;
      const sizeMissing =
        askedSize &&
        !available.some(
          (v) => v.size && v.size.toLowerCase() === askedSize.toLowerCase(),
        );
      const colorMissing =
        askedColor &&
        !available.some(
          (v) => v.color && v.color.toLowerCase() === askedColor.toLowerCase(),
        );
      const genericVariantQuery =
        !askedSize &&
        !askedColor &&
        classification.primaryIntent === 'ask_variant_choice' &&
        available.length <= 1;

      if (sizeMissing || colorMissing || genericVariantQuery) {
        memory.requestedVariant = askedSize || askedColor || undefined;
        classification.primaryIntent = 'variant_not_available';
        classification.recommendedAction = 'variant_not_available';
        ctx.trace.push(
          `5.5a-pre: post-selection variant query (asked=${memory.requestedVariant ?? 'generic'}) → variant_not_available`,
        );
        this.logger.log(
          `5.5a-pre: customer asked about unavailable variant (${memory.requestedVariant ?? 'generic'}) on selected product → variant_not_available`,
        );
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
      // Add confirmed item to cart
      if (!memory.cartItems) memory.cartItems = [];

      // Try to find price: first from productData (current turn), then from memory variants, then from lastPresentedProducts
      let itemPrice = 0;
      let itemCurrency = 'UAH';
      const currentProduct = productData?.find(p => p.product.id === memory.selectedProductId);
      const currentVariant = currentProduct?.variants.find(v => v.id === memory.selectedVariantId);
      if (currentVariant) {
        itemPrice = currentVariant.price;
        itemCurrency = currentVariant.currency;
      } else if (Array.isArray(memory.availableVariants)) {
        const memVariant = (memory.availableVariants as any[]).find(v => v.id === memory.selectedVariantId);
        if (memVariant?.price) {
          itemPrice = memVariant.price;
          itemCurrency = memVariant.currency ?? 'UAH';
        }
      }
      if (itemPrice === 0 && memory.lastPresentedProducts?.length) {
        const priceStr = memory.lastPresentedProducts[0].price;
        const priceMatch = priceStr?.match(/[\d.]+/);
        if (priceMatch) itemPrice = parseFloat(priceMatch[0]);
      }

      // Build variantName from memory or from product data
      let variantName = memory.selectedVariantName;
      if (!variantName && currentVariant) {
        variantName = [...new Set([currentVariant.color, currentVariant.size].filter(Boolean))].join(', ') || 'standard';
      }
      if (!variantName && Array.isArray(memory.availableVariants)) {
        const memVar = (memory.availableVariants as any[]).find(v => v.id === memory.selectedVariantId);
        if (memVar) variantName = memVar.name;
      }

      // Skip duplicate: don't re-add if this exact variant is already in cart
      const alreadyInCart = memory.cartItems.some(
        item => item.variantId === memory.selectedVariantId,
      );
      if (!alreadyInCart) {
        memory.cartItems.push({
          productId: memory.selectedProductId!,
          variantId: memory.selectedVariantId!,
          externalProductId: null, // resolved at order creation from DB
          externalVariantId: null,
          title: memory.selectedProductTitle!,
          variantName: variantName ?? 'standard',
          price: itemPrice,
          currency: itemCurrency,
        });
      }

      // Ask if customer wants to add more items or proceed to checkout
      memory.selectionState = 'cart_item_added';
      classification.primaryIntent = 'confirm_choice';
      classification.recommendedAction = 'ask_continue_or_checkout';
      ctx.trace.push(`5.5a: cart add ${memory.selectedProductTitle} (${memory.selectedVariantName}), cart=${memory.cartItems.length}`);
      this.logger.log(`5.5a FIRED: Item added to cart: ${memory.selectedProductTitle} (${memory.selectedVariantName}). Cart has ${memory.cartItems.length} items.`);
      this.logToFile({
        event: 'cart_item_added',
        conversationId: input.conversationId,
        selectionState: memory.selectionState,
        selectedProductId: memory.selectedProductId,
        selectedVariantId: memory.selectedVariantId,
        cartSize: memory.cartItems.length,
        action: 'ask_continue_or_checkout',
      });
    }

    // 5.5a-2: Cart checkout — user confirms "оформлюємо" when cart has items
    // Only fires when cart_item_added was set on a PREVIOUS turn (not the current one from 5.5a)
    if (
      (classification.slotAction === 'confirmation' || classification.primaryIntent === 'ready_to_order' || classification.primaryIntent === 'provide_details') &&
      memory.selectionState === 'cart_item_added' &&
      memory.cartItems?.length &&
      memory.lastAction === 'asked_continue_or_checkout' // Ensure this is a NEW confirmation, not the same turn as 5.5a
    ) {
      memory.selectionState = 'confirmed';
      classification.primaryIntent = 'ready_to_order';
      classification.recommendedAction = 'start_checkout';
      classification.conversationStage = 'checkout_started';
      ctx.trace.push(`5.5a-2: checkout with ${memory.cartItems.length} items`);
      this.logger.log('Cart checkout: proceeding with ' + memory.cartItems.length + ' items');
    }

    // 5.5b Variant check: after recommendation + confirmation, check if variant selection needed
    // Detect if two-step variant selection is needed (flowConfig.variants.askSequence has both color and size)
    const variantsFlowConfig = (effectiveConfig?.flowConfig as any)?.variants;
    const needsTwoStepVariants = variantsFlowConfig?.askSequence?.length === 2 &&
      variantsFlowConfig.askSequence.includes('color') &&
      variantsFlowConfig.askSequence.includes('size');

    if (
      classification.slotAction === 'confirmation' &&
      (memory.selectionState === 'awaiting_confirmation' ||
        (memory.selectionState === 'awaiting_variant' && !memory.variantStep)) &&
      memory.selectedProductId &&
      !memory.selectedVariantId
    ) {
      const rawVariants = memory.availableVariants;
      const variants = Array.isArray(rawVariants) ? rawVariants : [];
      const userColor = classification.entities.color;
      const userSize = classification.entities.size;

      // Check if variants have both color AND size for two-step
      const hasBothDimensions = needsTwoStepVariants &&
        variants.some((v: any) => v.color) && variants.some((v: any) => v.size);

      if (variants.length === 1) {
        // Single variant → auto-select, proceed to confirm
        memory.selectedVariantId = variants[0].id;
        memory.selectedVariantName = variants[0].name;
        memory.selectionState = 'awaiting_confirmation';
        this.setConfirmIntent(classification, userColor, userSize);
        ctx.trace.push('5.5b: single variant auto-selected');
        this.logger.log('Single variant → auto-selected, proceeding to confirm_selection');
      } else if (hasBothDimensions && !memory.variantStep) {
        // Two-step: start with color
        memory.selectionState = 'awaiting_variant';
        memory.variantStep = 'color';
        classification.primaryIntent = 'ask_variant_choice';
        classification.recommendedAction = 'ask_variant_choice';
        ctx.trace.push('5.5b: two-step start with color');
        this.logger.log(`Two-step variant: starting with color (${variants.length} variants)`);
      } else if (variants.length > 1 && (userColor || userSize)) {
        // User specified a variant — try to match
        const matched = this.matchVariant(variants, userColor, userSize);
        if (matched) {
          memory.selectedVariantId = matched.id;
          memory.selectedVariantName = matched.name;
          memory.selectionState = 'awaiting_confirmation';
          this.setConfirmIntent(classification, userColor, userSize);
          ctx.trace.push(`5.5b: variant matched ${matched.name}`);
          this.logger.log(`Variant matched: ${matched.name}`);
        } else {
          // No confident match → ask for variant
          memory.selectionState = 'awaiting_variant';
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          ctx.trace.push('5.5b: variant not matched → ask_variant_choice');
          this.logger.log('Variant not matched confidently, asking user');
        }
      } else if (variants.length > 1) {
        // Multiple variants, user didn't specify → ask
        memory.selectionState = 'awaiting_variant';
        classification.primaryIntent = 'ask_variant_choice';
        classification.recommendedAction = 'ask_variant_choice';
        ctx.trace.push(`5.5b: ${variants.length} variants → ask_variant_choice`);
        this.logger.log(`Multiple variants (${variants.length}), asking user to choose`);
      }
    }

    // 5.5b-2: Two-step variant selection — handle color/size steps
    if (
      memory.selectionState === 'awaiting_variant' &&
      memory.variantStep &&
      memory.selectedProductId &&
      !memory.selectedVariantId &&
      (classification.slotAction === 'fills_missing_slot' || classification.slotAction === 'confirmation')
    ) {
      const rawVariants = memory.availableVariants;
      const variants = Array.isArray(rawVariants) ? rawVariants : [];
      const userColor = classification.entities.color;
      const userSize = classification.entities.size;

      if (memory.variantStep === 'color' && (userColor || input.messageText.trim())) {
        // User picked a color — match it
        const colorInput = userColor || input.messageText.trim();
        const colorVariants = variants.filter((v: any) => v.color);
        const uniqueColors = [...new Set(colorVariants.map((v: any) => v.color))] as string[];
        const matchedColor = this.matchColorOrSize(colorInput, uniqueColors);

        if (matchedColor) {
          ctx.trace.push(`5.5b-2: color=${matchedColor}`);
          memory.selectedColor = matchedColor;

          // Early-resolve: if size is already known from a prior turn
          // (ask_color_for_size flow's follow-up), don't transition into a
          // size step — resolve directly to the exact (color, size) variant.
          if (memory.selectedSize) {
            const exactVariant = variants.find(
              (v: any) =>
                v.color && v.color.toLowerCase() === matchedColor.toLowerCase() &&
                v.size && v.size.toLowerCase() === memory!.selectedSize!.toLowerCase(),
            );
            if (exactVariant) {
              memory.selectedVariantId = exactVariant.id;
              memory.selectedVariantName = exactVariant.name;
              memory.variantStep = null;
              memory.selectionState = 'awaiting_confirmation';
              this.setConfirmIntent(classification, matchedColor, memory.selectedSize);
              ctx.trace.push(`5.5b-2: color+selectedSize matched → resolved`);
              return;
            }
            // Else fall through — exact (color, size) not in stock; let the
            // standard size-step handler explain what's available.
          }

          // Check if sizes exist for this color
          const sizesForColor = variants.filter(
            (v: any) => v.color && v.color.toLowerCase() === matchedColor.toLowerCase() && v.size,
          );
          if (sizesForColor.length > 1) {
            // Multiple sizes — ask for size, with dedicated partial-variant wording
            memory.variantStep = 'size';
            classification.primaryIntent = 'ask_size_for_color';
            classification.recommendedAction = 'ask_size_for_color';
            this.logger.log(`Two-step variant: color=${matchedColor}, asking for size (${sizesForColor.length} options)`);
          } else if (sizesForColor.length === 1) {
            // Only one size for this color — auto-select
            memory.selectedVariantId = sizesForColor[0].id;
            memory.selectedVariantName = sizesForColor[0].name;
            memory.variantStep = null;
            memory.selectionState = 'awaiting_confirmation';
            this.setConfirmIntent(classification, matchedColor, sizesForColor[0].size ?? undefined);
            this.logger.log(`Two-step variant: color=${matchedColor}, single size → auto-selected`);
          } else {
            // No sizes, find variant by color only
            const colorOnlyVariant = variants.find(
              (v: any) => v.color && v.color.toLowerCase() === matchedColor.toLowerCase(),
            );
            if (colorOnlyVariant) {
              memory.selectedVariantId = colorOnlyVariant.id;
              memory.selectedVariantName = colorOnlyVariant.name;
              memory.variantStep = null;
              memory.selectionState = 'awaiting_confirmation';
              this.setConfirmIntent(classification, matchedColor, undefined);
            }
          }
        } else {
          // Color not matched — re-ask
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log(`Two-step variant: color not matched for "${colorInput}", re-asking`);
        }
      } else if (memory.variantStep === 'size' && memory.selectedColor && (userSize || (!userColor && input.messageText.trim()))) {
        // User picked a size — match it
        const sizeInput = userSize || input.messageText.trim();
        const sizesForColor = variants.filter(
          (v: any) => v.color && v.color.toLowerCase() === memory.selectedColor!.toLowerCase() && v.size,
        );
        const uniqueSizes = [...new Set(sizesForColor.map((v: any) => v.size))] as string[];
        const matchedSize = this.matchColorOrSize(sizeInput, uniqueSizes);

        if (matchedSize) {
          // Find the exact variant by color + size
          const exactVariant = variants.find(
            (v: any) =>
              v.color && v.color.toLowerCase() === memory.selectedColor!.toLowerCase() &&
              v.size && v.size.toLowerCase() === matchedSize.toLowerCase(),
          );
          if (exactVariant) {
            memory.selectedVariantId = exactVariant.id;
            memory.selectedVariantName = exactVariant.name;
            memory.variantStep = null;
            memory.selectionState = 'awaiting_confirmation';
            this.setConfirmIntent(classification, memory.selectedColor ?? undefined, matchedSize);
            ctx.trace.push(`5.5b-2: size=${matchedSize} → resolved`);
            this.logger.log(`Two-step variant: color=${memory.selectedColor}, size=${matchedSize} → resolved`);
          }
        } else {
          // Size not matched — re-ask
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log(`Two-step variant: size not matched for "${sizeInput}", re-asking`);
        }
      }
    }

    // 5.5c Variant check for fills_missing_slot/correction: user picked a product, check if variant needed.
    // Defensive gate: also accept slotAction='confirmation' when entities carry color/size — guards
    // against classifier misclassifying "давайте/беру + specifics" replies as pure confirmations
    // (the pendingOfferRule edge case). 5.5a/5.5b already short-circuit any case where this would
    // double-fire (they set selectedVariantId or variantStep before 5.5c evaluates).
    if (
      (classification.slotAction === 'fills_missing_slot' ||
        classification.slotAction === 'correction' ||
        (classification.slotAction === 'confirmation' &&
          (classification.entities.color || classification.entities.size))) &&
      memory.selectedProductId &&
      !memory.selectedVariantId &&
      !memory.variantStep && // Don't interfere with two-step variant selection
      productData && productData.length === 1
    ) {
      const variants = productData[0].variants.filter(v => v.effectiveAvailable > 0);
      ctx.trace.push(`5.5c: fills_missing_slot, ${variants.length} variants`);

      // Check if two-step is needed for this product
      const hasBothDimensions = needsTwoStepVariants &&
        variants.some(v => v.color) && variants.some(v => v.size);

      if (variants.length > 1) {
        const userColor = classification.entities.color;
        const userSize = classification.entities.size;

        if (hasBothDimensions && !userColor && !userSize) {
          // Two-step: start with color
          memory.selectionState = 'awaiting_variant';
          memory.variantStep = 'color';
          memory.availableVariants = this.buildAvailableVariantsList(variants);
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log(`5.5c two-step: Product selected, starting with color (${variants.length} variants)`);
        } else if (userColor || userSize) {
          const matched = this.matchVariant(
            variants.map(v => ({ id: v.id, name: [...new Set([v.color, v.size].filter(Boolean))].join(', '), color: v.color, size: v.size })),
            userColor, userSize,
          );
          if (matched) {
            memory.selectedVariantId = matched.id;
            memory.selectedVariantName = matched.name;
            memory.selectionState = 'awaiting_confirmation';
            this.setConfirmIntent(classification, userColor, userSize);
          } else {
            // Match was ambiguous (multiple variants fit one provided axis).
            // Preserve the known axis and route to the partial-variant scenario
            // so the bot asks ONLY about the missing axis with dedicated wording.
            // Explicitly clear the OTHER axis to prevent stale state from a prior
            // selection from over-narrowing the variant list / image set.
            memory.selectionState = 'awaiting_variant';
            memory.availableVariants = this.buildAvailableVariantsList(variants);
            // Detect no-color-axis (color-in-title products): variants don't
            // carry a color attribute. Color was a title match, not a real
            // axis — don't enter two-step flow, route to single-axis
            // ask_variant_choice for sizes.
            const hasColorAxis = variants.some(v => v.color);
            if (userColor && !userSize && !hasColorAxis) {
              memory.variantStep = null;
              memory.selectedColor = undefined;
              memory.selectedSize = undefined;
              classification.primaryIntent = 'ask_variant_choice';
              classification.recommendedAction = 'ask_variant_choice';
              ctx.trace.push('5.5c: color-in-title product (no color axis) → ask_variant_choice (sizes only)');
            } else if (userColor && !userSize) {
              memory.selectedColor = userColor;
              memory.selectedSize = undefined;
              memory.variantStep = 'size';
              classification.primaryIntent = 'ask_size_for_color';
              classification.recommendedAction = 'ask_size_for_color';
              ctx.trace.push('5.5c: color matched, size ambiguous → ask_size_for_color');
            } else if (userSize && !userColor) {
              memory.selectedSize = userSize;
              memory.selectedColor = undefined;
              memory.variantStep = 'color';
              classification.primaryIntent = 'ask_color_for_size';
              classification.recommendedAction = 'ask_color_for_size';
              ctx.trace.push('5.5c: size matched, color ambiguous → ask_color_for_size');
            } else {
              classification.primaryIntent = 'ask_variant_choice';
              classification.recommendedAction = 'ask_variant_choice';
            }
          }
        } else {
          memory.selectionState = 'awaiting_variant';
          memory.availableVariants = this.buildAvailableVariantsList(variants);
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          this.logger.log(`5.5c: Product selected, ${variants.length} variants — asking user`);
        }
      } else if (variants.length === 1) {
        memory.selectedVariantId = variants[0].id;
        memory.selectedVariantName = [...new Set([variants[0].color, variants[0].size].filter(Boolean))].join(', ') || 'standard';
        memory.selectionState = 'awaiting_confirmation';
        this.setConfirmIntent(classification, classification.entities.color, classification.entities.size);
      }
    }

    // 5.5d: Product picked from list — check if variant selection is needed
    // Handles the gap where user picks a product while in awaiting_product state
    if (
      memory.selectionState === 'awaiting_product' &&
      memory.selectedProductId &&
      !memory.selectedVariantId &&
      Array.isArray(memory.availableVariants) &&
      memory.availableVariants.length > 0
    ) {
      const variants = memory.availableVariants as Array<{ id: string; name: string; color?: string | null; size?: string | null }>;

      // If recommendedSize is set, filter variants to that size first
      let effectiveVariants = variants;
      // (5.5d trace added after effectiveVariants is finalized below)
      if (memory.recommendedSize) {
        const sizeFiltered = variants.filter(
          (v: any) => !v.size || v.size.toLowerCase() === memory.recommendedSize!.toLowerCase(),
        );
        if (sizeFiltered.length > 0) effectiveVariants = sizeFiltered;
      }

      const userColor = classification.entities.color;
      const userSize = classification.entities.size;

      ctx.trace.push(`5.5d: selState=${memory.selectionState} prodId=${!!memory.selectedProductId} varId=${!!memory.selectedVariantId} variants=${effectiveVariants.length}`);

      if (effectiveVariants.length === 1) {
        // Single variant (or single after size filter) → auto-select
        memory.selectedVariantId = effectiveVariants[0].id;
        memory.selectedVariantName = effectiveVariants[0].name;
        memory.selectionState = 'awaiting_confirmation';
        this.setConfirmIntent(classification, userColor, userSize);
        // "Last in stock" routing: catalog has multiple variants but
        // only one is currently available. Skip when the customer
        // explicitly named a variant (size/color) — they're not asking
        // a generic "what's available", so the standard confirm copy
        // is the right fit.
        const isVariantQuery = !!(userColor || userSize);
        const isLastInStock =
          !isVariantQuery &&
          (memory.totalVariantsForSelectedProduct ?? 0) > 1;
        if (isLastInStock) {
          classification.primaryIntent = 'confirm_last_in_stock';
          classification.recommendedAction = 'confirm_last_in_stock';
          ctx.trace.push(
            `5.5d: last-in-stock (1 of ${memory.totalVariantsForSelectedProduct}) → confirm_last_in_stock`,
          );
        }
        ctx.trace.push(`5.5d: matched ${effectiveVariants[0].name} → awaiting_confirmation (intent=${classification.primaryIntent})`);
        this.logger.log(`5.5d: Single variant after filter → auto-selected: ${effectiveVariants[0].name}`);
      } else if (userColor || userSize) {
        // User specified color/size in the same message — try to match
        const matched = this.matchVariant(
          effectiveVariants.map(v => ({ id: v.id, name: v.name, color: v.color ?? null, size: v.size ?? null })),
          userColor, userSize,
        );
        if (matched) {
          memory.selectedVariantId = matched.id;
          memory.selectedVariantName = matched.name;
          memory.selectionState = 'awaiting_confirmation';
          this.setConfirmIntent(classification, userColor, userSize);
          ctx.trace.push(`5.5d: matched ${matched.name} → awaiting_confirmation (intent=${classification.primaryIntent})`);
          this.logger.log(`5.5d: Variant matched from user input: ${matched.name}`);
        } else {
          memory.selectionState = 'awaiting_variant';
          if (memory.recommendedSize) memory.variantStep = 'color';
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
          ctx.trace.push('5.5d: not matched → awaiting_variant');
          this.logger.log(`5.5d: Variant not matched, asking user`);
        }
      } else if (effectiveVariants.length > 1) {
        // Multiple variants, no user input — ask for choice
        memory.selectionState = 'awaiting_variant';
        // If sizes are already determined (recommendedSize), only ask for color
        if (memory.recommendedSize) {
          memory.variantStep = 'color';
        } else if (needsTwoStepVariants) {
          memory.variantStep = 'color';
        }
        classification.primaryIntent = 'ask_variant_choice';
        classification.recommendedAction = 'ask_variant_choice';
        ctx.trace.push(`5.5d: ${effectiveVariants.length} variants → ask_variant_choice`);
        this.logger.log(`5.5d: Product picked, ${effectiveVariants.length} variants — asking user (variantStep=${memory.variantStep ?? 'all'})`);
      }
    }
  }

  // ─── Step 7: Template render + memory update + order decision ──

  private async buildResponse(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput> {
    const { memory, settings, effectiveConfig, examples, categories, productData, isFirstProductPresentation, flowConfig, policy } = ctx;
    const classification = ctx.classification;

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
      flowConfig,
    });

    let finalReply: string;
    let usedTemplateId: string | undefined;
    let actualAction: string; // What ACTUALLY happened (not what classifier wanted)

    if (templateResult) {
      // 7. Template found -> use it
      ctx.trace.push(`template: ${templateResult.scenario} (${templateResult.templateId})`);
      finalReply = templateResult.text;
      usedTemplateId = templateResult.templateId;
      // Use the template's actual scenario for memory tracking (may differ from classifier due to stage gates)
      actualAction = this.scenarioToAction(templateResult.scenario);

      // Prepend pre-qualify recommendation if just collected. Each businessType
      // branch reads only its own memory flag — no shared state between
      // verticals, so a stale flag from one businessType cannot trigger the
      // wrong prefix on a request handled by another.
      const buildResponseBusinessType =
        ((effectiveConfig?.flowConfig as any)?.businessType as 'clothing' | 'cosmetics') ?? 'clothing';

      if (buildResponseBusinessType === 'clothing') {
        if (memory.recommendedSize && memory.lastAction === 'recommended_size') {
          finalReply = `${RECOMMENDED_SIZE_PREFIX(memory.recommendedSize)}\n\n${finalReply}`;
        }
      }

      if (buildResponseBusinessType === 'cosmetics') {
        if (memory.recommendedSkinType && memory.lastAction === 'recommended_skin_type') {
          // Inflect the canonical nominative skin type into Ukrainian genitive
          // so the prefix reads naturally ("Для жирної шкіри..." not
          // "Для жирна шкіри..."). Falls back to the canonical form for any
          // unrecognized value (engine survives, prefix reads slightly off).
          const SKIN_TYPE_GENITIVE: Record<string, string> = {
            'жирна': 'жирної',
            'суха': 'сухої',
            'нормальна': 'нормальної',
            'комбінована': 'комбінованої',
            'чутлива': 'чутливої',
          };
          const skinTypeGenitive =
            SKIN_TYPE_GENITIVE[memory.recommendedSkinType.toLowerCase()] ??
            memory.recommendedSkinType;
          finalReply = `Для ${skinTypeGenitive} шкіри підбираю варіанти 💛\n\n${finalReply}`;
        }
      }

      // ─── after_search_offered: append size-help offer suffix ───────
      // Conditions (all must be true):
      //   0. flow_config.preQualify.enabled is true (master kill switch)
      //   1. Strategy is 'after_search_offered'
      //   2. We just rendered show_products (i.e. presented options to user)
      //   3. User has NOT yet provided pre-qualify data
      //      (recommendedSize/recommendedSkinType unset)
      //   4. We haven't already offered (shouldOfferSizeHelp not set)
      //   5. User isn't in mid-pre-qualify-Q-A
      const buildResponseFlowConfig = effectiveConfig?.flowConfig as any;
      const buildResponsePreQualifyEnabled = !!buildResponseFlowConfig?.preQualify?.enabled;
      const buildResponseStrategy: 'before_search' | 'after_search_offered' =
        (buildResponseFlowConfig?.preQualifyStrategy as 'before_search' | 'after_search_offered') ??
        'after_search_offered';
      const justAnsweredPreQualify =
        memory.lastAction === 'recommended_size' ||
        memory.lastAction === 'recommended_skin_type' ||
        memory.lastAction === 'asked_pre_qualify';
      // Don't append the offer if the user already gave the relevant info
      // upfront (size for clothing, skinType for cosmetics) — they don't need
      // help with what they already specified.
      const userAlreadyGavePreQualifyInfo =
        (buildResponseBusinessType === 'clothing' && !!classification.entities.size) ||
        (buildResponseBusinessType === 'cosmetics' && !!classification.entities.skinType);
      if (
        buildResponsePreQualifyEnabled &&
        buildResponseStrategy === 'after_search_offered' &&
        templateResult.scenario === 'show_products' &&
        !memory.shouldOfferSizeHelp &&
        !justAnsweredPreQualify &&
        !userAlreadyGavePreQualifyInfo &&
        ((buildResponseBusinessType === 'clothing' && !memory.recommendedSize) ||
          (buildResponseBusinessType === 'cosmetics' && !memory.recommendedSkinType))
      ) {
        const offerSuffix =
          buildResponseBusinessType === 'cosmetics'
            ? '\n\nХочете, допоможу підібрати під ваш тип шкіри? 💛'
            : '\n\nХочете, допоможу з розміром? 💛';
        finalReply = `${finalReply}${offerSuffix}`;
        memory.shouldOfferSizeHelp = true;
        memory.awaitingPreQualifyAnswer = true;
        ctx.trace.push(`offer_suffix: appended (${buildResponseBusinessType})`);
      }

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
      ctx.trace.push('template: none found');
      // general_question with no FAQ match → bot doesn't know the answer → handoff
      if (
        classification.primaryIntent === 'general_question' ||
        classification.recommendedAction === 'answer_faq'
      ) {
        ctx.trace.push('handoff: general_question_no_template');
        this.logger.log('general_question with no template → handoff');
        return this.doHandoff(input, 'Клієнт поставив питання, на яке бот не знає відповіді');
      }

      // Check if product-related intent but no products found → handoff
      const productIntents = ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse', 'ask_price'];
      if (productIntents.includes(classification.primaryIntent) && (!productData || productData.length === 0)) {
        ctx.trace.push('handoff: product_not_found');
        this.logger.log('No template + no products found for product intent → handoff');
        return this.doHandoff(input, 'product_not_found', 'Секунду, уточню наявність 💛');
      }

      // Layer 1: Pre-check — block order-like messages when no active checkout
      const hasActiveCheckout = !!(memory.selectedProductId &&
        (memory.selectionState === 'confirmed' || memory.lastAction === 'asked_delivery_details'));

      if (classification.primaryIntent === 'provide_details' && !hasActiveCheckout) {
        this.logger.log('Pre-check: provide_details without active checkout → clarification');
        finalReply = 'Дякую 💛 Підкажіть, будь ласка, який товар вас цікавить?';
        actualAction = 'greeting';
      } else if (
        policy.action === 'fallback' ||
        this.policyEngine.isFallbackAllowed(classification, effectiveConfig)
      ) {
        ctx.trace.push('fallback: AI reply');
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

          // Layer 3: Output safety — block fake order confirmations
          if (!hasActiveCheckout) {
            const orderPhrases = ['замовлення оформлено', 'вже в обробці', 'надішлю підтвердження',
              'очікуйте відправку', 'замовлення прийнято', 'дані отримала', 'замовлення створено'];
            const hasOrderLanguage = orderPhrases.some(p => finalReply.toLowerCase().includes(p));
            if (hasOrderLanguage) {
              finalReply = 'Дякую 💛 Підкажіть, будь ласка, який товар вас цікавить?';
              this.logger.warn('Output safety: blocked fake order confirmation from AI fallback');
            }
          }
        } catch (err) {
          this.logger.error('AI fallback failed', err);
          memory.failedTurns = (memory.failedTurns ?? 0) + 1;
          return this.doHandoff(input, 'ai_fallback_failure');
        }
      } else {
        // Strict mode: no template + no fallback = escalate
        ctx.trace.push('handoff: no_template_strict_mode');
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

    ctx.trace.push(`action: ${actualAction}`);

    // Update memory based on what ACTUALLY happened, not classifier's recommendation
    this.updateMemoryFromAction(actualAction, memory, templateResult, classification, productData);

    // Update selected variant ID from template variable matching
    // Skip for variant_not_available / ask_variant_choice — those scenarios explicitly cleared the variant
    const skipVariantUpdate = ['variant_not_available', 'ask_variant_choice', 'ask_size_for_color', 'ask_color_for_size'].includes(templateResult?.scenario ?? '');
    if (templateResult?.matchedVariantId && !skipVariantUpdate) {
      memory.selectedVariantId = templateResult.matchedVariantId;
      memory.selectedVariantName = classification.entities.color ?? classification.entities.size ?? memory.selectedVariantName;
    }

    // Set product IDs if product search found results — sync to BOTH state and memory
    if (productData && productData.length > 0) {
      const first = productData[0];

      // Only auto-pick a product when there isn't genuine ambiguity. When the
      // engine showed multiple products and the user hasn't chosen one yet,
      // writing selectedProductId = productData[0].id would silently lock the
      // funnel onto the first product on the next turn (search.targetProduct
      // narrows to it, second product disappears).
      const askingForProduct =
        memory.selectionState === 'awaiting_product' && productData.length > 1;
      if (!askingForProduct) {
        stateUpdate.selectedProductId = first.product.id;
        memory.selectedProductId = first.product.id;
        memory.selectedProductTitle = memory.selectedProductTitle || first.product.title;
      } else {
        stateUpdate.selectedProductId = memory.selectedProductId ?? null;
      }

      // Only auto-pick a variant when the engine has NOT decided to ask the user.
      // 5.5b/c/d set selectionState='awaiting_variant' on ambiguity; the template
      // engine routes to ask_variant_choice in that case. Auto-picking here would
      // write a phantom variantId into state and break the next turn (CLAUDE.md
      // invariant: no fallback to first variant). Also suppress when product is
      // unresolved — a variant id without a product id is meaningless.
      const variantAskingScenarios = ['ask_variant_choice', 'ask_size_for_color', 'ask_color_for_size'];
      const askingForVariant =
        memory.selectionState === 'awaiting_variant' ||
        variantAskingScenarios.includes(classification.recommendedAction) ||
        variantAskingScenarios.includes(templateResult?.scenario ?? '');
      if (!askingForProduct && !askingForVariant) {
        const inStockVariant = first.variants.find(
          (v) => v.effectiveAvailable > 0,
        );
        stateUpdate.selectedVariantId =
          inStockVariant?.id ?? first.variants[0]?.id;
      } else if (askingForProduct) {
        // Multi-product show — variant must NOT be locked in, even if some
        // upstream code (e.g., template-engine variable map auto-resolving
        // a single-variant first product) populated memory.selectedVariantId.
        // Force-clear so the next turn starts fresh from product selection.
        stateUpdate.selectedVariantId = null;
        memory.selectedVariantId = undefined;
      } else {
        stateUpdate.selectedVariantId = memory.selectedVariantId ?? null;
      }
    }

    stateUpdate.contextJson = memory as any;

    // 10. Check if this is a confirmed order → emit CreateDraftOrder decision
    // Idempotency: only create order once per conversation
    // Use orderCreated flag only — lastAction is already updated by updateMemoryFromAction above
    const alreadyOrdered = memory.orderCreated === true;
    if (actualAction === 'confirm_order' && !alreadyOrdered) {
      ctx.trace.push('order: create_draft_order');
      memory.orderCreated = true;
      const orderPayload = this.buildOrderPayload(input, memory, classification);

      await this.auditService.log({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        type: AuditLogType.DraftOrderCreated,
        details: {
          decision: ReplyDecision.CreateDraftOrder,
          intent: classification.primaryIntent,
          action: actualAction,
          templateId: usedTemplateId ?? 'ai_fallback',
          hasOrderPayload: !!orderPayload,
        },
      });

      this.logToFile({
        event: 'create_draft_order',
        conversationId: input.conversationId,
        inbound: input.messageText,
        outbound: finalReply,
        templateId: usedTemplateId ?? 'ai_fallback',
        templateScenario: templateResult?.scenario ?? 'ai_fallback',
        orderPayload: orderPayload ? { items: orderPayload.items.length, customerInfo: orderPayload.customerInfo } : null,
        memory,
      });

      return {
        decision: ReplyDecision.CreateDraftOrder,
        reply: { text: finalReply, sendNow: true, imageUrls: templateResult?.imageUrls },
        handoff: { required: false, reason: null },
        stateUpdate,
        orderPayload: orderPayload ?? undefined,
      };
    }

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
      imageUrls: templateResult?.imageUrls,
      templateId: usedTemplateId ?? 'ai_fallback',
      templateScenario: templateResult?.scenario ?? 'ai_fallback',
      stage: classification.conversationStage,
      action: classification.recommendedAction,
      memory,
    });

    // Auto-attach size chart for size-asking scenarios when single-product
    // context is locked. Trigger gate (per locked decision):
    //   scenario === 'ask_size_for_color'
    //   OR (scenario === 'ask_variant_choice' AND memory.variantStep === 'size')
    //   AND productData?.length === 1
    //   AND chart resolves for the product's brand/category
    // No-match: silent skip — no extra bubble, no caption.
    const extraReplies = await this.maybeAttachSizeChart(
      input,
      ctx,
      templateResult?.scenario,
    );

    return {
      decision: ReplyDecision.Reply,
      reply: { text: finalReply, sendNow: true, imageUrls: templateResult?.imageUrls },
      extraReplies,
      handoff: { required: false, reason: null },
      stateUpdate,
      classification,
      templateScenario: templateResult?.scenario ?? 'ai_fallback',
    };
  }

  /**
   * If the engine is asking the customer for a size and a chart is on file
   * for this product, return a follow-up reply with the chart image and a
   * short caption. Otherwise return undefined (silent skip).
   */
  private async maybeAttachSizeChart(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
    scenario: string | undefined,
  ): Promise<ReplyEngineOutput['extraReplies']> {
    if (!scenario) return undefined;
    if (!ctx.productData || ctx.productData.length !== 1) return undefined;

    const isSizeForColor = scenario === 'ask_size_for_color';
    const isVariantChoiceSizeStep =
      scenario === 'ask_variant_choice' && ctx.memory.variantStep === 'size';
    // Third trigger: single-axis size-only product (no color variants) routed
    // to ask_variant_choice. The bot is unambiguously asking for a size — same
    // intent as the two-step variantStep='size' case, just without a prior
    // color step.
    const productHasColors = ctx.productData[0].variants.some((v) => v.color);
    const productHasSizes = ctx.productData[0].variants.some((v) => v.size);
    const isVariantChoiceSizeOnly =
      scenario === 'ask_variant_choice' && productHasSizes && !productHasColors;
    if (!isSizeForColor && !isVariantChoiceSizeStep && !isVariantChoiceSizeOnly) {
      return undefined;
    }

    const productId = ctx.productData[0].product.id;
    const { brand, category } =
      await this.sizeChartsService.getBrandAndCategoryForProduct(input.tenantId, productId);
    const chart = await this.sizeChartsService.resolveForContext(input.tenantId, {
      brand,
      category,
    });
    if (!chart) {
      ctx.trace.push('size_chart auto-attach: no chart matched (silent skip)');
      return undefined;
    }
    ctx.trace.push(
      `size_chart auto-attach: ${chart.id} (brand=${brand ?? '-'}, category=${category ?? '-'})`,
    );
    // Use a root-relative URL (matches product_media.url convention).
    // Demo widget loads it via the Vite proxy to /uploads/...; Instagram
    // production path would need an absolute URL — but Instagram doesn't
    // iterate extraReplies yet (tech debt), so we don't need to dual-emit.
    // When Instagram support lands, resolve the absolute URL at the send
    // boundary the same way product_media URLs are resolved.
    const chartImageUrl = chart.imagePath.startsWith('/')
      ? chart.imagePath
      : `/${chart.imagePath}`;
    return [
      {
        text: 'Надсилаю вам розмірну сітку 💛',
        sendNow: true,
        imageUrls: [chartImageUrl],
      },
    ];
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
      confirm_last_in_stock: 'confirm_selection',
      decline_selection: 'decline_selection',
      collect_checkout_info: 'start_checkout',
      order_confirmed_ask_delivery: 'ask_delivery',
      confirm_order: 'confirm_order',
      answer_delivery: 'answer_faq',
      answer_payment: 'answer_faq',
      out_of_stock: 'show_products',
      ask_variant_choice: 'ask_variant_choice',
      variant_not_available: 'ask_variant_choice',
      product_not_found: 'ai_fallback_clarification',
      ask_continue_or_checkout: 'ask_continue_or_checkout',
    };
    return map[scenario] ?? scenario;
  }

  // ─── Variant auto-select helper ────────────────────────────────

  /**
   * When a variant is auto-selected (or explicitly matched from user input),
   * update BOTH primaryIntent and recommendedAction so the template engine
   * routes to the correct confirmation scenario. If only recommendedAction
   * is updated, INTENT_TO_SCENARIO wins first and the scenario stays wrong.
   *
   * - User explicitly asked about a variant (size/color) → confirm_variant_available
   * - Generic auto-select (single variant, no user preference) → confirm_choice
   */
  private setConfirmIntent(
    classification: ClassificationResult,
    userColor?: string,
    userSize?: string,
  ): void {
    const isVariantQuery = !!(userSize || userColor);
    classification.primaryIntent = isVariantQuery ? 'confirm_variant_available' : 'confirm_choice';
    classification.recommendedAction = isVariantQuery ? 'confirm_variant_available' : 'confirm_selection';
  }

  /**
   * Serialize variants for memory.availableVariants. 5.5c has multiple
   * sites with this same shape; centralized here to prevent drift when the
   * per-variant memory entry shape evolves.
   */
  private buildAvailableVariantsList(
    variants: Array<{ id: string; color: string | null; size: string | null; imageUrl?: string | null }>,
  ): Array<{ id: string; name: string; color: string | null; size: string | null; imageUrl: string | null }> {
    return variants.map((v) => ({
      id: v.id,
      name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
      color: v.color,
      size: v.size,
      imageUrl: v.imageUrl ?? null,
    }));
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

  // ─── Color/size translation (UA ↔ EN) ─────────────────────────

  private static readonly COLOR_TRANSLATIONS: Record<string, string> = {
    // UA → EN
    'чорний': 'black', 'чорна': 'black', 'чорне': 'black',
    'білий': 'white', 'біла': 'white', 'біле': 'white',
    'синій': 'blue', 'синя': 'blue', 'синє': 'blue',
    'червоний': 'red', 'червона': 'red', 'червоне': 'red',
    'зелений': 'green', 'зелена': 'green', 'зелене': 'green',
    'сірий': 'grey', 'сіра': 'grey', 'сіре': 'grey',
    'рожевий': 'pink', 'рожева': 'pink', 'рожеве': 'pink',
    'бежевий': 'beige', 'бежева': 'beige', 'бежеве': 'beige',
    'коричневий': 'brown', 'коричнева': 'brown', 'коричневе': 'brown',
    'жовтий': 'yellow', 'жовта': 'yellow', 'жовте': 'yellow',
    'фіолетовий': 'purple', 'фіолетова': 'purple', 'фіолетове': 'purple',
    'помаранчевий': 'orange', 'помаранчева': 'orange', 'помаранчеве': 'orange',
    'кремовий': 'cream', 'кремова': 'cream', 'кремове': 'cream',
    'хакі': 'khaki',
    // EN → UA (reverse for when options are in UA but user types in EN)
    'black': 'чорний', 'white': 'білий', 'blue': 'синій',
    'red': 'червоний', 'green': 'зелений', 'grey': 'сірий', 'gray': 'сірий',
    'pink': 'рожевий', 'beige': 'бежевий', 'brown': 'коричневий',
    'yellow': 'жовтий', 'purple': 'фіолетовий', 'orange': 'помаранчевий',
    'cream': 'кремовий', 'khaki': 'хакі',
  };

  /** Translate user color input and return all possible forms (original + translated). */
  private translateColor(input: string): string[] {
    const lower = input.toLowerCase().trim();
    const translated = ReplyEngineService.COLOR_TRANSLATIONS[lower];
    return translated ? [lower, translated] : [lower];
  }

  // ─── Product search helpers ────────────────────────────────────

  private matchVariant(
    variants: Array<{ id: string; name: string; color?: string | null; size?: string | null }>,
    userColor?: string,
    userSize?: string,
  ): { id: string; name: string } | null {
    if (!userColor && !userSize) return null;

    const colorForms = userColor ? this.translateColor(userColor) : [];
    const normalize = (s: string) => s.toLowerCase().replace(/[ʼ'ьіїєґ]/g, '').replace(/\s+/g, ' ').trim();

    let candidates = variants;

    // Step 1: Filter by color if provided AND variants have a color axis.
    // Color-in-title products (e.g. "JACK&JONES Темно-сині карго штани")
    // have variants with `color: null` — the color is baked into the
    // product title and was already used by upstream search to narrow to
    // this product. The userColor here is then redundant; skip the
    // color filter and let size match against all in-stock variants.
    const hasColorAxis = variants.some(v => v.color);
    if (userColor && colorForms.length > 0 && hasColorAxis) {
      const colorMatched = variants.filter(v => {
        if (!v.color) return false;
        const vc = v.color.toLowerCase().trim();
        const vcNorm = normalize(vc);
        // Canonicalize variant.color too (e.g. "Чорний" → ["чорний","black"])
        // so Ukrainian gender variants ("чорна" feminine ≠ "Чорний" masculine)
        // still match through their shared "black" canonical translation.
        const variantColorForms = this.translateColor(v.color);
        return colorForms.some(f =>
          vc === f ||
          vcNorm === normalize(f) ||
          vc.includes(f) ||
          f.includes(vc) ||
          variantColorForms.some(vf => vf === f),
        );
      });
      if (colorMatched.length > 0) {
        candidates = colorMatched;
      } else {
        return null; // Color not found
      }
    }

    // Step 2: Filter by size if provided
    if (userSize) {
      const us = userSize.toLowerCase().trim();
      const sizeMatched = candidates.filter(v => {
        if (!v.size) return false;
        return v.size.toLowerCase().trim() === us;
      });
      if (sizeMatched.length > 0) {
        candidates = sizeMatched;
      } else if (userColor) {
        // Color matched but size didn't → not available in this color
        return null;
      } else {
        // Only size provided, try partial/normalized match
        const sizeFuzzy = candidates.filter(v => {
          if (!v.size) return false;
          return normalize(v.size).includes(normalize(us)) || normalize(us).includes(normalize(v.size));
        });
        if (sizeFuzzy.length > 0) {
          candidates = sizeFuzzy;
        } else {
          return null;
        }
      }
    }

    // Step 3: Single candidate → return
    if (candidates.length === 1) return candidates[0];

    // Step 4: Multiple candidates → can't pick one confidently
    return null;
  }

  // ─── Two-step variant helpers ──────────────────────────────────

  /**
   * Match user input against a list of option values (colors or sizes).
   * Returns the original option string if matched, null otherwise.
   */
  private matchColorOrSize(userInput: string, options: string[]): string | null {
    const input = userInput.toLowerCase().trim();
    if (!input || options.length === 0) return null;

    // Expand input with translated forms (UA↔EN)
    const inputForms = this.translateColor(userInput);

    // 1. Exact match (including translated forms)
    const exact = options.find(o => inputForms.some(f => o.toLowerCase() === f));
    if (exact) return exact;

    // 2. Partial/contains (check all translated forms)
    const partial = options.filter(o =>
      inputForms.some(f => o.toLowerCase().includes(f) || f.includes(o.toLowerCase())),
    );
    if (partial.length === 1) return partial[0];

    // 3. Normalized match
    const normalize = (s: string) => s.toLowerCase().replace(/[ʼ'ьіїєґ]/g, '').replace(/\s+/g, ' ').trim();
    const normalizedInput = normalize(input);
    const normMatch = options.find(o => normalize(o) === normalizedInput);
    if (normMatch) return normMatch;

    // 4. Word overlap
    const inputWords = normalizedInput.split(/[\s-]+/);
    const wordMatches = options
      .map(o => {
        const labelWords = normalize(o).split(/[\s-]+/);
        const overlap = inputWords.filter(w =>
          labelWords.some(lw => lw.includes(w) || w.includes(lw)),
        ).length;
        return { option: o, overlap };
      })
      .filter(x => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (wordMatches.length === 1) return wordMatches[0].option;
    if (wordMatches.length > 1 && wordMatches[0].overlap > wordMatches[1].overlap) {
      return wordMatches[0].option;
    }

    return null;
  }

  // ─── Pre-qualification helpers ────────────────────────────────

  /**
   * Mid-flow size-help branch. Fires when the user asks for size advice
   * AFTER product selection has already pinned context — the case the
   * existing pre-qualify gate cannot reach because it requires
   * selectionState ∉ {awaiting_variant, awaiting_confirmation} and no
   * productName entity. Triggers on:
   *   - raw measurements ("180 80", "170 см 60 кг"), OR
   *   - intent='ask_recommendation' + a strict size-context keyword.
   * Generic "що порадите?" without size words deliberately falls
   * through so existing recommendation/AI-fallback path runs.
   */
  private async maybeMidFlowSizeHelp(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    const { memory, effectiveConfig, mediaProductData } = ctx;
    const classification = ctx.classification;
    const flowConfig = effectiveConfig?.flowConfig as any;

    if (!flowConfig?.preQualify?.enabled) return null;

    const numericChart = flowConfig.sizeChart as
      | Record<string, { heightMin: number; heightMax: number; weightMin: number; weightMax: number }>
      | undefined;
    if (!numericChart || Object.keys(numericChart).length === 0) return null;

    // Anti-triggers
    if (memory.orderCreated) return null;
    if (memory.cartItems?.length) return null;
    if (mediaProductData) return null;
    if (classification.entities.size) return null;
    if (classification.slotAction === 'correction') return null;
    if (
      memory.selectionState === 'awaiting_confirmation' &&
      classification.slotAction === 'confirmation'
    ) {
      return null;
    }

    // Trigger: raw measurements OR ask_recommendation + strict size keyword
    const fields = (flowConfig.preQualify.fields as string[]) ?? ['height', 'weight'];
    const hasMeasurements = this.looksLikePreQualifyData(input.messageText, fields);
    const isRecommendation = classification.primaryIntent === 'ask_recommendation';
    const SIZE_KEYWORDS = ['розмір', 'зріст', 'вага'];
    const lowerText = input.messageText.toLowerCase();
    const hasSizeKeyword = SIZE_KEYWORDS.some((k) => lowerText.includes(k));

    if (!hasMeasurements && !(isRecommendation && hasSizeKeyword)) return null;

    ctx.trace.push('handlePreQualifyClothing: mid-flow size-help branch fired');

    // Keyword-only (no numbers): user asked for size help → confirm and
    // ask for measurements.
    if (!hasMeasurements) {
      memory.lastAction = 'asked_pre_qualify';
      memory.awaitingField = 'pre_qualify_data';
      return {
        decision: ReplyDecision.Reply,
        reply: { text: ASK_FOR_MEASUREMENTS_HELP, sendNow: true },
        handoff: { required: false, reason: null },
        stateUpdate: { contextJson: memory as any },
      };
    }

    const params = this.extractPreQualifyData(input.messageText, fields);
    const recommended = this.recommendSize(params, numericChart);
    if (!recommended) return null; // defensive — fall through

    memory.preQualifyData = params;
    memory.preQualifyCollected = true;
    memory.recommendedSize = recommended;
    memory.lastAction = 'recommended_size';

    // Path A — product already selected: refine variant selection.
    if (memory.selectedProductId) {
      const productData = await this.availabilityService.findAllByProductId(
        memory.selectedProductId,
      );
      if (productData.length > 0) {
        const product = productData[0];
        const matching = product.variants.filter(
          (v) => v.effectiveAvailable > 0 && v.size && v.size.toLowerCase() === recommended.toLowerCase(),
        );
        if (matching.length === 1) {
          // Single matched variant → confirm
          const v = matching[0];
          memory.selectedVariantId = v.id;
          memory.selectedVariantName = [v.color, v.size].filter(Boolean).join(', ') || recommended;
          memory.selectedColor = v.color ?? undefined;
          memory.selectedSize = v.size ?? recommended;
          memory.selectionState = 'awaiting_confirmation';
          classification.primaryIntent = 'confirm_selection';
          classification.recommendedAction = 'confirm_selection';
          ctx.trace.push(
            `mid-flow: single variant matched (${memory.selectedVariantName}) → confirm_selection`,
          );
          return null;
        }
        if (matching.length > 1) {
          // Multiple colors at the recommended size → ask color
          memory.selectedSize = recommended;
          memory.selectedColor = undefined;
          memory.variantStep = 'color';
          memory.selectionState = 'awaiting_variant';
          memory.availableVariants = this.buildAvailableVariantsList(matching);
          classification.primaryIntent = 'ask_color_for_size';
          classification.recommendedAction = 'ask_color_for_size';
          ctx.trace.push(
            `mid-flow: ${matching.length} colors at size ${recommended} → ask_color_for_size`,
          );
          return null;
        }
        // No matching variants at recommended size → fall through to
        // show_products with size filter (Path B) for the broader catalog.
      }
    }

    // Path B — no product selected (or selected product has no match at
    // recommended size): route to show_products with size filter applied
    // by the existing post-search filter.
    if (!classification.entities.category && memory.selectedCategory) {
      classification.entities.category = memory.selectedCategory;
    }
    classification.primaryIntent = 'category_browse';
    classification.recommendedAction = 'show_products';
    classification.dialogueAct = 'general_chat';
    ctx.trace.push(`mid-flow: no product context → show_products filtered by ${recommended}`);
    return null;
  }

  /**
   * Check if text contains data that looks like pre-qualify info (numbers for height/weight).
   */
  private looksLikePreQualifyData(text: string, fields: string[]): boolean {
    if (!fields || fields.length === 0) return false;
    // Look for at least one number in the text (height/weight are numeric)
    const numbers = text.match(/\d+/g);
    if (!numbers || numbers.length === 0) return false;
    // Check if numbers are in a plausible range for height/weight
    const plausible = numbers.some(n => {
      const num = parseInt(n, 10);
      return (num >= 30 && num <= 250); // covers weight 30-150, height 100-250
    });
    return plausible;
  }

  /**
   * Extract pre-qualify data (height/weight) from user message.
   */
  private extractPreQualifyData(text: string, fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    const numbers = text.match(/\d+/g) || [];

    if (fields.includes('height') && fields.includes('weight')) {
      // Try to parse "180/75", "зріст 180, вага 75", "180 75", etc.
      const nums = numbers.map(n => parseInt(n, 10)).filter(n => n > 0);
      if (nums.length >= 2) {
        // Assume larger number is height, smaller is weight
        const sorted = [...nums].sort((a, b) => b - a);
        result['height'] = String(sorted[0]);
        result['weight'] = String(sorted[1]);
      } else if (nums.length === 1) {
        // Single number — guess based on value
        const n = nums[0];
        if (n >= 100) {
          result['height'] = String(n);
        } else {
          result['weight'] = String(n);
        }
      }
    } else {
      // Generic: assign numbers to fields in order
      for (let i = 0; i < fields.length && i < numbers.length; i++) {
        result[fields[i]] = numbers[i];
      }
    }

    return result;
  }

  private recommendSize(
    params: Record<string, string>,
    sizeChart: Record<string, { heightMin: number; heightMax: number; weightMin: number; weightMax: number }>,
  ): string | null {
    const height = parseInt(params.height, 10);
    const weight = parseInt(params.weight, 10);
    if (!height && !weight) return null;

    let bestSize: string | null = null;
    let bestScore = -1;

    for (const [size, range] of Object.entries(sizeChart)) {
      let score = 0;
      if (height && height >= range.heightMin && height <= range.heightMax) score++;
      if (weight && weight >= range.weightMin && weight <= range.weightMax) score++;

      if (score > bestScore) {
        bestScore = score;
        bestSize = size;
      }
    }

    // Score 0 for all → fallback: find closest by height
    if (bestScore === 0 && height) {
      let closestDist = Infinity;
      for (const [size, range] of Object.entries(sizeChart)) {
        const mid = (range.heightMin + range.heightMax) / 2;
        const dist = Math.abs(height - mid);
        if (dist < closestDist) {
          closestDist = dist;
          bestSize = size;
        }
      }
    }

    return bestSize;
  }

  // ─── Product search helpers ────────────────────────────────────

  private shouldSearchProducts(classification: ClassificationResult, memory: AssistantMemory): boolean {
    // Product + variant already confirmed and awaiting customer's "так" — no need to search
    // Exception: correction means user wants to change — must re-search to get productData for 5.5c
    if (memory.selectionState === 'awaiting_confirmation' && memory.selectedProductId && memory.selectedVariantId
        && classification.slotAction !== 'correction') {
      return false;
    }

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

  /**
   * Build the keyword list for product title/description ILIKE search.
   *
   * `entities.category` is intentionally NOT included here — category
   * routes through a dedicated `category` param on `searchProducts`,
   * which prefilters by the M2M (`product_categories` + `categories`)
   * with exact case-insensitive name match. Stuffing the category into
   * the keyword stream would re-introduce the substring-ILIKE false
   * positives the M2M routing was added to fix.
   *
   * Returns `[]` (empty) when no keywords are extracted; the caller
   * routes a category-only search via the `category` param.
   */
  private extractSearchKeywords(
    classification: ClassificationResult,
  ): string[] {
    const keywords: string[] = [];
    if (classification.entities.productName)
      keywords.push(classification.entities.productName);
    if (classification.entities.color)
      keywords.push(classification.entities.color);
    return keywords;
  }

  /**
   * Narrow a candidate productData list to those whose title contains EVERY
   * non-stopword term from `productName`. Returns the original list unchanged
   * when:
   *   - productName has no meaningful terms (all short/stopwords),
   *   - no product survives the narrowing (avoid over-pruning),
   *   - narrowing is a no-op (every product still matches).
   * Used by `searchAndFilterProducts` to recover productName specificity that
   * the OR-of-keywords search strategy in `searchProducts` discards.
   *
   * Cross-script note: matching is plain `String.includes`, no Cyrillic↔Latin
   * transliteration. Brand names like "JACK&JONES" won't match Cyrillic
   * "джек/джонс" — handled by the over-narrow guard returning the original
   * list. Translit support is a follow-up.
   */
  private narrowByProductName(
    productData: ProductSearchResult[],
    productName: string,
  ): ProductSearchResult[] {
    const PRODUCT_NAME_STOP_WORDS = new Set([
      'енд', 'and', '&', 'і', 'та', 'the', 'of', 'для',
    ]);
    const nameTerms = productName
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length > 2 && !PRODUCT_NAME_STOP_WORDS.has(t));
    if (nameTerms.length === 0) return productData;
    const narrowed = productData.filter(p => {
      const titleLower = p.product.title.toLowerCase();
      return nameTerms.every(t => titleLower.includes(t));
    });
    if (narrowed.length === 0) return productData;
    return narrowed;
  }

  private async searchProducts(
    tenantId: string,
    conversationId: string,
    keywords: string[],
    category?: string,
  ): Promise<ProductSearchResult[] | undefined> {
    // Category-only path: classifier extracted a tenant category but
    // no productName/color. Fire one search keyed only by category.
    if (category && keywords.length === 0) {
      const results = await this.availabilityService.checkAll(tenantId, {
        query: '',
        category,
      });

      await this.auditService.log({
        tenantId,
        conversationId,
        type: AuditLogType.AvailabilityCheck,
        details: { keyword: '', category, productsFound: results.length },
      });

      if (results.length > 0) {
        return results.map((r) => ({
          product: r.product,
          variants: r.variants,
        }));
      }
      return undefined;
    }

    for (const keyword of keywords) {
      if (!keyword) continue;
      const results = await this.availabilityService.checkAll(tenantId, {
        query: keyword,
        category,
      });

      await this.auditService.log({
        tenantId,
        conversationId,
        type: AuditLogType.AvailabilityCheck,
        details: { keyword, category, productsFound: results.length },
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
    // variant_not_available is informational — the customer asked about a
    // variant we don't have while their previously-resolved variant is
    // still on the table. Don't reset selection state or clear the
    // variant id; let them confirm the originally offered variant on the
    // next turn. (Without this short-circuit, scenarioToAction maps
    // variant_not_available → 'ask_variant_choice', whose case below
    // wipes selectedVariantId and downgrades state to awaiting_variant —
    // and the engine then re-searches and may surface a DIFFERENT product.)
    if (templateResult?.scenario === 'variant_not_available') {
      memory.lastAction = 'told_variant_not_available';
      return;
    }

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
            imageUrl: v.imageUrl ?? null,
          }));
        }
        break;
      case 'confirm_variant_available':
        memory.lastAction = 'confirmed_product';
        memory.awaitingField = 'order_confirmation';
        memory.selectionState = 'awaiting_confirmation';
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
        memory.awaitingField = memory.variantStep === 'size' ? 'size_selection' : 'variant_selection';
        memory.selectionState = 'awaiting_variant';
        // Clear stale variant selection so next turn's 5.5c/5.5d can match fresh
        memory.selectedVariantId = undefined;
        memory.selectedVariantName = undefined;
        break;
      case 'answer_faq':
        memory.lastAction = 'answered_faq';
        break;
      case 'confirm_order':
        memory.lastAction = 'confirmed_order';
        memory.awaitingField = 'order_finalized';
        break;
      case 'ask_continue_or_checkout':
        memory.lastAction = 'asked_continue_or_checkout';
        memory.awaitingField = 'add_more_or_checkout';
        break;
    }
  }

  // ─── Build order payload from memory + classification ─────────

  private buildOrderPayload(
    input: ReplyEngineInput,
    memory: AssistantMemory,
    classification: ClassificationResult,
  ): OrderPayload | null {
    const cartItems = memory.cartItems ?? [];

    // Fallback to single product if no cart items (backward compatibility)
    if (cartItems.length === 0) {
      const productId = memory.selectedProductId;
      const variantId = memory.selectedVariantId;

      if (!productId || !variantId) {
        this.logger.warn(
          `Cannot build order payload: no cart items and missing productId=${productId} variantId=${variantId}`,
        );
        return null;
      }

      // Find variant price from available variants in memory
      let unitPrice = 0;
      let externalProductId: string | null = null;
      let externalVariantId: string | null = null;
      const variants = memory.availableVariants;
      if (Array.isArray(variants)) {
        const matchedVariant = variants.find((v) => v.id === variantId) as any;
        if (matchedVariant) {
          unitPrice = matchedVariant.price ?? 0;
          externalProductId = matchedVariant.externalProductId ?? null;
          externalVariantId = matchedVariant.externalVariantId ?? null;
        }
      }

      // Try to parse price from lastPresentedProducts if not found in variants
      if (unitPrice === 0 && memory.lastPresentedProducts?.length) {
        const priceStr = memory.lastPresentedProducts[0].price;
        const priceMatch = priceStr?.match(/[\d.]+/);
        if (priceMatch) {
          unitPrice = parseFloat(priceMatch[0]);
        }
      }

      cartItems.push({
        productId,
        variantId,
        externalProductId,
        externalVariantId,
        title: memory.selectedProductTitle ?? '',
        variantName: memory.selectedVariantName ?? '',
        price: unitPrice,
        currency: 'UAH',
      });
    }

    if (cartItems.length === 0) return null;

    const customerName = classification.entities.customerName ?? '';
    const phone = classification.entities.phone ?? '';
    const city = classification.entities.city ?? '';
    const deliveryBranch = classification.entities.deliveryBranch ?? '';

    // Build items from cart
    const items = cartItems.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      externalProductId: item.externalProductId,
      externalVariantId: item.externalVariantId,
      title: item.title,
      variantTitle: item.variantName,
      quantity: 1,
      unitPrice: item.price,
      currency: item.currency,
    }));

    return {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      customerId: input.state.conversationId,
      items,
      customerInfo: {
        fullName: customerName,
        phone,
        city,
        deliveryBranch,
      },
      source: 'instagram_ai',
    };
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

  private buildOrderStateContext(memory: AssistantMemory): string {
    if (memory.selectedProductId && (memory.selectionState === 'confirmed' || memory.lastAction === 'asked_delivery_details')) {
      return `\nORDER STATE: Active checkout — Product: ${memory.selectedProductTitle ?? 'unknown'} (${memory.selectedVariantName ?? ''}). Awaiting delivery details.`;
    }
    if (memory.selectedProductId) {
      return `\nORDER STATE: Product browsing — ${memory.selectedProductTitle ?? 'product selected'}, not yet confirmed for order.`;
    }
    return `\nORDER STATE: No active order. No product selected. Do NOT confirm any order.`;
  }

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
      `10. NEVER confirm an order, say "замовлення оформлено", "в обробці", "дані отримала", or imply an order exists unless ALL of these are true: selectedProductId exists, checkout is in progress, system is expecting delivery details.`,
      this.buildOrderStateContext(params.memory),
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
        return `${details || 'standard'}: ${v.price} ${formatCurrency(v.currency)} (${stock})`;
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

  // ─── Size chart handler ────────────────────────────────────────

  private async handleSizeChartRequest(
    input: ReplyEngineInput,
    ctx: ProcessingContext,
  ): Promise<ReplyEngineOutput | null> {
    if (ctx.classification.primaryIntent !== 'size_chart_request') return null;

    const memory = ctx.memory;
    const entities = ctx.classification.entities;

    // Resolve the visual chart up-front — both the help-style diversion and
    // the direct chart-ask flow attach it.
    let brand: string | null = null;
    let category: string | null = entities.category ?? memory.selectedCategory ?? null;

    const contextProductId =
      ctx.mediaProductData?.[0]?.product?.id ?? memory.selectedProductId ?? null;
    if (contextProductId) {
      const info = await this.sizeChartsService.getBrandAndCategoryForProduct(
        input.tenantId,
        contextProductId,
      );
      brand = info.brand ?? brand;
      category = info.category ?? category;
    }

    const chart = await this.sizeChartsService.resolveForContext(input.tenantId, {
      brand,
      category,
    });

    // Help-style requests ("Можете допомогти з розміром?") classify as
    // size_chart_request + dialogueAct='ask_recommendation'. Direct chart
    // asks ("розмірна сітка є?") classify as
    // size_chart_request + dialogueAct='ask_about_shown_products'. For
    // help-style requests in clothing with a structured numeric chart and
    // no prior measurements, ask for measurements (and attach the visual
    // chart as a secondary bubble so the user can also self-serve).
    const flowConfig = ctx.effectiveConfig?.flowConfig as any;
    const businessType = (flowConfig?.businessType as 'clothing' | 'cosmetics') ?? 'clothing';
    const numericChart = flowConfig?.sizeChart as
      | Record<string, { heightMin: number; heightMax: number; weightMin: number; weightMax: number }>
      | undefined;
    const askingForHelp = ctx.classification.dialogueAct === 'ask_recommendation';
    if (
      askingForHelp &&
      businessType === 'clothing' &&
      flowConfig?.preQualify?.enabled &&
      !memory.preQualifyCollected &&
      numericChart &&
      Object.keys(numericChart).length > 0
    ) {
      memory.lastAction = 'asked_pre_qualify';
      memory.awaitingField = 'pre_qualify_data';
      ctx.trace.push('size_chart_request: help-style → ask for measurements');

      let extraReplies: ReplyEngineOutput['extraReplies'];
      if (chart) {
        const chartUrl = chart.imagePath.startsWith('/')
          ? chart.imagePath
          : `/${chart.imagePath}`;
        extraReplies = [
          {
            text: 'Надсилаю вам розмірну сітку 💛',
            sendNow: true,
            imageUrls: [chartUrl],
          },
        ];
      }
      return {
        decision: ReplyDecision.Reply,
        reply: { text: ASK_FOR_MEASUREMENTS_HELP, sendNow: true },
        extraReplies,
        handoff: { required: false, reason: null },
        stateUpdate: { contextJson: memory as any },
      };
    }

    if (!chart) {
      ctx.trace.push('size_chart_request: no chart matched → silent handoff');
      this.logToFile({
        event: 'size_chart_no_match',
        conversationId: input.conversationId,
        inbound: input.messageText,
        brand,
        category,
      });
      return this.doHandoff(input, 'size_chart_not_available');
    }

    const variables: Record<string, string> = { name: chart.name };
    if (brand) variables.brand = brand;

    const rendered = await this.templateEngine.renderCustomScenario(
      input.tenantId,
      'show_size_chart',
      variables,
    );
    const text = rendered?.text ?? 'Ось наша розмірна сітка 💛';
    const publicUrl = this.sizeChartsService.publicUrl(chart.imagePath);

    ctx.trace.push(
      `size_chart_request: resolved chart ${chart.id} (brand=${brand ?? '-'}, category=${category ?? '-'})`,
    );

    await this.auditService.log({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      type: AuditLogType.AiDecision,
      details: {
        decision: ReplyDecision.Reply,
        intent: 'size_chart_request',
        templateId: rendered?.templateId ?? 'no_template',
        chartId: chart.id,
      },
    });

    this.logToFile({
      event: 'size_chart_sent',
      conversationId: input.conversationId,
      inbound: input.messageText,
      chartId: chart.id,
      chartName: chart.name,
      imageUrl: publicUrl,
      brand,
      category,
    });

    return {
      decision: ReplyDecision.Reply,
      reply: { text, sendNow: true, imageUrls: [publicUrl] },
      handoff: { required: false, reason: null },
      stateUpdate: null,
      templateScenario: rendered?.scenario ?? 'show_size_chart',
    };
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
