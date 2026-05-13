import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MessageRole } from '@direct-mate/shared';

// ─── Classification result ───────────────────────────────────────

export interface ClassificationResult {
  primaryIntent: string;
  entities: {
    productName?: string;
    category?: string;
    color?: string;
    size?: string;
    skinType?: string;
    quantity?: number;
    customerName?: string;
    phone?: string;
    city?: string;
    deliveryBranch?: string;
  };
  conversationStage: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
  dialogueAct: string;
  recommendedAction: string;
  slotAction: 'new_inquiry' | 'fills_missing_slot' | 'correction' | 'confirmation' | 'rejection' | 'adds_to_cart' | 'asks_question';
}

// ─── Assistant memory (shared with reply engine) ──────────────────

export interface AssistantMemory {
  lastAction?: string;
  lastPresentedProducts?: Array<{
    title: string;
    variants: string[];
    price: string;
    /** Stable id of the product row. Lets the in-memory narrow path
     *  reconstruct a ProductSearchResult-shaped object without a DB
     *  round-trip. Optional — older conversations from before the
     *  narrow path landed do not carry it; readers must tolerate
     *  absence and fail-closed (skip narrow → fresh search). */
    productId?: string;
    /** Structured variant matrix. Required for in-memory narrowing
     *  by color / size on slot-fill follow-ups (see
     *  `narrowLastPresentedInMemory` in reply-engine). The display
     *  string in `variants` is for prompts and human eyes; this is
     *  for filtering. */
    rawVariants?: Array<{
      id: string;
      color: string | null;
      size: string | null;
      price: number;
      salePrice: number | null;
      available: boolean;
    }>;
    /** Mirror of `products.search_keywords` for color-in-blob fallback
     *  during in-memory narrow when variants carry no color axis but
     *  the product itself is the right color (e.g. single-color
     *  products that got color-stripped by the n8n normalize step). */
    searchKeywords?: string | null;
  }>;
  awaitingField?: string;
  selectedCategory?: string;
  failedTurns?: number;
  orderItems?: string[];
  recentTemplateIds?: string[];
  selectionState?: string;
  selectedProductId?: string;
  selectedProductTitle?: string;
  selectedVariantId?: string;
  selectedVariantName?: string;
  availableVariants?: Array<{ id: string; name: string; color?: string | null; size?: string | null; imageUrl?: string | null }> | string;
  orderCreated?: boolean;
  cartItems?: Array<{
    productId: string;
    variantId: string;
    externalProductId: string | null;
    externalVariantId: string | null;
    title: string;
    variantName: string;
    price: number;
    currency: string;
  }>;
  preQualifyData?: Record<string, string>;
  preQualifyCollected?: boolean;
  recommendedSize?: string;
  recommendedSkinType?: string;
  skinTypeCollected?: boolean;
  /**
   * After-search-offered flow: bot just appended the offer suffix
   * ("Хочете, допоможу..."). Used to prevent re-appending the offer on
   * subsequent turns. Cleared once the user answers (yes/no) or moves the
   * conversation on (picks variant, asks something else).
   */
  shouldOfferSizeHelp?: boolean;
  /**
   * Set together with `shouldOfferSizeHelp`. Signals the next turn that a
   * 'confirmation' / 'rejection' slotAction should be interpreted as a
   * yes/no answer to the offer (not a generic confirm). Cleared on any
   * answer or topic shift.
   */
  awaitingPreQualifyAnswer?: boolean;
  requestedVariant?: string;
  variantStep?: 'color' | 'size' | null;
  selectedColor?: string;
  selectedSize?: string;
  /**
   * Transient — set by `handleColorLinkedMedia` when a story/post link
   * resolves to a specific color. Comma-joined in-stock sizes for that
   * color, used by `confirm_color_variant_in_stock` template's
   * {sizes} variable. Recomputed each turn the link is resolved.
   */
  mediaLinkSizes?: string;
  /**
   * Transient — comma-joined localized colors of the same product
   * (excluding the linked color) that have at least one in-stock
   * variant. Used by the {other_colors_variants} template variable.
   */
  mediaLinkOtherColors?: string;
  /** Total active variants on the selected product BEFORE in-stock filter.
   *  Set when memory.availableVariants is populated; used by 5.5d to detect
   *  "last in stock" cases (catalog has multiple variants but only one is
   *  available right now → route to confirm_last_in_stock template instead
   *  of plain confirm_selection so the copy can call out the scarcity). */
  totalVariantsForSelectedProduct?: number;
  /** ISO timestamp of when conversation_start_greeting was first sent for
   *  this conversation. Set on the first inbound turn (unless the classifier
   *  resolves greeting intent, which renders the natural greeting reply on
   *  its own). Once set, the welcome doesn't re-fire. */
  welcomedAt?: string;
  /** ISO timestamp of the most recent OUTBOUND bot reply on this
   *  conversation. Used by the welcome gate to re-fire the AI
   *  introduction after 6h of bot silence. Updated centrally in
   *  `reply-engine.service.ts` `withTrace` for every reply-emitting
   *  return. Optional: legacy conversations don't have it, treated as
   *  "not dormant" until the first new reply lands. */
  lastReplyAt?: string;
}

