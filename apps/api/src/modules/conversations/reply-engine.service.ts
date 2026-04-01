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
import { OrderPayload } from '../orders/interfaces/order-payload.interface';
import { InstagramContentService } from '../channels/instagram/instagram-content.service';

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
  handoff: { required: boolean; reason: string | null };
  stateUpdate: Partial<ConversationState> | null;
  orderPayload?: OrderPayload;
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
    private readonly instagramContentService: InstagramContentService,
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

    // 4.5. Post-order state management
    const POST_ORDER_PASSIVE_INTENTS = ['gratitude', 'thanks', 'small_talk', 'confirmation', 'goodbye'];

    if (memory.orderCreated) {
      if (POST_ORDER_PASSIVE_INTENTS.includes(classification.primaryIntent)) {
        // Passive message after order → acknowledge without resetting state
        this.logger.log('Post-order passive intent: ' + classification.primaryIntent);
        const ackReply = 'Будь ласка 💛 Якщо захочете ще щось — пишіть!';
        const stateUpdate: Partial<ConversationState> = {};
        stateUpdate.contextJson = memory as any;
        return {
          decision: ReplyDecision.Reply,
          reply: { text: ackReply, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate,
        };
      }

      if (
        classification.slotAction === 'new_inquiry' ||
        classification.slotAction === 'adds_to_cart' ||
        ['product_inquiry', 'ready_to_order', 'category_browse', 'greeting'].includes(classification.primaryIntent)
      ) {
        // New inquiry after completed order → reset ALL state including cart
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
        memory.preQualifyCollected = undefined;
        memory.preQualifyData = undefined;
        this.logger.log('State reset: new inquiry after completed order');
      }
    }

    // 4.6 Handle adds_to_cart: customer wants to add another product to cart
    if (classification.slotAction === 'adds_to_cart' && !memory.orderCreated) {
      // Keep cartItems, reset current selection for new product
      memory.selectedProductId = undefined;
      memory.selectedProductTitle = undefined;
      memory.selectedVariantId = undefined;
      memory.selectedVariantName = undefined;
      memory.selectionState = undefined;
      memory.availableVariants = undefined;
      memory.variantStep = null;
      memory.selectedColor = undefined;
      this.logger.log('adds_to_cart: clearing selection for new product, keeping cart');
    }

    // 4.7 Media reference resolution
    let mediaProductData: ProductSearchResult[] | undefined;

    if (input.mediaReference) {
      if (input.mediaReference.type === 'customer_photo') {
        return this.doHandoff(input, 'customer_photo', 'Секунду, зараз перевірю 💛');
      }

      const mapping = await this.instagramContentService.findByMediaId(
        input.tenantId,
        input.mediaReference.mediaId,
      );

      if (mapping?.productId) {
        // Known product — load full product data for use in product search step
        mediaProductData = await this.availabilityService.findAllByProductId(
          mapping.productId,
          mapping.variantId ?? undefined,
        );
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
    }

    // 4.8 Pre-qualification step (e.g., ask height/weight for clothing stores)
    const preQualifyFlowConfig = (effectiveConfig?.flowConfig as any);
    const awaitingPreQualify = memory.lastAction === 'asked_pre_qualify' && memory.awaitingField === 'pre_qualify_data';
    if (
      preQualifyFlowConfig?.preQualify?.enabled &&
      !memory.preQualifyCollected &&
      !memory.orderCreated &&
      (awaitingPreQualify || this.shouldSearchProducts(classification, memory))
    ) {
      // Check if this message contains pre-qualify data
      if (
        awaitingPreQualify ||
        classification.primaryIntent === 'provide_details' ||
        this.looksLikePreQualifyData(input.messageText, preQualifyFlowConfig.preQualify.fields)
      ) {
        memory.preQualifyData = this.extractPreQualifyData(input.messageText, preQualifyFlowConfig.preQualify.fields);
        memory.preQualifyCollected = true;
        this.logger.log(`Pre-qualify data collected: ${JSON.stringify(memory.preQualifyData)}`);

        // Size recommendation from size chart
        const sizeChart = preQualifyFlowConfig.sizeChart as Record<string, { heightMin: number; heightMax: number; weightMin: number; weightMax: number }> | undefined;
        if (sizeChart && memory.preQualifyData) {
          const recommended = this.recommendSize(memory.preQualifyData, sizeChart);
          if (recommended) {
            memory.recommendedSize = recommended;
            this.logger.log(`Recommended size: ${recommended}`);
            // Prepend size recommendation to the response
            memory.lastAction = 'recommended_size';
          }
        }
        // Restore category from memory so product search can proceed
        if (!classification.entities.category && memory.selectedCategory) {
          classification.entities.category = memory.selectedCategory;
        }
        // Override intent to ensure shouldSearchProducts returns true
        classification.primaryIntent = 'category_browse';
        classification.recommendedAction = 'show_products';
        // Continue to product search below
      } else {
        // Ask for pre-qualify data — save category for use after pre-qualify response
        if (classification.entities.category) {
          memory.selectedCategory = classification.entities.category;
        }
        const prompt = preQualifyFlowConfig.preQualify.prompt || 'Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛';
        memory.lastAction = 'asked_pre_qualify';
        memory.awaitingField = 'pre_qualify_data';
        return {
          decision: ReplyDecision.Reply,
          reply: { text: prompt, sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate: { contextJson: memory as any },
        };
      }
    }

    // 5. Product search if needed (based on classification entities/keywords)
    let productData: ProductSearchResult[] | undefined;
    let isFirstProductPresentation = false;

    if (mediaProductData && mediaProductData.length > 0) {
      productData = mediaProductData;
      isFirstProductPresentation = !memory.lastPresentedProducts?.length;
    }

    const needsSearch = !productData && this.shouldSearchProducts(classification, memory);

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

      // Filter by recommended size if available
      if (productData && productData.length > 0 && memory.recommendedSize) {
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

        // Store available variant names for the selected/target product
        const targetProduct = memory.selectedProductId
          ? productData.find(p => p.product.id === memory.selectedProductId) ?? (productData.length === 1 ? productData[0] : null)
          : productData.length === 1 ? productData[0] : null;

        if (targetProduct) {
          memory.availableVariants = targetProduct.variants
            .filter((v) => v.effectiveAvailable > 0)
            .map((v) => ({
              id: v.id,
              name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
              color: v.color ?? null,
              size: v.size ?? null,
            }));

          memory.selectedProductId = targetProduct.product.id;
          memory.selectedProductTitle = targetProduct.product.title;
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

      memory.cartItems.push({
        productId: memory.selectedProductId!,
        variantId: memory.selectedVariantId!,
        externalProductId: null, // resolved at order creation from DB
        externalVariantId: null,
        title: memory.selectedProductTitle!,
        variantName: memory.selectedVariantName!,
        price: itemPrice,
        currency: itemCurrency,
      });

      // Ask if customer wants to add more items or proceed to checkout
      memory.selectionState = 'cart_item_added';
      classification.primaryIntent = 'confirm_choice';
      classification.recommendedAction = 'ask_continue_or_checkout';
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
      (classification.slotAction === 'confirmation' || classification.primaryIntent === 'ready_to_order') &&
      memory.selectionState === 'cart_item_added' &&
      memory.cartItems?.length &&
      memory.lastAction === 'asked_continue_or_checkout' // Ensure this is a NEW confirmation, not the same turn as 5.5a
    ) {
      memory.selectionState = 'confirmed';
      classification.primaryIntent = 'ready_to_order';
      classification.recommendedAction = 'start_checkout';
      classification.conversationStage = 'checkout_started';
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
      memory.selectionState === 'awaiting_confirmation' &&
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
        classification.recommendedAction = 'confirm_selection';
        this.logger.log('Single variant → auto-selected, proceeding to confirm_selection');
      } else if (hasBothDimensions && !memory.variantStep) {
        // Two-step: start with color
        memory.selectionState = 'awaiting_variant';
        memory.variantStep = 'color';
        classification.primaryIntent = 'ask_variant_choice';
        classification.recommendedAction = 'ask_variant_choice';
        this.logger.log(`Two-step variant: starting with color (${variants.length} variants)`);
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

      if (memory.variantStep === 'color' && (userColor || (!userSize && input.messageText.trim()))) {
        // User picked a color — match it
        const colorInput = userColor || input.messageText.trim();
        const colorVariants = variants.filter((v: any) => v.color);
        const uniqueColors = [...new Set(colorVariants.map((v: any) => v.color))] as string[];
        const matchedColor = this.matchColorOrSize(colorInput, uniqueColors);

        if (matchedColor) {
          memory.selectedColor = matchedColor;
          // Check if sizes exist for this color
          const sizesForColor = variants.filter(
            (v: any) => v.color && v.color.toLowerCase() === matchedColor.toLowerCase() && v.size,
          );
          if (sizesForColor.length > 1) {
            // Multiple sizes — ask for size
            memory.variantStep = 'size';
            classification.primaryIntent = 'ask_variant_choice';
            classification.recommendedAction = 'ask_variant_choice';
            this.logger.log(`Two-step variant: color=${matchedColor}, asking for size (${sizesForColor.length} options)`);
          } else if (sizesForColor.length === 1) {
            // Only one size for this color — auto-select
            memory.selectedVariantId = sizesForColor[0].id;
            memory.selectedVariantName = sizesForColor[0].name;
            memory.variantStep = null;
            memory.selectionState = 'awaiting_confirmation';
            classification.recommendedAction = 'confirm_selection';
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
              classification.recommendedAction = 'confirm_selection';
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
            classification.recommendedAction = 'confirm_selection';
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

    // 5.5c Variant check for fills_missing_slot: user picked a product, check if variant needed
    if (
      classification.slotAction === 'fills_missing_slot' &&
      memory.selectedProductId &&
      !memory.selectedVariantId &&
      !memory.variantStep && // Don't interfere with two-step variant selection
      productData && productData.length === 1
    ) {
      const variants = productData[0].variants.filter(v => v.effectiveAvailable > 0);

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
          memory.availableVariants = variants.map(v => ({
            id: v.id,
            name: [...new Set([v.color, v.size].filter(Boolean))].join(', ') || 'standard',
            color: v.color,
            size: v.size,
          }));
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
      if (memory.recommendedSize) {
        const sizeFiltered = variants.filter(
          (v: any) => !v.size || v.size.toLowerCase() === memory.recommendedSize!.toLowerCase(),
        );
        if (sizeFiltered.length > 0) effectiveVariants = sizeFiltered;
      }

      const userColor = classification.entities.color;
      const userSize = classification.entities.size;

      if (effectiveVariants.length === 1) {
        // Single variant (or single after size filter) → auto-select
        memory.selectedVariantId = effectiveVariants[0].id;
        memory.selectedVariantName = effectiveVariants[0].name;
        memory.selectionState = 'awaiting_confirmation';
        classification.recommendedAction = 'confirm_selection';
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
          classification.recommendedAction = 'confirm_selection';
          this.logger.log(`5.5d: Variant matched from user input: ${matched.name}`);
        } else {
          memory.selectionState = 'awaiting_variant';
          if (memory.recommendedSize) memory.variantStep = 'color';
          classification.primaryIntent = 'ask_variant_choice';
          classification.recommendedAction = 'ask_variant_choice';
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
        this.logger.log(`5.5d: Product picked, ${effectiveVariants.length} variants — asking user (variantStep=${memory.variantStep ?? 'all'})`);
      }
    }

    // 6. Template Engine: select + render template
    const recentTemplateIds = memory.recentTemplateIds ?? [];
    const flowConfig = effectiveConfig?.flowConfig as Record<string, unknown> | undefined;
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
      finalReply = templateResult.text;
      usedTemplateId = templateResult.templateId;
      // Use the template's actual scenario for memory tracking (may differ from classifier due to stage gates)
      actualAction = this.scenarioToAction(templateResult.scenario);

      // Prepend size recommendation if just collected
      if (memory.recommendedSize && memory.lastAction === 'recommended_size') {
        finalReply = `За вашими параметрами рекомендую розмір ${memory.recommendedSize} 💛\n\n${finalReply}`;
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
      // Check if product-related intent but no products found → handoff
      const productIntents = ['product_inquiry', 'ready_to_order', 'availability_check', 'category_browse', 'ask_price'];
      if (productIntents.includes(classification.primaryIntent) && (!productData || productData.length === 0)) {
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

    // 10. Check if this is a confirmed order → emit CreateDraftOrder decision
    // Idempotency: only create order once per conversation
    // Use orderCreated flag only — lastAction is already updated by updateMemoryFromAction above
    const alreadyOrdered = memory.orderCreated === true;
    if (actualAction === 'confirm_order' && !alreadyOrdered) {
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
      templateId: usedTemplateId ?? 'ai_fallback',
      templateScenario: templateResult?.scenario ?? 'ai_fallback',
      stage: classification.conversationStage,
      action: classification.recommendedAction,
      memory,
    });

    return {
      decision: ReplyDecision.Reply,
      reply: { text: finalReply, sendNow: true, imageUrls: templateResult?.imageUrls },
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
      ask_continue_or_checkout: 'ask_continue_or_checkout',
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
    const input = (userColor || userSize || '').toLowerCase().trim();
    if (!input) return null;

    const normalize = (s: string) => s.toLowerCase().replace(/[ʼ'ьіїєґ]/g, '').replace(/\s+/g, ' ').trim();
    const getLabel = (v: typeof variants[0]) => (v.color || v.size || v.name || '').toLowerCase();

    // 1. Exact match
    const exact = variants.find(v => getLabel(v) === input);
    if (exact) return exact;

    // 2. Partial/contains
    const partial = variants.filter(v => getLabel(v).includes(input) || input.includes(getLabel(v)));
    if (partial.length === 1) return partial[0];

    // 3. Normalized match
    const normalizedInput = normalize(input);
    const normMatch = variants.find(v => normalize(getLabel(v)) === normalizedInput);
    if (normMatch) return normMatch;

    // 4. Word overlap — split on spaces AND hyphens
    const inputWords = normalizedInput.split(/[\s-]+/);
    const wordMatches = variants
      .map(v => {
        const labelWords = normalize(getLabel(v)).split(/[\s-]+/);
        const overlap = inputWords.filter(w =>
          labelWords.some(lw => lw.includes(w) || w.includes(lw)),
        ).length;
        return { variant: v, overlap };
      })
      .filter(x => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (wordMatches.length === 1) return wordMatches[0].variant;
    if (wordMatches.length > 1 && wordMatches[0].overlap > wordMatches[1].overlap) {
      return wordMatches[0].variant;
    }

    // 5. Fuzzy (Levenshtein ≤ 3)
    const levenshtein = (a: string, b: string): number => {
      const matrix: number[][] = [];
      for (let i = 0; i <= a.length; i++) matrix[i] = [i];
      for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
      }
      return matrix[a.length][b.length];
    };

    const fuzzy = variants
      .map(v => ({ variant: v, dist: levenshtein(normalizedInput, normalize(getLabel(v))) }))
      .filter(x => x.dist <= 3)
      .sort((a, b) => a.dist - b.dist);
    if (fuzzy.length === 1) return fuzzy[0].variant;
    if (fuzzy.length > 1 && fuzzy[0].dist < fuzzy[1].dist) return fuzzy[0].variant;

    return null; // No confident match — ask user
  }

  // ─── Two-step variant helpers ──────────────────────────────────

  /**
   * Match user input against a list of option values (colors or sizes).
   * Returns the original option string if matched, null otherwise.
   */
  private matchColorOrSize(userInput: string, options: string[]): string | null {
    const input = userInput.toLowerCase().trim();
    if (!input || options.length === 0) return null;

    // 1. Exact match
    const exact = options.find(o => o.toLowerCase() === input);
    if (exact) return exact;

    // 2. Partial/contains
    const partial = options.filter(o => o.toLowerCase().includes(input) || input.includes(o.toLowerCase()));
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
        memory.awaitingField = memory.variantStep === 'size' ? 'size_selection' : 'variant_selection';
        memory.selectionState = 'awaiting_variant';
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
