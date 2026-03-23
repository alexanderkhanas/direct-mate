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
    const templates = await this.templateRepo.find({
      where: { tenantId, scenario, active: true },
      order: { priority: 'DESC' },
    });

    if (templates.length === 0) {
      this.logger.debug(`No active templates for scenario=${scenario}`);
      return null;
    }

    const variables = this.buildVariableMap(classification, productData, memory);

    const viable = templates.filter((t) => this.hasRequiredVariables(t, variables));
    if (viable.length === 0) {
      this.logger.debug(`No templates have all required variables for scenario=${scenario}`);
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
    return { text, templateId: selected.id, scenario };
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
    const hasProductSelected = memory.lastAction === 'confirmed_product' || memory.lastAction === 'gave_recommendation';
    const hasDeliveryInfo =
      !!classification.entities.customerName ||
      !!classification.entities.phone ||
      !!classification.entities.city;

    // If products were just found but not yet shown to customer, force show_products
    if (hasProductsJustFound && !hasProductShown) {
      if (['confirm_selection', 'collect_checkout_info', 'order_confirmed_ask_delivery', 'recommend_product', 'confirm_order'].includes(scenario)) {
        this.logger.debug(`Stage gate: ${scenario} blocked — products found but not shown yet`);
        return 'show_products';
      }
    }

    // CRITICAL: After "Оформлюємо X?" (confirmed_product) + user confirms → collect delivery info, not confirm again
    if (scenario === 'confirm_selection' && memory.lastAction === 'confirmed_product') {
      this.logger.debug('Stage gate: confirm_selection after confirmed_product → collect_checkout_info');
      return 'collect_checkout_info';
    }

    // After asked_delivery_details + user confirms → also collect_checkout_info
    if (scenario === 'confirm_selection' && memory.lastAction === 'asked_delivery_details') {
      this.logger.debug('Stage gate: confirm_selection after asked_delivery → collect_checkout_info');
      return 'collect_checkout_info';
    }

    // Can't confirm selection if no products were shown
    if (scenario === 'confirm_selection' && !hasProductShown) {
      this.logger.debug('Stage gate: confirm_selection blocked — no products shown yet');
      return 'show_products';
    }

    // Can't start checkout if no product was selected/recommended
    if (
      (scenario === 'collect_checkout_info' || scenario === 'order_confirmed_ask_delivery') &&
      !hasProductSelected && !hasProductShown
    ) {
      this.logger.debug('Stage gate: checkout blocked — no product selected');
      return 'show_products';
    }

    // Can't confirm order if no delivery details provided
    if (scenario === 'confirm_order' && !hasDeliveryInfo) {
      this.logger.debug('Stage gate: confirm_order blocked — no delivery info');
      if (hasProductSelected || hasProductShown) {
        return 'order_confirmed_ask_delivery';
      }
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

      // Build variants string for single product
      const allVariants = first.variants
        .filter((v) => v.effectiveAvailable > 0)
        .map((v) => [v.color, v.size].filter(Boolean).join(', '))
        .filter(Boolean);
      if (allVariants.length > 0) {
        vars['variants'] = allVariants.join(', ');
      }

      // Build variant_list for ask_variant_choice scenario
      if (first.variants.length > 1) {
        const variantType = this.detectVariantType(first.variants);
        vars['variant_type'] = variantType;
        vars['variant_list'] = first.variants
          .filter((v) => v.effectiveAvailable > 0)
          .map((v) => [v.color, v.size].filter(Boolean).join(', '))
          .filter(Boolean)
          .join(', ');
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
