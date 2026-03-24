import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResponseTemplate } from './entities/response-template.entity';
import { PhraseBlock } from './entities/phrase-block.entity';
import { FaqItem } from './entities/faq-item.entity';
import { ClassificationResult, AssistantMemory } from './classifier.service';

// ─── Interfaces ──────────────────────────────────────────────────

export interface ProductSearchResult {
  product: { id: string; title: string };
  variants: Array<{
    id: string;
    size: string | null;
    color: string | null;
    price: number;
    currency: string;
    effectiveAvailable: number;
  }>;
}

export interface TemplateRenderResult {
  text: string;
  templateId: string;
  scenario: string; // The actual scenario that was rendered
  matchedVariantId?: string; // If variant was matched during variable building
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
  provide_details: 'collect_checkout_info',
  delivery_question: 'answer_delivery',
  payment_question: 'answer_payment',
  availability_check: 'show_products',
};

// ─── Action-to-scenario fallback mapping ─────────────────────────

const ACTION_TO_SCENARIO: Record<string, string> = {
  show_products: 'show_products',
  recommend: 'recommend_product',
  start_checkout: 'collect_checkout_info',
  ask_delivery: 'order_confirmed_ask_delivery',
  confirm_selection: 'confirm_selection',
  show_price: 'show_price',
  answer_faq: 'answer_delivery',
  greet: 'greeting',
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
  }): Promise<TemplateRenderResult | null> {
    const { tenantId, classification, productData, memory, recentTemplateIds, isFirstProductPresentation } =
      params;

    // 0. If products were just found for the first time, force show_products
    if (isFirstProductPresentation && productData && productData.length > 0) {
      this.logger.log('First product presentation — forcing show_products scenario');
      return this.renderScenario(tenantId, 'show_products', classification, productData, memory, recentTemplateIds);
    }

    // 1. Check if this is an FAQ question first
    const faqResult = await this.tryFaqMatch(tenantId, classification);
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
    return this.renderScenario(tenantId, scenario, classification, productData, memory, recentTemplateIds);
  }

  private async renderScenario(
    tenantId: string,
    scenario: string,
    classification: ClassificationResult,
    productData?: ProductSearchResult[],
    memory?: AssistantMemory,
    recentTemplateIds: string[] = [],
  ): Promise<TemplateRenderResult | null> {
    this.logger.debug(`renderScenario: scenario=${scenario} tenantId=${tenantId?.slice(0, 8)}`);

    const templates = await this.templateRepo.find({
      where: { tenantId, scenario, active: true },
      order: { priority: 'DESC' },
    });

    if (templates.length === 0) {
      this.logger.warn(`No active templates for scenario=${scenario}`);
      return null;
    }

    const variables = this.buildVariableMap(classification, productData, memory);
    this.logger.debug(`renderScenario: ${templates.length} templates found, variables: ${Object.keys(variables).join(', ')}`);

    const viable = templates.filter((t) => this.hasRequiredVariables(t, variables));
    if (viable.length === 0) {
      const missing = templates.map((t) => {
        const req = (t.requiredVariables as string[]) || [];
        const miss = req.filter((v) => !variables[v]);
        return `${t.id.slice(0, 8)}(needs: ${miss.join(',')})`;
      });
      this.logger.warn(`No templates have all required variables for scenario=${scenario}. Missing: ${missing.join('; ')}`);
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
    return { text, templateId: selected.id, scenario, matchedVariantId: variables['matched_variant_id'] };
  }

  // ─── FAQ matching ──────────────────────────────────────────────

  private async tryFaqMatch(
    tenantId: string,
    classification: ClassificationResult,
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

    for (const item of faqItems) {
      const tags = item.questionTags as string[];
      const matched = tags.some(
        (tag) =>
          keywords.some((kw) => tag.toLowerCase().includes(kw.toLowerCase())) ||
          keywords.some((kw) =>
            kw.toLowerCase().includes(tag.toLowerCase()),
          ),
      );
      if (matched) {
        const faqScenario = classification.primaryIntent === 'delivery_question' ? 'answer_delivery' :
                           classification.primaryIntent === 'payment_question' ? 'answer_payment' : 'answer_faq';
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

    // Special case: provide_details with actual delivery info → confirm order
    if (
      intent === 'provide_details' &&
      (entities.customerName || entities.phone || entities.city)
    ) {
      return 'confirm_order';
    }

    // Special case: ask_recommendation when products were already shown
    if (
      (intent === 'ask_recommendation' || act === 'ask_recommendation') &&
      memory?.lastPresentedProducts?.length
    ) {
      return 'ask_recommendation_from_shown';
    }

    // Special case: confirm_choice after recommendation → confirm_selection
    if (act === 'confirm_choice' && memory?.lastAction === 'gave_recommendation') {
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

    // ── HARD CHECKOUT GATE ──────────────────────────────────────
    // Cannot enter checkout unless selection is fully confirmed
    if (['collect_checkout_info', 'order_confirmed_ask_delivery'].includes(scenario)) {
      if (selectionState !== 'confirmed') {
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
  ): Record<string, string> {
    const vars: Record<string, string> = {};

    // From entities
    if (classification.entities.productName)
      vars['product_name'] = classification.entities.productName;
    if (classification.entities.category)
      vars['category'] = classification.entities.category;
    if (classification.entities.color)
      vars['color'] = classification.entities.color;
    if (classification.entities.size)
      vars['size'] = classification.entities.size;
    if (classification.entities.customerName)
      vars['customer_name'] = classification.entities.customerName;
    // Build variant_name from entities if user specified color/size (deduplicated)
    const entityParts = [classification.entities.color, classification.entities.size].filter(Boolean);
    const dedupedParts = [...new Set(entityParts)];
    if (dedupedParts.length > 0) vars['variant_name'] = dedupedParts.join(', ');

    // From product data
    if (productData && productData.length > 0) {
      const first = productData[0];
      if (!vars['product_name']) vars['product_name'] = first.product.title;

      // Build price string
      const prices = [
        ...new Set(
          first.variants.map((v) => `${v.price} ${v.currency}`),
        ),
      ];
      vars['price'] = prices.join(' / ');

      // Build smart product list for show_products scenario
      vars['product_list'] = this.formatProductList(productData);

      // Build variants string for single product (deduplicated)
      const allVariants = first.variants
        .filter((v) => v.effectiveAvailable > 0)
        .map((v) => [...new Set([v.color, v.size].filter(Boolean))].join(', '))
        .filter(Boolean);
      const uniqueVariants = [...new Set(allVariants)];
      if (uniqueVariants.length > 0) {
        vars['variants'] = uniqueVariants.join(', ');
      }

      // Build variant_name — hybrid matching against user's requested color/size
      const userColor = classification.entities.color ?? '';
      const userSize = classification.entities.size ?? '';
      const userVariantInput = userColor || userSize;

      if (userVariantInput) {
        const inStockVariants = first.variants.filter((v) => v.effectiveAvailable > 0);
        const match = this.matchVariant(userVariantInput, inStockVariants);
        if (match) {
          const variantDetail = [match.variant.color, match.variant.size].filter(Boolean).join(', ');
          vars['variant_name'] = variantDetail;
          vars['matched_variant_id'] = match.variant.id;
          vars['variant_match_confidence'] = String(match.confidence);
        }
        // NO fallback to first variant — if no match, variant_name stays unset
        // This forces ask_variant_choice template
      } else if (first.variants.length === 1) {
        // Single variant product — auto-select
        const only = first.variants[0];
        if (only.effectiveAvailable > 0) {
          const variantDetail = [only.color, only.size].filter(Boolean).join(', ');
          if (variantDetail) vars['variant_name'] = variantDetail;
          vars['matched_variant_id'] = only.id;
        }
      }
      // If multiple variants and no user input → variant_name stays unset → ask_variant_choice

      // Build variant_list for ask_variant_choice scenario (deduplicated)
      if (first.variants.length > 1) {
        const variantType = this.detectVariantType(first.variants);
        vars['variant_type'] = variantType;
        const variantNames = first.variants
          .filter((v) => v.effectiveAvailable > 0)
          .map((v) => [...new Set([v.color, v.size].filter(Boolean))].join(', '))
          .filter(Boolean);
        vars['variant_list'] = [...new Set(variantNames)].join(', ');
      }
    }

    // From memory: variant_list fallback (if not built from productData)
    if (!vars['variant_list'] && Array.isArray(memory?.availableVariants) && memory.availableVariants.length > 0) {
      vars['variant_list'] = [...new Set(memory.availableVariants.map((v: any) => v.name))].join(', ');
      if (!vars['variant_type']) {
        vars['variant_type'] = this.detectVariantType(
          memory.availableVariants.map((v: any) => ({ color: v.color, size: v.size })) as any,
        );
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

    // Build order summary from entities + memory
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

    return vars;
  }

  // ─── Product list formatter ────────────────────────────────────

  private formatProductList(productData: ProductSearchResult[]): string {
    if (!productData || productData.length === 0) return '';

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

    for (const p of productData) {
      const inStock = p.variants.filter((v) => v.effectiveAvailable > 0);
      if (inStock.length === 0) continue;

      // Product name line
      let productLine = `${idx}. ${p.product.title}`;

      // If only 1 variant and no distinguishing attributes, just show price
      if (inStock.length === 1) {
        const v = inStock[0];
        const detail = [v.color, v.size].filter(Boolean).join(', ');
        if (!samePriceForAll) {
          productLine += detail ? ` (${detail}) — ${v.price} ${v.currency}` : ` — ${v.price} ${v.currency}`;
        } else if (detail) {
          productLine += ` (${detail})`;
        }
        lines.push(productLine);
      } else {
        lines.push(productLine);

        // Variant names list
        const variantNames = inStock
          .map((v) => [v.color, v.size].filter(Boolean).join(', '))
          .filter(Boolean);

        if (variantNames.length > 0) {
          const label = variantType;
          lines.push(`${label}: ${variantNames.join(', ')}`);
        }

        // Show per-product price only if different from others
        if (!samePriceForAll) {
          const productPrices = [...new Set(inStock.map((v) => v.price))];
          if (productPrices.length === 1) {
            lines.push(`Ціна: ${productPrices[0]} ${currency}`);
          } else {
            lines.push(`Ціна: від ${Math.min(...productPrices)} до ${Math.max(...productPrices)} ${currency}`);
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
      lines.push(`Усі по ${uniquePrices[0]} ${currency}.`);
    }

    return lines.join('\n');
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
      return variables[key] ?? match;
    });
  }
}