// ─── OpenAI tool definition ──────────────────────────────────────

/**
 * Build the classify_message function tool, scoped to this tenant.
 *
 * The `categories` argument constrains `entities.category` to the
 * tenant's actual list (Torgsoft + denormalized fallback, see
 * `AvailabilityService.getCategories`). With `strict: true` set on
 * the function tool, OpenAI enforces the enum at decode time — the
 * model emits a value from the list or returns null. No more
 * hallucinated categories from the model's training distribution.
 *
 * `strict: true` requires:
 *   - All properties listed in `required`
 *   - `additionalProperties: false` on every object
 *   - Optional fields modeled as nullable type unions
 * Hence every entity property is `["string"|"number", "null"]` and
 * appears in the `required` array; the model returns null for
 * fields it cannot fill.
 */
function buildClassifyTool(
  categories: string[],
): OpenAI.Chat.ChatCompletionTool {
  const categoryField =
    categories.length > 0
      ? { type: ['string', 'null'], enum: [...categories, null] }
      : { type: ['string', 'null'] };

  return {
    type: 'function',
    function: {
      name: 'classify_message',
      description:
        'Classify the customer message: detect intent, extract entities, determine conversation stage. Do NOT generate reply text.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          primary_intent: {
            type: 'string',
            enum: [
              'greeting',
              'product_inquiry',
              'ask_price',
              'ask_recommendation',
              'ready_to_order',
              'provide_details',
              'complaint',
              'request_human',
              'delivery_question',
              'payment_question',
              'general_question',
              'thanks',
              'confirm_choice',
              'category_browse',
              'availability_check',
              'size_chart_request',
              'unknown',
            ],
          },
          entities: {
            type: 'object',
            properties: {
              product_name: { type: ['string', 'null'] },
              category: categoryField,
              color: {
                type: ['string', 'null'],
                description:
                  'Color the customer is asking about. Always emit in masculine nominative form regardless of the case the customer used. Ukrainian: emit "чорний" (not "чорну" / "чорної" / "чорному" / "чорні"), "білий" (not "білу" / "білі"), "червоний" (not "червону"). English: emit lowercase canonical form ("black", "white", "red"). This rule applies even when the customer types accusative, genitive, locative, or plural — strip the case ending and return the masculine nominative.',
              },
              size: { type: ['string', 'null'] },
              skin_type: { type: ['string', 'null'] },
              quantity: { type: ['number', 'null'] },
              customer_name: { type: ['string', 'null'] },
              phone: { type: ['string', 'null'] },
              city: { type: ['string', 'null'] },
              delivery_branch: { type: ['string', 'null'] },
            },
            required: [
              'product_name',
              'category',
              'color',
              'size',
              'skin_type',
              'quantity',
              'customer_name',
              'phone',
              'city',
              'delivery_branch',
            ],
            additionalProperties: false,
          },
          conversation_stage: {
            type: 'string',
            enum: [
              'greeting',
              'need_discovery',
              'product_discovery',
              'showing_options',
              'selection_help',
              'product_selected',
              'checkout_started',
              'collecting_customer_info',
              'order_confirmation',
              'post_order_support',
              'handoff_to_manager',
            ],
          },
          sentiment: {
            type: 'string',
            enum: ['positive', 'neutral', 'negative'],
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0 and 1',
          },
          dialogue_act: {
            type: 'string',
            enum: [
              'new_inquiry',
              'short_contextual_reply',
              'confirm_choice',
              'ask_recommendation',
              'provide_details',
              'ask_about_shown_products',
              'clarification',
              'general_chat',
            ],
          },
          recommended_action: {
            type: 'string',
            enum: [
              'show_products',
              'recommend',
              'start_checkout',
              'ask_delivery',
              'answer_question',
              'escalate',
              'greet',
              'clarify',
              'confirm_selection',
              'show_price',
              'answer_faq',
            ],
          },
          slot_action: {
            type: 'string',
            enum: [
              'new_inquiry',
              'fills_missing_slot',
              'correction',
              'confirmation',
              'rejection',
              'adds_to_cart',
              'asks_question',
            ],
            description:
              'What the user is doing in terms of slot-filling flow',
          },
        },
        required: [
          'primary_intent',
          'entities',
          'conversation_stage',
          'sentiment',
          'confidence',
          'dialogue_act',
          'recommended_action',
          'slot_action',
        ],
        additionalProperties: false,
      },
    },
  } as OpenAI.Chat.ChatCompletionTool;
}

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class ClassifierService {
  private readonly logger = new Logger(ClassifierService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('openai.apiKey'),
    });
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o';
  }

  async classify(params: {
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    currentStage?: string;
    tenantBusinessType?: 'clothing' | 'cosmetics';
  }): Promise<ClassificationResult> {
    const memoryContext = this.buildMemoryContext(params.memory);

    const cosmeticsRule = params.tenantBusinessType === 'cosmetics'
      ? [
          ``,
          `SKIN TYPE DETECTION (cosmetics tenant):`,
          `- If the customer mentions any skin condition or concern, extract it into entities.skin_type.`,
          `- Canonical values: жирна, суха, нормальна, комбінована, чутлива.`,
          `- Examples (input → skin_type):`,
          `    "шкіра жирна" → "жирна"`,
          `    "Т-зона блищить" → "комбінована"`,
          `    "схильна до сухості" → "суха"`,
          `    "чутлива, з куперозом" → "чутлива"`,
          `- If the customer's phrasing maps cleanly to one of the 5 values, output that value verbatim.`,
          `- If unsure, leave the field unset.`,
        ].join('\n')
      : '';

    const pendingOfferRule = params.memory.awaitingPreQualifyAnswer
      ? [
          ``,
          `PENDING OFFER ANSWER (the bot just asked "Хочете, допоможу з розміром?" — categorize the customer's reply):`,
          `- Set slot_action='confirmation' for PURE accepts with no specifics:`,
          `    "так" → confirmation`,
          `    "давайте" → confirmation`,
          `    "допоможіть" → confirmation`,
          `    "допоможіть з розміром" → confirmation`,
          `    "допоможіть підібрати" → confirmation`,
          `    "допоможи з вибором" → confirmation`,
          `    "потрібна допомога" → confirmation`,
          `    "так, давайте" → confirmation`,
          `    "давайте, беру" → confirmation`,
          `- "давайте/беру/візьму" + product / color / size specifics → fills_missing_slot, NOT confirmation`,
          `  (the customer is making a NEW selection, not just answering yes — extract their entities and route as a slot fill):`,
          `    "давайте зара" → fills_missing_slot (new product mentioned)`,
          `    "давайте Mango M" → fills_missing_slot (product + size)`,
          `    "беру червону" → fills_missing_slot (color provided)`,
          `    "візьму Zara розмір L" → fills_missing_slot (product + size)`,
          `    "давайте Zara, розмір M" → fills_missing_slot (product + size)`,
          `- Set slot_action='rejection' for ANY decline:`,
          `    "ні" → rejection`,
          `    "не треба" → rejection`,
          `    "сам(а) визначусь" → rejection`,
          `    "ні дякую, гляну" → rejection`,
          `- Topic shift (use the natural slot_action, NOT confirmation/rejection):`,
          `    "а скільки коштує?" → asks_question`,
          `    "хочу куртку" → new_inquiry`,
          `    "а є знижки?" → asks_question`,
          `- IMPORTANT: do NOT extract entities.size from the meta-word "розмір" itself. Only extract a size when a canonical value is present (XS/S/M/L/XL or numeric like 36/38/40/42).`,
        ].join('\n')
      : '';

    const systemPrompt = [
      `You are a message classifier for an online store's Instagram DM assistant.`,
      `Your ONLY job is to classify the customer message. Do NOT generate any reply text.`,
      ``,
      `Analyze the message and determine:`,
      `1. Primary intent (what the customer wants)`,
      `2. Entities (product names, categories, colors, sizes, customer details)`,
      `3. Conversation stage (where we are in the sales funnel)`,
      `4. Sentiment (positive/neutral/negative)`,
      `5. Confidence (0-1)`,
      `6. Dialogue act (what the customer is doing conversationally)`,
      `7. Recommended action (what the bot should do next)`,
      ``,
      params.categories.length
        ? `Available product categories: ${params.categories.join(', ')}.`
        : '',
      params.currentStage
        ? `Current conversation stage: ${params.currentStage}`
        : '',
      memoryContext ? `\n${memoryContext}` : '',
      cosmeticsRule,
      pendingOfferRule,
      ``,
      `IMPORTANT RULES:`,
      `- Short replies ("так", "добре", "давайте", "цей", a color, a size) must be interpreted in context of the last action.`,
      `- If products were shown and user gives a short reply, they are likely selecting or confirming.`,
      `- If awaiting delivery info and user provides text, it's likely provide_details.`,
      `- Extract ALL relevant entities from the message.`,
      ``,
      `SLOT ACTION RULES:`,
      `- 'confirmation' ONLY for pure confirmations without new information: "так", "беру", "підходить", "давайте", "добре", "ок"`,
      `- 'correction' when user starts with negation AND provides new value: "ні, я хочу Rosewood", "не, краще червону"`,
      `- 'fills_missing_slot' when user provides a value we asked for: a color name after "який відтінок?", a product name after showing options`,
      `- 'rejection' for pure negation without new info: "ні", "не хочу", "не треба"`,
      `- 'new_inquiry' for starting a new topic or asking about something new`,
      `- 'adds_to_cart' when user wants to add another product: "і ще крем", "ще хочу..."`,
      `- 'asks_question' for questions about current selection or general: "скільки коштує?", "а яка різниця?"`,
      ``,
      `CRITICAL: Do NOT use 'confirmation' for messages that contain new information. "Ягідно-червоний" is 'fills_missing_slot', not 'confirmation'.`,
      ``,
      `SIZE CHART vs AVAILABILITY vs RECOMMENDATION — critical disambiguation:`,
      `- 'size_chart_request' ONLY when the customer asks for a sizing TABLE / CHART / measurement guide.`,
      `  Positive examples (all → size_chart_request):`,
      `    "розмірна сітка є?"`,
      `    "покажіть розміри у таблиці"`,
      `    "як зрозуміти який розмір мій?"`,
      `    "табличка з розмірами"`,
      `    "є чарт розмірів?"`,
      `    "які параметри у розмірів?"`,
      `  Negative — DO NOT classify as size_chart_request:`,
      `    "у вас є розмір М?"            → availability_check (wants in-stock status of size M)`,
      `    "є XL?"                         → availability_check`,
      `    "який у вас розмірний ряд?"     → availability_check (wants list of in-stock sizes, not a measurement chart)`,
      `    "що мені підійде? 170см 60кг"  → ask_recommendation (wants judgment from parameters)`,
      `    "порадьте розмір"               → ask_recommendation`,
      `    "який розмір брати при зрості 170?" → ask_recommendation (asking bot to choose, not asking for a table)`,
      ``,
      `POST-SELECTION VARIANT FOLLOW-UP:`,
      `When CONVERSATION STATE shows a product is already selected (Selected product != "not selected", Selection state == "awaiting_confirmation"), and the customer asks about other sizes/colors of THIS product, classify as 'ask_variant_choice' — NOT 'ask_question' or 'product_inquiry'. The engine will route to a "variant not available" reply if the asked size/color isn't in stock.`,
      `  Examples (with a selected product in memory):`,
      `    "А є в інших розмірах?"          → ask_variant_choice`,
      `    "Чи є L?"                        → ask_variant_choice (extract size: "L")`,
      `    "А інший колір є?"               → ask_variant_choice`,
      `    "є в M?"                         → ask_variant_choice (extract size: "M")`,
      `    "інші розміри?"                  → ask_variant_choice`,
      ``,
      `Call classify_message with your analysis.`,
    ]
      .filter((s) => s !== undefined)
      .join('\n');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add recent conversation messages for context
    for (const msg of params.recentMessages) {
      const role =
        msg.role === MessageRole.User ? 'user' : ('assistant' as const);
      messages.push({ role, content: msg.text ?? '' });
    }

    // Add current message
    messages.push({ role: 'user', content: params.messageText });

    const completion = await (this.openai.chat.completions.create as any)({
      model: this.model,
      messages,
      tools: [buildClassifyTool(params.categories)],
      tool_choice: {
        type: 'function',
        function: { name: 'classify_message' },
      },
      max_completion_tokens: 400,
      temperature: 0.1,
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      this.logger.warn('No tool call in classification response');
      return this.defaultClassification();
    }

    let raw: any;
    try {
      raw = JSON.parse((toolCall as any).function.arguments);
    } catch (err) {
      this.logger.error('Failed to parse classification JSON', (err as Error).message);
      return this.defaultClassification();
    }

    // Strict mode forces every entity field to appear in the response
    // (null for unset). Normalize null → undefined so downstream
    // truthiness checks (`if (entities.category)`) keep their
    // pre-strict-mode semantics.
    const e = raw.entities ?? {};
    return {
      primaryIntent: raw.primary_intent ?? 'unknown',
      entities: {
        productName: e.product_name ?? undefined,
        category: e.category ?? undefined,
        color: e.color ?? undefined,
        size: e.size ?? undefined,
        skinType: e.skin_type ?? undefined,
        quantity: e.quantity ?? undefined,
        customerName: e.customer_name ?? undefined,
        phone: e.phone ?? undefined,
        city: e.city ?? undefined,
        deliveryBranch: e.delivery_branch ?? undefined,
      },
      conversationStage: raw.conversation_stage ?? 'greeting',
      sentiment: raw.sentiment ?? 'neutral',
      confidence: raw.confidence ?? 0.5,
      dialogueAct: raw.dialogue_act ?? 'general_chat',
      recommendedAction: raw.recommended_action ?? 'clarify',
      slotAction: raw.slot_action ?? 'new_inquiry',
    };
  }

  /**
   * Second-opinion classification with fallback model (for handoff verification).
   */
  async classifyWithFallback(params: {
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    currentStage?: string;
    tenantBusinessType?: 'clothing' | 'cosmetics';
  }): Promise<ClassificationResult> {
    const fallbackModel = this.config.get<string>('openai.fallbackModel');
    if (!fallbackModel) {
      throw new Error('No fallback model configured');
    }

    // Temporarily override model
    const origModel = this.model;
    (this as any).model = fallbackModel;
    try {
      return await this.classify(params);
    } finally {
      (this as any).model = origModel;
    }
  }

  private buildMemoryContext(memory: AssistantMemory): string {
    if (!memory.lastAction) return '';

    const parts = [
      `ASSISTANT MEMORY (what happened before in this conversation):`,
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

    // Enriched conversation state context
    parts.push(``);
    parts.push(`CONVERSATION STATE:`);
    parts.push(`- Selection state: ${memory.selectionState || 'none'}`);
    parts.push(`- Selected product: ${memory.selectedProductTitle || 'not selected'}`);
    parts.push(`- Selected variant: ${memory.selectedVariantName || 'not selected'}`);
    const variantStr = Array.isArray(memory.availableVariants)
      ? memory.availableVariants.map(v => v.name).join(', ')
      : (memory.availableVariants || 'unknown');
    parts.push(`- Available variants: ${variantStr}`);
    parts.push(`- Last bot action: ${memory.lastAction || 'none'}`);
    parts.push(`- Waiting for: ${memory.awaitingField || 'nothing specific'}`);
    if (memory.cartItems?.length) {
      parts.push(`- Cart items (${memory.cartItems.length}): ${memory.cartItems.map(i => i.title).join(', ')}`);
    }
    if (memory.variantStep) {
      parts.push(`- Variant selection step: ${memory.variantStep}`);
      if (memory.selectedColor) {
        parts.push(`- Selected color: ${memory.selectedColor}`);
      }
      if (memory.selectedSize) {
        parts.push(`- Selected size: ${memory.selectedSize}`);
      }
    }
    if (memory.preQualifyCollected && memory.preQualifyData) {
      parts.push(`- Pre-qualify data: ${JSON.stringify(memory.preQualifyData)}`);
    }
    if (memory.recommendedSize) {
      parts.push(`- Recommended size: ${memory.recommendedSize}`);
    }
    if (memory.recommendedSkinType) {
      parts.push(`- Recommended skin type: ${memory.recommendedSkinType}`);
    }
    if (memory.awaitingPreQualifyAnswer) {
      parts.push(`- Pending offer: bot asked "Хочете, допоможу з розміром?" — customer's next message is their answer (accept / decline / topic shift)`);
    }

    return parts.join('\n');
  }

  private defaultClassification(): ClassificationResult {
    return {
      primaryIntent: 'unknown',
      entities: {},
      conversationStage: 'greeting',
      sentiment: 'neutral',
      confidence: 0.3,
      dialogueAct: 'general_chat',
      recommendedAction: 'clarify',
      slotAction: 'new_inquiry',
    };
  }
}
