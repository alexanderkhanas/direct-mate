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
              // Post-selection variant follow-up — bot has a product
              // selected, customer asks about other sizes/colors of it.
              // Engine writes this value too (reply-engine.service.ts
              // L1712, L1762) so it MUST be schema-valid.
              'ask_variant_choice',
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
              // Paired with primary_intent='ask_variant_choice'. Engine
              // writes this on overrides; schema enum needs to allow it.
              'ask_variant_choice',
              // Paired with primary_intent='size_chart_request'. Mirrors
              // the engine's routing — `handleSizeChartRequest` reads
              // primaryIntent but downstream code may look at action.
              'size_chart_request',
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
    // Classifier-specific model — defaults to gpt-5.4-mini. Vision and
    // AI-fallback use separate `openai.visionModel` and `openai.model`
    // configs so the cheap classifier model doesn't bleed into those.
    this.model =
      this.config.get<string>('openai.classifierModel') ?? 'gpt-5.4-mini';
  }

  async classify(params: {
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    currentStage?: string;
    tenantBusinessType?: 'clothing' | 'cosmetics';
    /**
     * Optional usage sink. When provided, the OpenAI token usage + latency
     * for this call is appended. Used by the reply-engine to populate
     * `conversation_traces.openai_calls` without changing the public
     * return type. Caller owns the array; ordering matches call order.
     */
    usageSink?: Array<{
      model: string;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
      requestId?: string | null;
      source?: string;
    }>;
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

    // Fires whenever the customer is in the middle of variant selection.
    // Trigger is OR — `selectionState === 'awaiting_variant'` stays true
    // across interim turns (e.g. customer asks a question, bot answers,
    // customer then names the variant) so we coerce bare-color/size
    // replies even when lastAction has drifted past 'asked_variant'.
    const awaitingVariantRule =
      params.memory.lastAction === 'asked_variant' ||
      params.memory.selectionState === 'awaiting_variant'
        ? [
            ``,
            `AWAITING VARIANT ANSWER (bot has asked "Який обираєте?" — customer is filling the variant slot):`,
            `- Bare color word ("Білий", "Коричневий", "Чорна") → slot_action='fills_missing_slot' + extract entities.color`,
            `- Bare size word ("S", "M", "XL", "42") → slot_action='fills_missing_slot' + extract entities.size`,
            `- Color + size in one message ("Білу S", "Чорна M") → slot_action='fills_missing_slot' + both entities`,
            `- Indexed pick ("першу", "другу", "цю", "ту що зверху") → slot_action='fills_missing_slot' with empty entities; engine resolves via memory.lastPresentedProducts`,
            `- Pure decline ("ні", "не треба") → slot_action='rejection'`,
            `- Genuine question ("а скільки коштує?", "а яка ціна?") → slot_action='asks_question' (only questions get this; bare colors/sizes do NOT)`,
            `- DO NOT classify a bare color/size word as 'asks_question'. The customer is answering, not asking.`,
          ].join('\n')
        : '';

    // Fires only after a product is committed and customer asks about
    // alternate sizes/colors of it. Outside this state, generic
    // questions about the catalog stay in their normal intent buckets.
    const postSelectionRule =
      !!params.memory.selectedProductId &&
      params.memory.selectionState === 'awaiting_confirmation'
        ? [
            ``,
            `POST-SELECTION VARIANT FOLLOW-UP:`,
            `A product is already selected and state is awaiting_confirmation. If customer asks about other sizes/colors of THIS product, classify primary_intent='ask_variant_choice' (NOT 'product_inquiry' or generic 'asks_question'). The engine routes to a "variant not available" reply if the asked size/color is out of stock.`,
            `  Examples:`,
            `    "А є в інших розмірах?" → ask_variant_choice`,
            `    "Чи є L?"               → ask_variant_choice; size: "L"`,
            `    "А інший колір є?"      → ask_variant_choice`,
            `    "є в M?"                → ask_variant_choice; size: "M"`,
          ].join('\n')
        : '';

    // Fires only for clothing-ish catalogs. Cosmetics tenants don't
    // need these Ukrainian-accusative + color-normalization rules.
    // Token check uses substring match against canonical roots so
    // declined forms ("Сорочки" vs "Сорочка") still hit.
    const CLOTHING_CATEGORY_TOKENS = [
      'сорочк', 'сукн', 'штани', 'светр', 'футболк', 'куртк',
      'юбк', 'спідниц', 'жакет', 'тренч', 'бомбер', 'джинс',
    ];
    const isClothingLike = params.categories.some((c) =>
      CLOTHING_CATEGORY_TOKENS.some((t) => c.toLowerCase().includes(t)),
    );
    const productSizeExtractionRule = isClothingLike
      ? [
          ``,
          `PRODUCT + SIZE EXTRACTION (mandatory entity fill):`,
          `When the customer's message mentions a product NAME plus a size (or color), ALWAYS extract BOTH into entities. Ukrainian accusative forms (Сорочку, Сукню, Куртку, Спідницю) MUST be normalized to nominative (Сорочка, Сукня, Куртка, Спідниця) in productName. The meta-word "розмір"/"розмірі" marks the SIZE that follows — extract the canonical value (XS/S/M/L/XL or numeric like 36/38/40/42), never "розмір" itself.`,
          `COLOR NORMALIZATION — preserve the actual color the customer said. "бежевий" ≠ "білий"; "блакитний" ≠ "синій"; "кремовий" ≠ "білий". Feminine -а/-я ending (бежева, чорна, блакитна) maps to masculine nominative used in the catalog (бежевий, чорний, блакитний).`,
          `  Examples (extract ALL listed entities):`,
          `    "Хочу Сорочку лляну в розмірі M"           → product_inquiry; productName: "Сорочка лляна", size: "M"`,
          `    "Хочу куртку-бомбер у M, чорну"           → product_inquiry; productName: "Куртка-бомбер", color: "чорний", size: "M"`,
          `    "Є бежева оверсайз футболка в розмірі S?" → availability_check; productName: "Oversize футболка", color: "бежевий", size: "S"  (NOTE: "бежева" → "бежевий", NOT "білий")`,
          `    "Покажіть блакитну сорочку M"             → product_inquiry; productName: "Сорочка", color: "блакитний", size: "M"  (NOTE: "блакитна" → "блакитний", NOT "синій")`,
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

    // Surfaces which conditional blocks fired for this call. Grep
    // production logs for `[CLASSIFIER_BLOCKS]` to verify the
    // category-heuristic includes the right tenants and to diagnose
    // unexpected prompt-token deltas.
    this.logger.debug(
      `[CLASSIFIER_BLOCKS] cosmetics=${!!cosmeticsRule} pendingOffer=${!!pendingOfferRule} awaitingVariant=${!!awaitingVariantRule} postSelection=${!!postSelectionRule} productSize=${isClothingLike} categories=${params.categories.join(',')}`,
    );

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
      // Stage is already exposed via buildMemoryContext's CONVERSATION
      // STATE block (Selection state + Last bot action + Waiting for).
      // One source of truth; the standalone `Current conversation stage`
      // line was dropped to avoid drift.
      memoryContext ? `\n${memoryContext}` : '',
      cosmeticsRule,
      pendingOfferRule,
      awaitingVariantRule,
      postSelectionRule,
      productSizeExtractionRule,
      ``,
      `ENTITY SCOPE — CRITICAL:`,
      `Extract entity values ONLY from the customer's CURRENT message text. Never carry a value forward from a prior turn shown in conversation history. If the current message doesn't mention a value, OMIT that entity field — leaving it unset is correct; guessing is wrong.`,
      `This applies to ALL extraction fields: color, size, productName, category, customerName, phone, city, deliveryBranch, skin_type, quantity.`,
      `Indexed picks ("першу", "другу", "the first one", "цей") are NOT entity values — set slot_action='confirmation' or 'fills_missing_slot' with empty entities. The engine resolves these from memory.lastPresentedProducts.`,
      ``,
      `Worked examples — scope to the CURRENT message:`,
      `  History above shows: customer previously said "S" three turns ago; bot then asked color.`,
      `  Current message: "Білу давайте"`,
      `    → CORRECT: { color: "білий" }              (size OMITTED — "S" was prior turn, not this turn)`,
      `    → WRONG:   { color: "білий", size: "S" }   (LEAK from history)`,
      ``,
      `  History above shows: customer once said "Ханас Олександр, 0991234567, Київ, НП 5".`,
      `  Current message: a photo with no caption, OR "А є M?", OR "інший колір?"`,
      `    → CORRECT: { } or { size: "M" } — NO customerName/phone/city`,
      `    → WRONG:   echoing back the name/phone/city from history`,
      ``,
      `  Current message: "Білу S"`,
      `    → { color: "білий", size: "S" }            (both literal in current message)`,
      ``,
      `  Current message: "давайте першу"`,
      `    → entities: {} ; slot_action='confirmation' (indexed pick, no axes mentioned)`,
      ``,
      `IMPORTANT RULES:`,
      `- Short replies ("так", "добре", "давайте", "цей", a color, a size) must be interpreted in context of the last action.`,
      `- If products were shown and user gives a short reply, they are likely selecting or confirming.`,
      `- If awaiting delivery info and user provides text, it's likely provide_details.`,
      `- Extract ALL entities that ARE in the current message, but NONE that aren't. (See ENTITY SCOPE above.)`,
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
      `- 'size_chart_request' ONLY when customer asks for a sizing TABLE / CHART / measurement guide:`,
      `    "розмірна сітка є?", "табличка з розмірами", "як зрозуміти який розмір мій?"`,
      `- 'availability_check' when customer asks if a specific size is in stock:`,
      `    "у вас є розмір М?" → availability_check  (asks in-stock status, not measurements)`,
      `    "є XL?"             → availability_check`,
      `- 'ask_recommendation' when customer asks the bot to choose a size for them:`,
      `    "порадьте розмір", "що мені підійде? 170см 60кг" → ask_recommendation`,
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

    const callStartMs = performance.now();
    const completion = await (this.openai.chat.completions.create as any)({
      model: this.model,
      messages,
      tools: [buildClassifyTool(params.categories)],
      tool_choice: {
        type: 'function',
        function: { name: 'classify_message' },
      },
      max_completion_tokens: 400,
      // Deterministic classification. Same input → same output is more
      // important than minor variability; we've previously hit
      // non-determinism bugs from temperature>0.
      temperature: 0,
    });

    if (params.usageSink) {
      params.usageSink.push({
        model: this.model,
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        latencyMs: Math.round(performance.now() - callStartMs),
        requestId:
          (completion as { _request_id?: string })?._request_id ?? null,
        source: 'classifier',
      });
    }

    // Truncate user-visible text in fallback logs so PII doesn't end
    // up in noisy log retention — first ~100 chars is plenty to
    // identify the failure case.
    const truncatedMessage = params.messageText.slice(0, 100);

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      this.logger.error(
        `[CLASSIFIER_FALLBACK] reason=no_tool_call model=${this.model} message="${truncatedMessage}"`,
      );
      return this.defaultClassification();
    }

    let raw: any;
    try {
      raw = JSON.parse((toolCall as any).function.arguments);
    } catch (err) {
      this.logger.error(
        `[CLASSIFIER_FALLBACK] reason=json_parse_failed model=${this.model} message="${truncatedMessage}" parseError=${(err as Error).message}`,
      );
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
    usageSink?: Array<{
      model: string;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
      requestId?: string | null;
      source?: string;
    }>;
  }): Promise<ClassificationResult> {
    const fallbackModel = this.config.get<string>('openai.fallbackModel');
    if (!fallbackModel) {
      throw new Error('No fallback model configured');
    }

    // Temporarily override model
    const origModel = this.model;
    (this as any).model = fallbackModel;
    // Buffer usage records locally so we can re-stamp `source` to
    // 'classifier_fallback' before merging into the caller's sink.
    const localSink = params.usageSink ? [] as NonNullable<typeof params.usageSink> : undefined;
    try {
      return await this.classify({ ...params, usageSink: localSink });
    } finally {
      (this as any).model = origModel;
      if (localSink && params.usageSink) {
        for (const u of localSink) {
          params.usageSink.push({ ...u, source: 'classifier_fallback' });
        }
      }
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
