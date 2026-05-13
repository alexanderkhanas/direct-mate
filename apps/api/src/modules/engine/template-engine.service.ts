import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseTemplate } from './entities/response-template.entity';
import { PhraseBlock } from './entities/phrase-block.entity';
import { FaqItem } from './entities/faq-item.entity';
import { ClassificationResult, AssistantMemory } from './classifier.service';
import { formatCurrency, sortSizes } from '../../common/format';
import { localizeColor, localizeColorList } from './color-i18n';

// ─── Interfaces ──────────────────────────────────────────────────

export interface ProductSearchResult {
  product: {
    id: string;
    title: string;
    imageUrl?: string | null;
    category?: string | null;
    /**
     * AI-enriched search blob from `products.search_keywords`. Mirrors
     * the column verbatim so engine-layer matchers (e.g. the
     * color-in-title fallback in `reply-engine.service.ts`) can OR
     * against the same surface that `availabilityService.searchAllByTitle`
     * uses, instead of being limited to the title alone.
     */
    searchKeywords?: string | null;
  };
  variants: Array<{
    id: string;
    size: string | null;
    color: string | null;
    price: number;
    currency: string;
    effectiveAvailable: number;
    imageUrl: string | null;
  }>;
}

export interface TemplateRenderResult {
  text: string;
  templateId: string;
  scenario: string; // The actual scenario that was rendered
  matchedVariantId?: string; // If variant was matched during variable building
  imageUrls?: string[]; // Product images to send alongside the text
}

// ─── Intent-to-scenario mapping ──────────────────────────────────

const INTENT_TO_SCENARIO: Record<string, string> = {
  greeting: 'greeting',
  product_inquiry: 'show_products',
  category_browse: 'show_products',
  ask_price: 'show_price',
  ask_recommendation: 'recommend_product',
  ready_to_order: 'collect_checkout_info',
  confirm_choice: 'confirm_selection',
  confirm_last_in_stock: 'confirm_last_in_stock',
  confirm_selection_last_in_stock: 'confirm_selection_last_in_stock',
  confirm_variant_available: 'confirm_variant_available',
  decline_selection: 'decline_selection',
  provide_details: 'collect_checkout_info',
  delivery_question: 'answer_delivery',
  payment_question: 'answer_payment',
  availability_check: 'show_products',
  ask_variant_choice: 'ask_variant_choice',
  ask_size_for_color: 'ask_size_for_color',
  ask_color_for_size: 'ask_color_for_size',
  variant_not_available: 'variant_not_available',
  product_not_found: 'product_not_found',
  size_chart_request: 'show_size_chart',
  narrowing_no_match: 'narrowing_no_match',
};

// ─── Action-to-scenario fallback mapping ─────────────────────────

