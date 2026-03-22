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
  }): Promise<TemplateRenderResult | null> {
    const { tenantId, classification, productData, memory, recentTemplateIds } =
      params;

    // 1. Check if this is an FAQ question first
    const faqResult = await this.tryFaqMatch(tenantId, classification);
    if (faqResult) return faqResult;

    // 2. Determine scenario from classification
    const scenario = this.resolveScenario(classification);
    if (!scenario) {
      this.logger.debug(
        `No scenario mapped for intent=${classification.primaryIntent} action=${classification.recommendedAction}`,
      );
      return null;
    }

    // 3. Fetch matching templates
    const templates = await this.templateRepo.find({
      where: {
        tenantId,
        scenario,
        active: true,
      },
      order: { priority: 'DESC' },
    });

    if (templates.length === 0) {
      this.logger.debug(
        `No active templates for scenario=${scenario} tenant=${tenantId}`,
      );
      return null;
    }

    // 4. Build variable map from classification + product data + memory
    const variables = this.buildVariableMap(
      classification,
      productData,
      memory,
    );

    // 5. Filter templates by required variables availability
    const viable = templates.filter((t) =>
      this.hasRequiredVariables(t, variables),
    );

    if (viable.length === 0) {
      this.logger.debug(
        `No templates have all required variables for scenario=${scenario}`,
      );
      return null;
    }

    // 6. Anti-repetition: filter out recently used templates
    const antiRepWindow = 5;
    const recentSet = new Set(
      recentTemplateIds.slice(0, antiRepWindow),
    );
    let candidates = viable.filter((t) => !recentSet.has(t.id));

    // If all viable templates were recently used, fall back to all viable
    if (candidates.length === 0) {
      candidates = viable;
    }

    // 7. Pick the best template (highest priority, then random among ties)
    const topPriority = candidates[0].priority;
    const topCandidates = candidates.filter(
      (t) => t.priority === topPriority,
    );
    const selected =
      topCandidates[Math.floor(Math.random() * topCandidates.length)];

    // 8. Render the template
    const text = this.interpolateTemplate(selected, variables);

    return { text, templateId: selected.id };
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
        return { text: item.answerTemplate, templateId: item.id };
      }
    }

    return null;
  }

  // ─── Scenario resolution ───────────────────────────────────────

  private resolveScenario(classification: ClassificationResult): string | null {
    // Try intent-based mapping first
    const fromIntent = INTENT_TO_SCENARIO[classification.primaryIntent];
    if (fromIntent) return fromIntent;

    // Then try action-based mapping
    const fromAction = ACTION_TO_SCENARIO[classification.recommendedAction];
    if (fromAction) return fromAction;

    return null;
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

      // Build product list for show_products scenario
      const listParts: string[] = [];
      for (const p of productData) {
        const variantDescs = p.variants
          .filter((v) => v.effectiveAvailable > 0)
          .map((v) => {
            const details = [v.size, v.color].filter(Boolean).join(', ');
            return details
              ? `${details}: ${v.price} ${v.currency}`
              : `${v.price} ${v.currency}`;
          });
        if (variantDescs.length > 0) {
          listParts.push(
            `• ${p.product.title} — ${variantDescs.join('; ')}`,
          );
        }
      }
      if (listParts.length > 0) {
        vars['product_list'] = listParts.join('\n');
      }

      // Build variants string
      const allVariants = first.variants
        .map((v) => [v.size, v.color].filter(Boolean).join(', '))
        .filter(Boolean);
      if (allVariants.length > 0) {
        vars['variants'] = allVariants.join(', ');
      }
    }

    // From memory
    if (memory?.lastPresentedProducts?.length) {
      // If no product_name from current entities, use first from memory
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

    return vars;
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