const ACTION_TO_SCENARIO: Record<string, string> = {
  show_products: 'show_products',
  recommend: 'recommend_product',
  start_checkout: 'collect_checkout_info',
  ask_delivery: 'order_confirmed_ask_delivery',
  confirm_selection: 'confirm_selection',
  confirm_selection_last_in_stock: 'confirm_selection_last_in_stock',
  confirm_variant_available: 'confirm_variant_available',
  show_price: 'show_price',
  greet: 'greeting',
  ask_variant_choice: 'ask_variant_choice',
  ask_size_for_color: 'ask_size_for_color',
  ask_color_for_size: 'ask_color_for_size',
  variant_not_available: 'variant_not_available',
  product_not_found: 'product_not_found',
  ask_continue_or_checkout: 'ask_continue_or_checkout',
  narrowing_no_match: 'narrowing_no_match',
};

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class TemplateEngineService {
  private readonly logger = new Logger(TemplateEngineService.name);

  constructor(
    @InjectRepository(ResponseTemplate)
    private readonly templateRepo: Repository<ResponseTemplate>,
    @InjectRepository(PhraseBlock)
    private readonly phraseBlockRepo: Repository<PhraseBlock>,
    @InjectRepository(FaqItem)
    private readonly faqItemRepo: Repository<FaqItem>,
  ) {}

  /**
   * Main render method: selects template, interpolates variables, returns reply.
   * Returns null if no matching template is found.
   */
  async render(params: {
    tenantId: string;
    classification: ClassificationResult;
    productData?: ProductSearchResult[];
    memory: AssistantMemory;
    recentTemplateIds: string[];
    isFirstProductPresentation?: boolean;
    messageText?: string;
    flowConfig?: Record<string, unknown>;
  }): Promise<TemplateRenderResult | null> {
    const { tenantId, classification, productData, memory, recentTemplateIds, isFirstProductPresentation, messageText, flowConfig } =
      params;

    // 0. If products were just found for the first time, force show_products
    //    EXCEPT when a variant was already auto-selected (user specified exactly
    //    what they want and we matched it) — in that case go straight to confirmation.
    const variantAlreadyResolved =
      memory.selectionState === 'awaiting_confirmation' &&
      !!memory.selectedVariantId;
    if (isFirstProductPresentation && productData && productData.length > 0 && !variantAlreadyResolved) {
      this.logger.log('First product presentation — forcing show_products scenario');
      return this.renderScenario(tenantId, 'show_products', classification, productData, memory, recentTemplateIds, flowConfig);
    }

    // 1. Check if this is an FAQ question first
    const faqResult = await this.tryFaqMatch(tenantId, classification, messageText);
    if (faqResult) return faqResult;

    // 2. Determine scenario from classification
    let scenario = this.resolveScenario(classification, memory);
    if (!scenario) {
      this.logger.debug(
        `No scenario mapped for intent=${classification.primaryIntent} action=${classification.recommendedAction}`,
      );
      return null;
    }

    // 2.5 Stage gate: prevent jumping ahead in conversation flow
    scenario = this.enforceStageGates(scenario, memory, classification, productData);

    // 3. Render the resolved scenario
    return this.renderScenario(tenantId, scenario, classification, productData, memory, recentTemplateIds, flowConfig);
  }

  private async renderScenario(
    tenantId: string,
    scenario: string,
    classification: ClassificationResult,
    productData?: ProductSearchResult[],
    memory?: AssistantMemory,
    recentTemplateIds: string[] = [],
    flowConfig?: Record<string, unknown>,
  ): Promise<TemplateRenderResult | null> {
    this.logger.debug(`renderScenario: scenario=${scenario} tenantId=${tenantId?.slice(0, 8)}`);

    const templates = await this.templateRepo.find({
      where: { tenantId, scenario, active: true },
      order: { priority: 'DESC' },
    });

    if (templates.length === 0) {
      // confirm_last_in_stock is an optional scenario — tenants opt in
      // by authoring a template. Without one, fall back to the standard
      // confirm_selection so the engine still resolves the conversation.
      if (scenario === 'confirm_last_in_stock') {
        this.logger.log(
          'confirm_last_in_stock: no template authored — falling back to confirm_selection',
        );
        return this.renderScenario(
          tenantId,
          'confirm_selection',
          classification,
          productData,
          memory,
          recentTemplateIds,
          flowConfig,
        );
      }
      // confirm_selection_last_in_stock: optional, opt-in via authored
      // template. Fall back to confirm_variant_available (the non-urgent
      // sibling) so customer still gets a sensible reply.
      if (scenario === 'confirm_selection_last_in_stock') {
        this.logger.log(
          'confirm_selection_last_in_stock: no template authored — falling back to confirm_variant_available',
        );
        return this.renderScenario(
          tenantId,
          'confirm_variant_available',
          classification,
          productData,
          memory,
          recentTemplateIds,
          flowConfig,
        );
      }
      // decline_selection: short hardcoded ack when no template authored.
      // Same architectural pattern as the offer-decline ack noted in
      // CLAUDE.md — response space is tiny, determinism + zero LLM cost
      // outweighs tonal variation. Tenants can override by authoring a
      // template under this scenario.
      if (scenario === 'decline_selection') {
        this.logger.log(
          'decline_selection: no template authored — emitting hardcoded ack',
        );
        return {
          text: 'Окей 💛 Як визначитесь — пишіть.',
          templateId: '__hardcoded_decline_selection__',
          scenario: 'decline_selection',
        };
      }
      this.logger.warn(`No active templates for scenario=${scenario}`);
      return null;
    }

    const variables = this.buildVariableMap(classification, productData, memory, flowConfig);
    if (scenario === 'ask_variant_choice' && variables['variant_type']) {
      variables['variant_type'] = variables['variant_type'].toLowerCase();
    }
    this.logger.debug(`renderScenario: ${templates.length} templates found, variables: ${Object.keys(variables).join(', ')}`);

    const viable = templates.filter((t) => this.hasRequiredVariables(t, variables));
    if (viable.length === 0) {
      const missing = templates.map((t) => {
        const req = (t.requiredVariables as string[]) || [];
        const miss = req.filter((v) => !variables[v]);
        return `${t.id.slice(0, 8)}(needs: ${miss.join(',')})`;
      });
      this.logger.warn(`No templates have all required variables for scenario=${scenario}. Missing: ${missing.join('; ')}`);

      // Fallback: if confirm_selection fails due to missing variant_name, try ask_variant_choice
      if (scenario === 'confirm_selection' && !variables['variant_name']) {
        this.logger.log('confirm_selection missing variant_name — falling back to ask_variant_choice');
        return this.renderScenario(tenantId, 'ask_variant_choice', classification, productData, memory, recentTemplateIds, flowConfig);
      }

      return null;
    }

    // Anti-repetition
    const recentSet = new Set(recentTemplateIds.slice(0, 5));
    let candidates = viable.filter((t) => !recentSet.has(t.id));
    if (candidates.length === 0) candidates = viable;

    const topPriority = candidates[0].priority;
    const topCandidates = candidates.filter((t) => t.priority === topPriority);
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    const text = this.interpolateTemplate(selected, variables);

    // Collect product image URLs for scenarios that show products
    const allProductScenarios = ['show_products'];
    const singleProductScenarios = ['confirm_selection', 'confirm_variant_available', 'confirm_selection_last_in_stock', 'recommend_product', 'ask_recommendation_from_shown'];
    const variantChoiceScenarios = ['ask_variant_choice', 'ask_size_for_color', 'ask_color_for_size'];
    const imageUrls: string[] = [];
    if (productData) {
      if (allProductScenarios.includes(scenario)) {
        // One image per product. With N products in a show_products turn
        // we send N images — predictable, matches the text (one row per
        // product), no per-color swatch noise. Per-color exploration
        // belongs in ask_variant_choice, where the customer has picked a
        // product and the per-color image set is meaningful.
        //
        // Picking which variant's image: prefer first in-stock variant,
        // then product-level image. The in-stock preference avoids URLs
        // pointing at unphotographed OOS SKUs.
        const seen = new Set<string>();
        for (const p of productData) {
          const inStock = p.variants.filter((v) => v.effectiveAvailable > 0);
          const url =
            inStock.find((v) => v.imageUrl)?.imageUrl ??
            p.product.imageUrl ??
            null;
          if (url && !seen.has(url)) {
            seen.add(url);
            imageUrls.push(url);
          }
        }
      } else if (singleProductScenarios.includes(scenario)) {
        // For single-product scenarios, prefer the selected variant's image if available.
        // Fall back to product's main image.
        const selectedVarId = variables['matched_variant_id'] || memory?.selectedVariantId;
        const first = productData[0];
        if (first) {
          const selectedVariant = selectedVarId
            ? first.variants.find((v) => v.id === selectedVarId)
            : null;
          const variantImage = selectedVariant?.imageUrl ?? null;
          if (variantImage) {
            imageUrls.push(variantImage);
          } else if (first.product.imageUrl) {
            imageUrls.push(first.product.imageUrl);
          }
        }
      } else if (variantChoiceScenarios.includes(scenario)) {
        // For variant-choice, attach one image per candidate variant (deduped).
        // Fallback: per-variant images → product image → no images.
        // Narrow by recommendedSize for the both-ambiguous case, and by the
        // user-provided axis for the partial-variant scenarios so the image
        // set matches the asked-about candidates.
        const first = productData[0];
        if (first) {
          let narrowed = first.variants;
          if (memory?.recommendedSize) {
            narrowed = narrowed.filter(
              (v) => !v.size || v.size.toLowerCase() === memory!.recommendedSize!.toLowerCase(),
            );
          }
          if (scenario === 'ask_size_for_color' && memory?.selectedColor) {
            narrowed = narrowed.filter(
              (v) => !v.color || v.color.toLowerCase() === memory!.selectedColor!.toLowerCase(),
            );
          }
          if (scenario === 'ask_color_for_size' && memory?.selectedSize) {
            narrowed = narrowed.filter(
              (v) => !v.size || v.size.toLowerCase() === memory!.selectedSize!.toLowerCase(),
            );
          }
          const inStock = narrowed.filter((v) => v.effectiveAvailable > 0);
          const candidates = inStock.length > 0 ? inStock : narrowed;
          const variantImages = candidates
            .map((v) => v.imageUrl)
            .filter((url): url is string => !!url);
          const dedupedVariantImages = Array.from(new Set(variantImages));
          if (dedupedVariantImages.length > 0) {
            imageUrls.push(...dedupedVariantImages);
          } else if (first.product.imageUrl) {
            imageUrls.push(first.product.imageUrl);
          }
        }
      }
    }

    return {
      text,
      templateId: selected.id,
      scenario,
      matchedVariantId: variables['matched_variant_id'],
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    };
  }

  /**
   * Render a scenario with an explicit variable bag, bypassing the standard
   * classification/product-based variable builder. Used for size_chart flows
   * where the variables (brand, name) come from a separate resolver rather
   * than from the classifier entities.
   */
  async renderCustomScenario(
    tenantId: string,
    scenario: string,
    variables: Record<string, string>,
  ): Promise<TemplateRenderResult | null> {
    const templates = await this.templateRepo.find({
      where: { tenantId, scenario, active: true },
      order: { priority: 'DESC' },
    });
    if (templates.length === 0) return null;

    const viable = templates.filter((t) => this.hasRequiredVariables(t, variables));
    if (viable.length === 0) return null;

    const selected = viable[0];
    const text = this.interpolateTemplate(selected, variables);
    return {
      text,
      templateId: selected.id,
      scenario,
    };
  }

  // ─── FAQ matching ──────────────────────────────────────────────

  private async tryFaqMatch(
    tenantId: string,
    classification: ClassificationResult,
    messageText?: string,
  ): Promise<TemplateRenderResult | null> {
    // Only check FAQ for question-type intents
    const faqIntents = [
      'delivery_question',
      'payment_question',
      'general_question',
    ];
    if (!faqIntents.includes(classification.primaryIntent)) return null;

    const faqItems = await this.faqItemRepo.find({
      where: { tenantId, active: true },
    });

    if (faqItems.length === 0) return null;

    // Match by intent keywords
    const intentKeywords: Record<string, string[]> = {
      delivery_question: [
        'delivery',
        'shipping',
        'доставка',
        'відправка',
        'нова пошта',
      ],
      payment_question: ['payment', 'оплата', 'як оплатити', 'передоплата'],
    };

    const keywords = intentKeywords[classification.primaryIntent] ?? [];
    // Use original message text for tag matching (falls back to entity values)
    const userMessage = (messageText || '').toLowerCase();

    for (const item of faqItems) {
      const tags = item.questionTags as string[];

      // Match by intent keywords
      const matchedByKeywords = tags.some(
        (tag) =>
          keywords.some((kw) => tag.toLowerCase().includes(kw.toLowerCase())) ||
          keywords.some((kw) => kw.toLowerCase().includes(tag.toLowerCase())),
      );

      // Match by FAQ tags against user's original message text
      const matchedByTags = tags.some(
        (tag) => userMessage.includes(tag.toLowerCase()),
      );

      if (matchedByKeywords || matchedByTags) {
        const faqScenario = tags.some(t => ['delivery', 'shipping', 'доставка', 'відправка'].includes(t.toLowerCase()))
          ? 'answer_delivery'
          : tags.some(t => ['payment', 'оплата'].includes(t.toLowerCase()))
          ? 'answer_payment'
          : 'faq';
        return { text: item.answerTemplate, templateId: item.id, scenario: faqScenario };
      }
    }

    return null;
  }

  // ─── Scenario resolution ───────────────────────────────────────

  private resolveScenario(
    classification: ClassificationResult,
    memory?: AssistantMemory,
  ): string | null {
    const intent = classification.primaryIntent;
    const action = classification.recommendedAction;
    const act = classification.dialogueAct;
    const entities = classification.entities;

    // Special case: cart item just added → ask continue or checkout
    if (memory?.selectionState === 'cart_item_added' && action === 'ask_continue_or_checkout') {
      return 'ask_continue_or_checkout';
    }

    // Special case: provide_details with actual delivery info → confirm order
    // BUT only if a product is already selected and checkout is in progress
    if (
      intent === 'provide_details' &&
      (entities.customerName || entities.phone || entities.city) &&
      memory?.selectedProductId &&
      (memory?.selectionState === 'confirmed' || memory?.lastAction === 'asked_delivery_details')
    ) {
      return 'confirm_order';
    }

    // Special case: ask_recommendation when 2+ products were shown.
    // The template literally says "З цих варіантів раджу…" — grammatically
    // wrong with a single product, so route 1-product case to
    // recommend_product (the singular default for ask_recommendation).
    if (
      (intent === 'ask_recommendation' || act === 'ask_recommendation') &&
      (memory?.lastPresentedProducts?.length ?? 0) >= 2 &&
      memory?.selectionState !== 'awaiting_variant'
    ) {
      return 'ask_recommendation_from_shown';
    }

    // Special case: confirm_choice after recommendation → confirm_selection
    if (
      act === 'confirm_choice' &&
      memory?.lastAction === 'gave_recommendation' &&
      memory?.selectionState !== 'awaiting_variant'
    ) {
      return 'confirm_selection';
    }

    // Special case: ready_to_order when product already selected
    if (intent === 'ready_to_order' && memory?.lastAction === 'confirmed_product') {
      return 'order_confirmed_ask_delivery';
    }

    // Try intent-based mapping
    const fromIntent = INTENT_TO_SCENARIO[intent];
    if (fromIntent) return fromIntent;

    // Then try action-based mapping
    const fromAction = ACTION_TO_SCENARIO[action];
    if (fromAction) return fromAction;

    return null;
  }

  // ─── Stage gate enforcement ──────────────────────────────────

  private enforceStageGates(
    scenario: string,
    memory: AssistantMemory,
    classification: ClassificationResult,
    productData?: ProductSearchResult[],
  ): string {
    const hasProductShown = !!memory.lastPresentedProducts?.length;
    const hasProductsJustFound = !!productData && productData.length > 0;
    const selectionState = memory.selectionState;
    const slotAction = (classification as any).slotAction;
    const hasDeliveryInfo =
      !!classification.entities.customerName ||
      !!classification.entities.phone ||
      !!classification.entities.city;

    // ── FAST PATH: selection confirmed → allow checkout/order scenarios through
    if (selectionState === 'confirmed') {
      this.logger.debug(`Selection confirmed — allowing scenario: ${scenario}`);
      return scenario;
    }

    // ── FAST PATH: cart_item_added → allow ask_continue_or_checkout and checkout through
    if (selectionState === 'cart_item_added') {
      if (scenario === 'ask_continue_or_checkout' || scenario === 'collect_checkout_info' || scenario === 'order_confirmed_ask_delivery') {
        this.logger.debug(`Cart item added — allowing scenario: ${scenario}`);
        return scenario;
      }
    }

    // ── HARD CHECKOUT GATE ──────────────────────────────────────
    // Cannot enter checkout unless selection is fully confirmed
    if (['collect_checkout_info', 'order_confirmed_ask_delivery'].includes(scenario)) {
      if (!memory.selectedProductId) {
        this.logger.debug('Checkout blocked: missing_product_selection');
        return hasProductShown ? 'show_products' : 'show_products';
      }
      if (!memory.selectedVariantId) {
        this.logger.debug('Checkout blocked: missing_variant_selection');
        return 'ask_variant_choice';
      }
      this.logger.debug('Checkout blocked: selection_not_confirmed');
      return 'confirm_selection';
    }

    // ── SELECTION FLOW GATES ────────────────────────────────────

    // If products just found but not shown yet, always show first
    if (hasProductsJustFound && !hasProductShown) {
      if (['confirm_selection', 'recommend_product', 'confirm_order', 'ask_variant_choice'].includes(scenario)) {
        this.logger.debug(`Stage gate: ${scenario} blocked — products found but not shown yet`);
        return 'show_products';
      }
    }

    // Correction: user corrects variant/product → re-confirm, don't advance
    if (slotAction === 'correction') {
      if (selectionState === 'awaiting_confirmation') {
        this.logger.debug('Stage gate: correction received — re-confirming selection');
        return 'confirm_selection';
      }
    }

    // Can't confirm selection if no products were shown
    if (scenario === 'confirm_selection' && !hasProductShown && !hasProductsJustFound) {
      this.logger.debug('Stage gate: confirm_selection blocked — no products shown yet');
      return 'show_products';
    }

    // Can't confirm order if no delivery details provided
    if (scenario === 'confirm_order' && !hasDeliveryInfo) {
      this.logger.debug('Stage gate: confirm_order blocked — no delivery info');
      return 'collect_checkout_info';
    }

    // Can't recommend from shown if nothing was shown
    if (scenario === 'ask_recommendation_from_shown' && !hasProductShown) {
      this.logger.debug('Stage gate: recommendation blocked — no products shown');
      return 'show_products';
    }

    return scenario;
  }

  // ─── Variable map builder ──────────────────────────────────────

  private buildVariableMap(
    classification: ClassificationResult,
    productData?: ProductSearchResult[],
    memory?: AssistantMemory,
    flowConfig?: Record<string, unknown>,
  ): Record<string, string> {
    const vars: Record<string, string> = {};

    // From entities
    if (classification.entities.productName)
      vars['product_name'] = classification.entities.productName;
    if (classification.entities.category)
      vars['category'] = classification.entities.category;
    if (classification.entities.color)
      vars['color'] = localizeColor(classification.entities.color);
    if (classification.entities.size)
      vars['size'] = classification.entities.size;
    // Memory fallback: when user provided color/size in a prior turn but
    // didn't repeat it on the current turn (e.g., asking back for the
    // missing axis), the partial-variant templates still need {color}
    // or {size} to render.
    if (!vars['color'] && memory?.selectedColor) {
      vars['color'] = localizeColor(memory.selectedColor);
    }
    if (!vars['size'] && memory?.selectedSize) {
      vars['size'] = memory.selectedSize;
    }
    // Auto-selected variant fallback: 5.5d/5.5m/5.5b auto-pick a single
    // in-stock variant and store the result on memory.selectedVariantId
    // + memory.availableVariants. Pull color/size from that record so
    // templates like confirm_last_in_stock ("лише розмір {size}") and
    // confirm_selection ("({color}, {size})") render with the resolved
    // dimensions even when the customer never typed them.
    if (
      (!vars['color'] || !vars['size']) &&
      memory?.selectedVariantId &&
      Array.isArray(memory.availableVariants)
    ) {
      const av = (memory.availableVariants as Array<{
        id: string;
        color?: string | null;
        size?: string | null;
      }>).find((v) => v.id === memory.selectedVariantId);
      if (av) {
        if (!vars['color'] && av.color) vars['color'] = localizeColor(av.color);
        if (!vars['size'] && av.size) vars['size'] = av.size;
      }
    }
    if (classification.entities.customerName)
      vars['customer_name'] = classification.entities.customerName;
    // NOTE: variant_name is set ONLY from matched product data or memory, not from raw entities
    // This prevents confirming a variant that doesn't exist in the catalog.
    // Source depends on the selection state at render time (state transitions before template runs):
    //   awaiting_confirmation → memory.selectedVariantName (variant was just matched, not yet added)
    //   cart_item_added       → cartItems.at(-1).variantName (5.5a already moved the state and added the item)
    if (!vars['variant_name'] && memory?.selectedVariantName && memory?.selectionState === 'awaiting_confirmation') {
      vars['variant_name'] = memory.selectedVariantName;
    } else if (!vars['variant_name'] && memory?.selectionState === 'cart_item_added' && (memory?.cartItems as any[])?.length) {
      vars['variant_name'] = (memory.cartItems as any[]).at(-1)?.variantName;
    }

    // Requested variant (for variant_not_available scenario)
    if (memory?.requestedVariant) {
      vars['requested_variant'] = memory.requestedVariant;
    }

    // From memory (fallback for recommendation scenarios)
    if (!vars['product_name'] && memory?.selectedProductTitle) {
      vars['product_name'] = memory.selectedProductTitle;
    }
    if (!vars['product_name'] && memory?.lastPresentedProducts?.length) {
      vars['product_name'] = memory.lastPresentedProducts[0].title;
    }
    if (!vars['reason']) {
      vars['reason'] = 'чудова якість та гарні відгуки';
    }
    // Price from memory (for recommendations when no product data in current turn)
    if (!vars['price'] && memory?.lastPresentedProducts?.length) {
      vars['price'] = memory.lastPresentedProducts[0].price;
    }

    // From product data
    if (productData && productData.length > 0) {
      const first = productData[0];
      if (!vars['product_name']) vars['product_name'] = first.product.title;

      // Build price string
      const prices = [
        ...new Set(
          first.variants.map((v) => `${v.price} ${formatCurrency(v.currency)}`),
        ),
      ];
      vars['price'] = prices.join(' / ');

      // Build smart product list for show_products scenario
      vars['product_list'] = this.formatProductList(productData, memory?.recommendedSize);

      // Build variants string for single product (deduplicated)
      // When recommendedSize is set, only show colors (sizes already determined)
      const suppressSizes = !!memory?.recommendedSize;
      const allVariants = first.variants
        .filter((v) => v.effectiveAvailable > 0)
        .map((v) => suppressSizes
          ? localizeColor(v.color)
          : [...new Set([localizeColor(v.color), v.size].filter(Boolean))].join(', '))
        .filter(Boolean);
      const uniqueVariants = [...new Set(allVariants)];
      if (uniqueVariants.length > 0) {
        vars['variants'] = uniqueVariants.join(', ');
      }

      // Build variant_name — hybrid matching against user's requested color/size
      // Skip if memory already provided the confirmed variant (memory is authoritative —
      // fuzzy matching could otherwise corrupt it, e.g. levenshtein('m','l')=1 matches L)
      const userColor = classification.entities.color ?? '';
      const userSize = classification.entities.size ?? '';
      const userVariantInput = userColor || userSize;

      if (!vars['variant_name'] && userVariantInput) {
        const inStockVariants = first.variants.filter((v) => v.effectiveAvailable > 0);
        const match = this.matchVariant(userVariantInput, inStockVariants);
        if (match) {
          const variantDetail = [localizeColor(match.variant.color), match.variant.size].filter(Boolean).join(', ');
          vars['variant_name'] = variantDetail;
          vars['matched_variant_id'] = match.variant.id;
          vars['variant_match_confidence'] = String(match.confidence);
        }
        // NO fallback to first variant — if no match, variant_name stays unset
        // This forces ask_variant_choice template
      } else if (first.variants.length === 1 && !vars['variant_name']) {
        // Single variant product — auto-select
        const only = first.variants[0];
        if (only.effectiveAvailable > 0) {
          const variantDetail = [localizeColor(only.color), only.size].filter(Boolean).join(', ');
          if (variantDetail) vars['variant_name'] = variantDetail;
          vars['matched_variant_id'] = only.id;
        }
      }
      // If multiple variants and no user input → variant_name stays unset → ask_variant_choice

      // Build variant_list for ask_variant_choice scenario (deduplicated)
      // Two-step variant selection: show only colors or only sizes based on variantStep
      if (first.variants.length > 1) {
        const inStockVars = first.variants.filter((v) => v.effectiveAvailable > 0);

        if (suppressSizes) {
          // Pre-qualify recommended a size — show colors only since size is fixed.
          const colors = [...new Set(inStockVars.map((v) => v.color).filter(Boolean))] as string[];
          vars['variant_type'] = 'Відтінки';
          vars['variant_list'] = localizeColorList(colors);
        } else if (memory?.variantStep === 'color') {
          // Two-step color step: group available sizes per color so the user
          // sees what's in stock for each color before picking.
          // If user already picked a size (ask_color_for_size flow), narrow
          // colors to those that have that size in stock.
          let colorCandidates = inStockVars;
          if (memory?.selectedSize) {
            colorCandidates = colorCandidates.filter(
              (v) => v.size && v.size.toLowerCase() === memory!.selectedSize!.toLowerCase(),
            );
          }
          const colorGroups = new Map<string, string[]>();
          for (const v of colorCandidates) {
            if (!v.color) continue;
            if (!colorGroups.has(v.color)) colorGroups.set(v.color, []);
            if (v.size && !colorGroups.get(v.color)!.includes(v.size)) {
              colorGroups.get(v.color)!.push(v.size);
            }
          }
          vars['variant_type'] = 'Відтінки';
          vars['variant_list'] = Array.from(colorGroups.entries())
            .map(([color, sizes]) => sizes.length ? `${localizeColor(color)} (${sortSizes(sizes).join(', ')})` : localizeColor(color))
            .join(', ');
        } else if (memory?.variantStep === 'size') {
          // Show only sizes filtered by selected color
          const selectedColor = memory?.selectedColor;
          const filteredVars = selectedColor
            ? inStockVars.filter((v) => v.color && v.color.toLowerCase() === selectedColor.toLowerCase())
            : inStockVars;
          const sizes = [...new Set(filteredVars.map((v) => v.size).filter(Boolean))] as string[];
          vars['variant_type'] = 'Розміри';
          vars['variant_list'] = sortSizes(sizes).join(', ');
        } else {
          const variantType = this.detectVariantType(first.variants);
          vars['variant_type'] = variantType;
          const hasColors = inStockVars.some(v => v.color);
          const hasSizes = inStockVars.some(v => v.size);

          if (hasColors && hasSizes) {
            // Group by color: "Чорний: S, M, L, XL\nБілий: S, M, L, XL"
            const colorGroups = new Map<string, string[]>();
            for (const v of inStockVars) {
              if (v.color) {
                if (!colorGroups.has(v.color)) colorGroups.set(v.color, []);
                if (v.size && !colorGroups.get(v.color)!.includes(v.size)) {
                  colorGroups.get(v.color)!.push(v.size);
                }
              }
            }
            vars['variant_list'] = Array.from(colorGroups.entries())
              .map(([color, sizes]) => sizes.length ? `${localizeColor(color)}: ${sortSizes(sizes).join(', ')}` : localizeColor(color))
              .join('\n');
          } else {
            const variantNames = inStockVars
              .map(v => [...new Set([localizeColor(v.color), v.size].filter(Boolean))].join(', '))
              .filter(Boolean);
            vars['variant_list'] = [...new Set(variantNames)].join(', ');
          }
        }
      }
    }

    // From memory: variant_list fallback (if not built from productData)
    const suppressSizesFromMemory = !!memory?.recommendedSize;
    if (!vars['variant_list'] && Array.isArray(memory?.availableVariants) && memory.availableVariants.length > 0) {
      if (suppressSizesFromMemory) {
        const colors = [...new Set(memory.availableVariants.map((v: any) => v.color).filter(Boolean))] as string[];
        vars['variant_list'] = localizeColorList(colors);
        vars['variant_type'] = 'Відтінки';
      } else if (memory?.variantStep === 'color') {
        let candidates = memory.availableVariants;
        if (memory?.selectedSize) {
          candidates = candidates.filter(
            (v: any) => v.size && v.size.toLowerCase() === memory!.selectedSize!.toLowerCase(),
          );
        }
        const colorGroups = new Map<string, string[]>();
        for (const v of candidates as any[]) {
          if (!v.color) continue;
          if (!colorGroups.has(v.color)) colorGroups.set(v.color, []);
          if (v.size && !colorGroups.get(v.color)!.includes(v.size)) {
            colorGroups.get(v.color)!.push(v.size);
          }
        }
        vars['variant_list'] = Array.from(colorGroups.entries())
          .map(([color, sizes]) => sizes.length ? `${localizeColor(color)} (${sortSizes(sizes).join(', ')})` : localizeColor(color))
          .join(', ');
        vars['variant_type'] = 'Відтінки';
      } else if (memory?.variantStep === 'size') {
        const selectedColor = memory?.selectedColor;
        const filteredVars = selectedColor
          ? memory.availableVariants.filter((v: any) => v.color && v.color.toLowerCase() === selectedColor.toLowerCase())
          : memory.availableVariants;
        const sizes = [...new Set(filteredVars.map((v: any) => v.size).filter(Boolean))] as string[];
        vars['variant_list'] = sortSizes(sizes).join(', ');
        vars['variant_type'] = 'Розміри';
      } else {
        // memory.availableVariants[i].name is a pre-built "Color, Size"
        // string (see reply-engine.service.ts mappers). Re-tokenize so
        // we can localize the color half before re-emitting.
        vars['variant_list'] = [...new Set(
          (memory.availableVariants as Array<{ color?: string | null; size?: string | null; name: string }>)
            .map((v) => {
              const detail = [...new Set([localizeColor(v.color), v.size].filter(Boolean))].join(', ');
              return detail || v.name;
            })
        )].join(', ');
        if (!vars['variant_type']) {
          vars['variant_type'] = this.detectVariantType(
            memory.availableVariants.map((v: any) => ({ color: v.color, size: v.size })) as any,
          );
        }
      }
    }

    // From memory
    if (memory?.lastPresentedProducts?.length) {
      if (!vars['product_name']) {
        vars['product_name'] = memory.lastPresentedProducts[0].title;
      }
      if (!vars['price']) {
        vars['price'] = memory.lastPresentedProducts[0].price;
      }
    }
    if (memory?.selectedCategory && !vars['category']) {
      vars['category'] = memory.selectedCategory;
    }

    // Default reason if not provided (for recommendation templates)
    if (!vars['reason']) {
      vars['reason'] = 'чудова якість та гарні відгуки';
    }

    // Build order summary from cart items (multi-product) or single product
    if (memory?.cartItems?.length) {
      const lines = memory.cartItems.map((item, i) =>
        `${memory!.cartItems!.length > 1 ? `${i + 1}. ` : ''}${item.title} (${item.variantName})\nЦіна: ${item.price} ${formatCurrency(item.currency)}`
      );
      const total = memory.cartItems.reduce((sum, item) => sum + item.price, 0);

      const summaryParts = [...lines];
      if (total > 0 && memory.cartItems.length > 1) {
        summaryParts.push(`Всього: ${total} ${formatCurrency(memory.cartItems[0].currency)}`);
      }
      if (classification.entities.customerName)
        summaryParts.push(`ПІБ: ${classification.entities.customerName}`);
      if (classification.entities.phone)
        summaryParts.push(`Телефон: ${classification.entities.phone}`);
      if (classification.entities.city) {
        let delivery = classification.entities.city;
        if (classification.entities.deliveryBranch)
          delivery += `, відділення ${classification.entities.deliveryBranch}`;
        summaryParts.push(`Доставка: ${delivery}`);
      }
      if (summaryParts.length > 0) {
        vars['order_summary'] = summaryParts.join('\n');
      }
    } else {
      // Fallback: single product summary from entities + memory
      const summaryParts: string[] = [];
      if (vars['product_name']) summaryParts.push(vars['product_name']);
      if (vars['price']) summaryParts.push(`Ціна: ${vars['price']}`);
      if (classification.entities.customerName)
        summaryParts.push(`ПІБ: ${classification.entities.customerName}`);
      if (classification.entities.phone)
        summaryParts.push(`Телефон: ${classification.entities.phone}`);
      if (classification.entities.city) {
        let delivery = classification.entities.city;
        if (classification.entities.deliveryBranch)
          delivery += `, відділення ${classification.entities.deliveryBranch}`;
        summaryParts.push(`Доставка: ${delivery}`);
      }
      if (summaryParts.length > 0) {
        vars['order_summary'] = summaryParts.join('\n');
      }
    }

    return vars;
  }

  // ─── Product list formatter ────────────────────────────────────

  private formatProductList(productData: ProductSearchResult[], recommendedSize?: string): string {
    if (!productData || productData.length === 0) return '';

    // When recommendedSize is set, sizes are already determined by pre-qualify — hide them from display
    const suppressSizes = !!recommendedSize;

    // Collect all prices to check if they're the same
    const allPrices: number[] = [];
    const allCurrencies = new Set<string>();
    for (const p of productData) {
      for (const v of p.variants) {
        if (v.effectiveAvailable > 0) {
          allPrices.push(v.price);
          allCurrencies.add(v.currency);
        }
      }
    }
    const uniquePrices = [...new Set(allPrices)];
    const currency = [...allCurrencies][0] || 'UAH';
    const samePriceForAll = uniquePrices.length === 1;

    // Detect what type of variants we have (color, size, etc.)
    const variantType = this.detectVariantType(productData[0].variants);

    const lines: string[] = [];
    let idx = 1;

    // When the list shows multiple products, every entry renders in
    // the multi-line block (title / Відтінки / Розміри / Ціна) so the
    // reply scans uniformly. The inline shortcut stays only for the
    // single-product case (rare in show_products; usually those route
    // to confirm_selection or ask_variant_choice).
    const multiProduct = productData.length > 1;

    for (const p of productData) {
      const inStock = p.variants.filter((v) => v.effectiveAvailable > 0);
      if (inStock.length === 0) continue;

      // Product name line
      let productLine = `${idx}. ${p.product.title}`;

      // Deduplicate variants when suppressing sizes (multiple size variants with same color collapse)
      const displayVariants = suppressSizes
        ? this.deduplicateByColor(inStock)
        : inStock;

      // Inline shortcut: single product overall AND single in-stock variant.
      if (!multiProduct && displayVariants.length === 1) {
        const v = displayVariants[0];
        const detail = suppressSizes
          ? localizeColor(v.color)
          : [...new Set([localizeColor(v.color), v.size].filter(Boolean))].join(', ');
        if (!samePriceForAll) {
          productLine += detail ? ` (${detail}) — ${v.price} ${formatCurrency(v.currency)}` : ` — ${v.price} ${formatCurrency(v.currency)}`;
        } else if (detail) {
          productLine += ` (${detail})`;
        }
        lines.push(productLine);
      } else {
        lines.push(productLine);

        if (suppressSizes) {
          // Only show colors when sizes are pre-determined
          const uniqueColors = [...new Set(displayVariants.map((v) => v.color).filter(Boolean))] as string[];
          if (uniqueColors.length > 0) {
            lines.push(`Відтінки: ${localizeColorList(uniqueColors)}`);
          }
        } else {
          // Check if variants have BOTH color and size populated
          const hasColors = displayVariants.some((v) => v.color);
          const hasSizes = displayVariants.some((v) => v.size);

          if (hasColors && hasSizes) {
            // Group sizes per color. When every color shares the same
            // size set (uniform matrix — including single-color), emit
            // two clean lines (Відтінки / Розміри). When sizes vary
            // across colors, fall back to per-color paren so the
            // customer sees which sizes are missing where.
            const colorGroups = new Map<string, string[]>();
            for (const v of displayVariants) {
              if (v.color) {
                if (!colorGroups.has(v.color)) colorGroups.set(v.color, []);
                if (v.size && !colorGroups.get(v.color)!.includes(v.size)) {
                  colorGroups.get(v.color)!.push(v.size);
                }
              }
            }
            const sizeSignatures = new Set(
              Array.from(colorGroups.values()).map((sizes) => [...sizes].sort().join('|')),
            );
            if (sizeSignatures.size === 1) {
              const colors = localizeColorList(Array.from(colorGroups.keys()));
              const sizes = sortSizes(Array.from(colorGroups.values())[0] ?? []).join(', ');
              lines.push(`Відтінки: ${colors}`);
              if (sizes) lines.push(`Розміри: ${sizes}`);
            } else {
              const grouped = Array.from(colorGroups.entries())
                .map(([color, sizes]) => sizes.length ? `${localizeColor(color)} (${sortSizes(sizes).join(', ')})` : localizeColor(color))
                .join(', ');
              lines.push(`Відтінки: ${grouped}`);
            }
          } else {
            // Single dimension — use detected type label
            const variantNames = displayVariants
              .map((v) => [...new Set([localizeColor(v.color), v.size].filter(Boolean))].join(', '))
              .filter(Boolean);
            const uniqueVariantNames = [...new Set(variantNames)];

            if (uniqueVariantNames.length > 0) {
              const label = variantType;
              // If the single dimension is sizes (no colors), apply size sort.
              const ordered =
                label === 'Розміри' ? sortSizes(uniqueVariantNames) : uniqueVariantNames;
              lines.push(`${label}: ${ordered.join(', ')}`);
            }
          }
        }

        // Show per-product price only if different from others
        if (!samePriceForAll) {
          const productPrices = [...new Set(displayVariants.map((v) => v.price))];
          if (productPrices.length === 1) {
            lines.push(`Ціна: ${productPrices[0]} ${formatCurrency(currency)}`);
          } else {
            lines.push(`Ціна: від ${Math.min(...productPrices)} до ${Math.max(...productPrices)} ${formatCurrency(currency)}`);
          }
        }
      }

      // Add empty line between products for readability (except last)
      lines.push('');
      idx++;
    }

    // Remove trailing empty line
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    // Append shared price line if all same
    if (samePriceForAll && uniquePrices.length > 0) {
      lines.push('');
      lines.push(`Усі по ${uniquePrices[0]} ${formatCurrency(currency)}.`);
    }

    return lines.join('\n');
  }

  /** Collapse variants with the same color into one (pick first of each color) */
  private deduplicateByColor(
    variants: ProductSearchResult['variants'],
  ): ProductSearchResult['variants'] {
    const seen = new Set<string>();
    return variants.filter((v) => {
      const key = (v.color || '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private detectVariantType(
    variants: Array<{ color: string | null; size: string | null }>,
  ): string {
    // Collect all non-null variant values
    const allValues: string[] = [];
    for (const v of variants) {
      if (v.color) allValues.push(v.color);
      if (v.size) allValues.push(v.size);
    }

    if (allValues.length === 0) return 'Варіанти';

    // Check if values look like colors (heuristic)
    const colorPatterns = /^(red|blue|green|black|white|pink|nude|rose|berry|coral|peach|mauve|terracotta|cherry|clear|прозор|червон|рож|чорн|біл|зелен|голуб|синь|корич|бежев|персик|вишнев|ягід|nude pink|rosewood|terracotta)/i;
    const sizePatterns = /^(\d+\s*(мл|ml|г|g|oz|sm|см)|\d+x\d+|xs|s|m|l|xl|xxl|one size)/i;
    const volumePatterns = /^\d+\s*(мл|ml)/i;

    let colorCount = 0;
    let sizeCount = 0;
    let volumeCount = 0;

    for (const val of allValues) {
      if (volumePatterns.test(val)) volumeCount++;
      else if (sizePatterns.test(val)) sizeCount++;
      else if (colorPatterns.test(val)) colorCount++;
    }

    // If most values match color patterns, or nothing matches size/volume → likely colors
    if (volumeCount > sizeCount && volumeCount > colorCount) return "Об'єм";
    if (sizeCount > colorCount) return 'Розміри';
    if (colorCount > 0) return 'Відтінки';

    // Default: check if values look like sizes (numbers) or colors (words)
    const hasNumbers = allValues.some((v) => /\d/.test(v));
    if (hasNumbers) return 'Розміри';

    return 'Відтінки';
  }

  // ─── Hybrid variant matching ────────────────────────────────────

  private matchVariant(
    userInput: string,
    variants: Array<{ id: string; color: string | null; size: string | null; effectiveAvailable: number }>,
  ): { variant: typeof variants[0]; confidence: number } | null {
    const input = userInput.toLowerCase().trim();
    if (!input) return null;

    const getLabel = (v: typeof variants[0]) => (v.color || v.size || '').toLowerCase();

    // 1. Exact match
    const exact = variants.find((v) => getLabel(v) === input);
    if (exact) return { variant: exact, confidence: 1.0 };

    // 2. Partial/contains match ("червон" in "ягідно-червоний")
    const partial = variants.filter(
      (v) => getLabel(v).includes(input) || input.includes(getLabel(v)),
    );
    if (partial.length === 1) return { variant: partial[0], confidence: 0.9 };

    // 3. Normalized match (strip common prefixes/suffixes)
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[ьіїєґ']/g, '').replace(/\s+/g, ' ').trim();
    const normalizedInput = normalize(input);
    const normMatch = variants.find((v) => normalize(getLabel(v)) === normalizedInput);
    if (normMatch) return { variant: normMatch, confidence: 0.85 };

    // 4. Word overlap match — "червоний" matches "Ягідно-червоний"
    const inputWords = normalizedInput.split(/[\s-]+/);
    const wordMatches = variants
      .map((v) => {
        const labelWords = normalize(getLabel(v)).split(/[\s-]+/);
        const overlap = inputWords.filter((w) =>
          labelWords.some((lw) => lw.includes(w) || w.includes(lw)),
        ).length;
        return { variant: v, overlap };
      })
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (wordMatches.length === 1) return { variant: wordMatches[0].variant, confidence: 0.8 };
    if (wordMatches.length > 1 && wordMatches[0].overlap > wordMatches[1].overlap) {
      return { variant: wordMatches[0].variant, confidence: 0.75 };
    }

    // 5. Levenshtein distance (fuzzy)
    const levenshtein = (a: string, b: string): number => {
      const matrix: number[][] = [];
      for (let i = 0; i <= a.length; i++) matrix[i] = [i];
      for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + cost,
          );
        }
      }
      return matrix[a.length][b.length];
    };

    const fuzzy = variants
      .map((v) => ({ variant: v, dist: levenshtein(normalizedInput, normalize(getLabel(v))) }))
      .filter((x) => x.dist <= 3)
      .sort((a, b) => a.dist - b.dist);
    if (fuzzy.length === 1) return { variant: fuzzy[0].variant, confidence: 0.7 };
    if (fuzzy.length > 1 && fuzzy[0].dist < fuzzy[1].dist) {
      return { variant: fuzzy[0].variant, confidence: 0.65 };
    }

    // 6. No confident match
    return null;
  }

  // ─── Variable availability check ──────────────────────────────

  private hasRequiredVariables(
    template: ResponseTemplate,
    variables: Record<string, string>,
  ): boolean {
    const required = template.requiredVariables as string[];
    if (!required || required.length === 0) return true;
    return required.every(
      (v) => variables[v] !== undefined && variables[v] !== '',
    );
  }

  // ─── Template interpolation ────────────────────────────────────

  private interpolateTemplate(
    template: ResponseTemplate,
    variables: Record<string, string>,
  ): string {
    const blocks = template.blocks as string[];
    const rendered = blocks.map((block) => this.interpolateBlock(block, variables));
    return rendered.join('\n');
  }

  private interpolateBlock(
    text: string,
    variables: Record<string, string>,
  ): string {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      if (variables[key] !== undefined && variables[key] !== '') {
        return variables[key];
      }
      // Safety net: strip unresolved variables instead of leaving literals
      this.logger.warn(`Unresolved template variable: ${match}`);
      return '';
    });
  }
}
