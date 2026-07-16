import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { MessageRole } from '@direct-mate/shared';
import {
  ClassifierLlm,
  OpenAiClassifierLlm,
  AnthropicClassifierLlm,
  isAnthropicModel,
} from './llm/classifier-llm';

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
  /**
   * The product/category the customer pivoted to, parked while we ask which
   * cart item they want removed (`awaitingField === 'cart_removal_choice'`).
   * Replayed into `entities` on the next turn so the pivot survives the detour.
   * Optional — absent on every conversation written by the old engine.
   */
  pendingPivot?: { category?: string; productName?: string };
  /** One-shot guard: `ask_cart_removal` has already been asked for this pivot.
   *  Without it, an answer that matches no cart item leaves the pivot entities
   *  on the next turn and 4.6c asks again, forever. */
  cartRemovalAsked?: boolean;
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
  /**
   * Transient — set by `handleSizeChartRequest` when the size chart was
   * sent THIS turn. Signals the classifier that the customer's next
   * message is likely a fit judgment ("L підійде?"), a measurement
   * ("зріст 170"), or a size pick made after seeing the chart. A
   * dedicated flag rather than a `lastAction` overwrite because the chart
   * is often sent in the same turn as a variant-not-available message,
   * and clobbering `lastAction` would disable `alternativesOfferedRule`.
   * Cleared at the start of the next turn after classification.
   */
  sizeChartJustSent?: boolean;
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
              size: {
                type: ['string', 'null'],
                description:
                  'The size the customer named. Canonical letter sizes: XS, S, M, L, XL, XXL (uppercase Latin). Numeric sizes: 36–50 (and ranges like "44-46"). Normalize Cyrillic size letters to Latin: "ХЛ"/"хл" → "XL", "Л"/"л" → "L", "М"/"м" (when clearly a size, not the word) → "M", "С"/"с" → "S". NEVER extract the meta-word "розмір"/"размер"/"size" itself — it marks that a size follows, it is not a value. Extract the size EVEN when it appears inside a question ("а L мені підійде?" → "L"; "є XL?" → "XL"). If no concrete size value is present, leave null.',
              },
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
  private readonly anthropic: Anthropic | null;
  private readonly model: string;
  /** 'v1' (default) | 'v2' — see classifyV2. Toggled by CLASSIFIER_PROMPT. */
  private readonly promptVersion: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('openai.apiKey'),
    });
    // Only constructed when a key is present. A `claude-*` model with no key
    // throws at call time rather than silently falling back to OpenAI — a
    // silent fallback would quietly invalidate an A/B run.
    const anthropicKey = this.config.get<string>('anthropic.apiKey');
    this.anthropic = anthropicKey
      ? // logLevel: the SDK defaults to dumping the full request/response
        // (including the entire system prompt) at debug level, which buries
        // eval output. 'warn' keeps genuine failures visible.
        new Anthropic({ apiKey: anthropicKey, logLevel: 'warn' })
      : null;
    // Classifier-specific model — defaults to gpt-5.4-mini. Vision and
    // AI-fallback use separate `openai.visionModel` and `openai.model`
    // configs so the cheap classifier model doesn't bleed into those.
    this.model =
      this.config.get<string>('openai.classifierModel') ?? 'gpt-5.4-mini';
    this.promptVersion = process.env.CLASSIFIER_PROMPT ?? 'v1';
  }

  /**
   * Classifier prompt v2.
   *
   * Structural differences from v1, in order of how much they matter:
   *
   * 1. ONE slot_action ladder (first-match-wins) replaces five overlapping
   *    block-local rule sets. In v1 the pick-vs-question distinction
   *    ("L підійде" vs "L підійде?") is restated in three conditional blocks
   *    that can contradict each other, patched over with a PRECEDENCE
   *    sentence. Here the ladder is authoritative and the state blocks may
   *    only add `primary_intent` routing — they never touch slot_action.
   * 2. STATIC sections first, VOLATILE state last, so the long prefix is
   *    prompt-cacheable. Our input is ~3.6-4.4k tokens against ~106 output —
   *    the prompt IS the cost.
   * 3. Enums listed in-prompt. Redundant under OpenAI strict mode, but it
   *    costs little and removes a whole class of cross-field confusion.
   * 4. A calibrated confidence rubric. SAFE only because the policy engine no
   *    longer escalates a low-confidence turn that carries a resolvable slot
   *    action — otherwise instructing the model to emit ≤0.6 on an ambiguous
   *    pick would hand off the very turns this prompt gets right.
   */
  private async classifyV2(
    params: Parameters<ClassifierService['classify']>[0],
    memoryContext: string,
  ): Promise<ClassificationResult> {
    const m = params.memory;
    const isClothingLike = params.tenantBusinessType !== 'cosmetics';

    // ─── Section 5: state-conditional INTENT routing only ─────────
    const stateBlocks: string[] = [];

    if (m.lastAction === 'told_variant_not_available') {
      stateBlocks.push(
        ``,
        `ALTERNATIVES OFFERED — the bot just said the requested size/color is unavailable and listed the alternatives (see "Available variants" below).`,
        `In this state the customer's reply is a PICK, a FIT QUESTION, or a decline. The "?" separates the first two — check for it before anything else.`,
        `- A size the customer names that is NOT in the available list ("а 46 є?", "может XXL есть?") → primary_intent='availability_check', + extract the size.`,
        // NOTE: this block states slot_action explicitly, unlike the others.
        // That breaks the "state blocks route intent only" principle on
        // purpose. Measured: with the pure-intent form, gpt-5.4-mini reads the
        // RUSSIAN question "L подойдёт?" as a pick (confirm_choice /
        // fills_missing_slot) on every run, while the Ukrainian twin "L
        // підійде?" is read correctly — isolated to language, not to memory
        // state. Three separate RU reminders in the ladder did not fix it; the
        // model needs the (intent, slot_action) pair stated locally, in the
        // state where it applies. The ladder remains the general authority.
        `- A FIT QUESTION on a size — the message has an interrogative marker ("?", leading "чи", leading "а …?"):`,
        `    UA: "L підійде?" · "а L мені підійде?" · "чи не буде L завеликим?"`,
        `    RU: "L подойдёт?" · "а L на меня налезет?" · "M не мало будет?"`,
        `    → slot_action='asks_question', primary_intent='ask_recommendation', AND STILL extract entities.size.`,
        `- A STATEMENT naming an offered size — NO interrogative marker:`,
        `    UA: "L підійде" · "тоді L" · "давайте L" · "ну хай буде S"`,
        `    RU: "L подойдёт" · "тогда возьму M" · "давайте L"`,
        `    → slot_action='fills_missing_slot', primary_intent='confirm_choice', + extract entities.size. The customer is ACCEPTING an alternative, not asking for advice.`,
        `Russian and Ukrainian follow the SAME rule. "L подойдёт?" is a question exactly as "L підійде?" is; "L подойдёт" is a pick exactly as "L підійде" is. The "?" is the only signal.`,
      );
    }
    if (m.sizeChartJustSent) {
      stateBlocks.push(
        ``,
        `SIZE CHART JUST SHOWN — the bot sent the sizing chart last turn.`,
        `- Body measurements ("зріст 170, вага 60", "180 70", "рост 165 вес 55") → primary_intent='ask_recommendation'; size stays null.`,
        `- A fit question naming a size → primary_intent='ask_recommendation' + extract the size.`,
      );
    }
    if (m.selectedProductId && m.selectionState === 'awaiting_confirmation') {
      stateBlocks.push(
        ``,
        `POST-SELECTION VARIANT FOLLOW-UP — a product is already selected; the customer asks about OTHER sizes/colors OF THAT PRODUCT.`,
        `- "А є в інших розмірах?" · "Чи є L?" · "А інший колір є?" · "є в M?" → primary_intent='ask_variant_choice' (NOT product_inquiry, NOT availability_check), + extract any named size/color.`,
      );
    }
    if (m.awaitingPreQualifyAnswer) {
      stateBlocks.push(
        ``,
        `PENDING OFFER — the bot just asked "Хочете, допоможу з розміром?".`,
        `"допоможіть з розміром" / "допоможіть підібрати" / "допоможи з вибором" carry NO size value — they are ladder rule 6 (confirmation), not a slot fill.`,
      );
    }
    if (isClothingLike) {
      stateBlocks.push(
        ``,
        `UKRAINIAN CASE NORMALIZATION for product_name — accusative → nominative:`,
        `  Сорочку→Сорочка · Сукню→Сукня · Куртку→Куртка · Спідницю→Спідниця`,
        `  "Хочу Сорочку лляну в розмірі M"  → product_name "Сорочка лляна", size "M"`,
        `  "Хочу куртку-бомбер у M, чорну"   → product_name "Куртка-бомбер", color "чорний", size "M"`,
        `  "Є бежева оверсайз футболка в розмірі S?" → product_name "Oversize футболка", color "бежевий" (NOT "білий"), size "S"`,
      );
    } else {
      stateBlocks.push(
        ``,
        `SKIN TYPE — extract into skin_type. Canonical: жирна · суха · нормальна · комбінована · чутлива`,
        `  "шкіра жирна" → жирна · "Т-зона блищить" → комбінована · "схильна до сухості" → суха · "чутлива, з куперозом" → чутлива`,
        `  If the phrasing doesn't map cleanly to one of the five, leave null.`,
      );
    }

    const systemPrompt = [
      // ─── SECTION 1 — ROLE (static) ──────────────────────────────
      `You are a message classifier for an online clothing/cosmetics store's Instagram DM assistant.`,
      `You classify the customer's CURRENT message and call classify_message.`,
      `You never write reply text — a separate template engine does that.`,
      ``,
      `Customers write in Ukrainian, Russian, or a mix (surzhyk). Classify all of them.`,
      `Entity VALUES you emit are always normalized to the catalog's canonical form, regardless of the language the customer used.`,
      ``,
      // ─── SECTION 2 — OUTPUT VOCABULARY (static) ─────────────────
      `── OUTPUT VOCABULARY ──`,
      ``,
      `primary_intent — one of:`,
      `  greeting | product_inquiry | ask_price | ask_recommendation | ready_to_order | provide_details |`,
      `  complaint | request_human | delivery_question | payment_question | general_question | thanks |`,
      `  confirm_choice | category_browse | availability_check | size_chart_request | ask_variant_choice | unknown`,
      ``,
      `  Disambiguation for the four that get confused:`,
      `  - availability_check — "is this size/color IN STOCK?"  ("є XL?", "у вас є розмір М?")`,
      `  - size_chart_request — "show me the sizing TABLE"      ("розмірна сітка є?", "табличка з розмірами")`,
      `  - ask_recommendation — "which size fits ME?"           ("порадьте розмір", "L підійде?", "170см 60кг")`,
      `  - ask_variant_choice — asks about other sizes/colors of the ALREADY-SELECTED product`,
      `  A "will X fit me?" question is ask_recommendation — never size_chart_request, never availability_check. It is a fit judgment, not a stock lookup.`,
      ``,
      `conversation_stage — one of:`,
      `  greeting | need_discovery | product_discovery | showing_options | selection_help | product_selected |`,
      `  checkout_started | collecting_customer_info | order_confirmation | post_order_support | handoff_to_manager`,
      `  Report where the conversation IS after this message, using CURRENT STATE below.`,
      ``,
      `sentiment — positive | neutral | negative. negative = frustration, complaint, or a request for a human. Most messages are neutral.`,
      ``,
      `dialogue_act — one of:`,
      `  new_inquiry | short_contextual_reply | confirm_choice | ask_recommendation | provide_details |`,
      `  ask_about_shown_products | clarification | general_chat`,
      ``,
      `recommended_action — one of:`,
      `  show_products | recommend | start_checkout | ask_delivery | answer_question | escalate | greet |`,
      `  clarify | confirm_selection | show_price | answer_faq | ask_variant_choice | size_chart_request`,
      ``,
      `confidence — 0.0-1.0, calibrated:`,
      `  0.9-1.0  unambiguous; one reading only`,
      `  0.7-0.9  clear given CURRENT STATE, but would be ambiguous without it`,
      `  0.5-0.7  two plausible readings; you picked the likelier (e.g. pick vs fit-question)`,
      `  < 0.5    you are guessing — the message is off-script, garbled, or out of scope`,
      `  Do not default to 0.9.`,
      ``,
      // ─── SECTION 3 — ENTITY EXTRACTION (static) ─────────────────
      `── ENTITY EXTRACTION ──`,
      `Emit null for anything absent.`,
      ``,
      `SCOPE — the rule that matters most:`,
      `Extract values ONLY from the customer's CURRENT message. NEVER carry a value forward from a prior turn in the history. If the current message doesn't say it, emit null. Leaving a field null is CORRECT; guessing is WRONG. Applies to every field: product_name, category, color, size, skin_type, quantity, customer_name, phone, city, delivery_branch.`,
      ``,
      `  History: customer said "S" three turns ago; bot then asked color.`,
      `  Current: "Білу давайте"`,
      `    CORRECT { color: "білий", size: null }        WRONG { color: "білий", size: "S" }   ← leak`,
      ``,
      `  History: customer once gave "Ханас Олександр, 0991234567, Київ, НП 5".`,
      `  Current: "А є M?"`,
      `    CORRECT { size: "M" }, all customer fields null`,
      `    WRONG   echoing the name / phone / city back`,
      ``,
      `  History: customer was choosing a white shirt in S.`,
      `  Current: "Хочу замовити джинси"`,
      `    CORRECT { product_name: "Джинси" }            WRONG { product_name: "Джинси", color: "білий", size: "S" }`,
      ``,
      `  History mentions category "Сорочки"; bot asked which size.`,
      `  Current: "M"`,
      `    CORRECT { size: "M", category: null }         WRONG { category: "Сорочки", size: "M" }  ← leak`,
      ``,
      `CATEGORY — the one permitted inference:`,
      `category MAY be inferred from a product noun in the CURRENT message ("Хочу сорочку" → "Сорочки"), because it is constrained to the tenant's catalog. It must be one of the categories listed in CURRENT STATE, or null. Never infer it from history.`,
      ``,
      `INDEXED PICKS:`,
      `"першу", "другу", "цю", "ту що зверху", "цей" are NOT entity values. Emit empty entities; the engine resolves them from the products it last showed.`,
      ``,
      `SIZE:`,
      `Canonical: XS S M L XL XXL (uppercase Latin), or numeric 36-50, or a range ("44-46").`,
      `Normalize Cyrillic: "ХЛ"/"хл"→XL, "Л"→L, "М"→M, "С"→S.`,
      `NEVER extract the meta-word "розмір"/"размер"/"size" — it announces a size, it is not one.`,
      `Extract the size even inside a question: "а L мені підійде?" → "L"; "є XL?" → "XL".`,
      ``,
      `COLOR:`,
      `Emit masculine nominative in the catalog's language (Ukrainian): "чорну"/"чорні" → "чорний"; "білу" → "білий"; "красную" (RU) → "червоний".`,
      `Preserve the actual shade — do NOT collapse near-colors: "бежевий" ≠ "білий" · "блакитний" ≠ "синій" · "кремовий" ≠ "білий".`,
      ``,
      `BRAND NAMES — fix the SCRIPT, never the WORD ORDER:`,
      `The catalog stores brands in Latin (JACK&JONES, Mango, Zara, Bottega Veneta). Product-name matching is a literal substring test, so a Cyrillic spelling of a Latin brand matches NOTHING — but so does a REORDERED name. Change only the letters of the brand; keep every word where the customer put it.`,
      `  "є куртка джек енд джонс чорна M?" → product_name "Куртка Jack & Jones"   (brand transliterated; order kept)`,
      `  "Покажіть Mango Сукня міді"        → product_name "Mango Сукня міді"      (already Latin — copy it VERBATIM, do NOT move "Mango" to the end)`,
      `  "хочу манго сукню"                 → product_name "Mango сукня"           (brand transliterated in place)`,
      `Never reorder, never translate the product noun, never drop a word. Transliterate the brand and otherwise reproduce what the customer wrote.`,
      ``,
      `EMPTY MESSAGE:`,
      `Applies ONLY when the current message text is literally empty (zero characters) — a photo or story reply sent with no caption at all.`,
      `Then: empty entities, slot_action='new_inquiry', primary_intent='unknown', confidence ≤ 0.4. The engine resolves the image separately. Do NOT invent entities from history to fill it.`,
      `If there is ANY text — even two words like "А таке є?" or "скільки?" — classify it NORMALLY. An attached photo or story does NOT make the message empty, and such a turn is never 'unknown'.`,
      ``,
      // ─── SECTION 4 — SLOT ACTION LADDER (static) ────────────────
      `── SLOT ACTION LADDER ──`,
      `Apply in order. FIRST MATCH WINS. This ladder overrides every example elsewhere in this prompt — if a state block seems to say otherwise, the ladder is right.`,
      ``,
      `1. rejection          — pure negation, no new value.`,
      `                        "ні" · "не треба" · "не хочу" · "тоді не треба" · "нет, спасибо" · "сама визначусь"`,
      `2. correction         — negation FOLLOWED BY a new value (replaces an earlier choice).`,
      `                        "ні, я хочу Rosewood" · "не, краще червону"`,
      `3. adds_to_cart       — wants an ADDITIONAL product alongside the current one.`,
      `                        "і ще крем" · "ще хочу футболку"`,
      `4. asks_question      — the message carries an interrogative marker: "?" · leading "чи" · leading "а …?".`,
      `                        This BEATS rule 5 even when the message also names a size or color — but you MUST still extract that entity.`,
      `                        UA: "скільки коштує?" · "L підійде?" · "чи є L?" · "а інший колір є?"`,
      `                        RU: "L подойдёт?" · "а M мне подойдёт?" · "сколько стоит?" · "а есть L?"`,
      `                        The "?" rule is IDENTICAL in Russian. A Russian message with "?" is rule 4, never rule 5.`,
      `5. fills_missing_slot — the message names a value (color, size, product, or an indexed pick) with NO interrogative marker. The customer is CHOOSING.`,
      `                        This holds even when the phrasing sounds like agreement:`,
      `                        "давайте L" · "тоді L" · "L підійде" · "ну хай буде S" · "беру червону" ·`,
      `                        "тогда возьму M" (RU) · "давайте першу" (indexed → empty entities) · bare "L" · bare "Білий"`,
      `6. confirmation       — a pure accept carrying NO new value at all.`,
      `                        "так" · "добре" · "ок" · bare "давайте" · bare "беру" · bare "підійде" · "допоможіть з розміром"`,
      `7. new_inquiry        — anything else: a new topic, a new product, an opening message.`,
      ``,
      `CONTRAST — the same words, one character apart. The "?" is the ONLY signal:`,
      `  "L підійде"   → rule 5 · fills_missing_slot · size "L"   (a PICK — no interrogative marker)`,
      `  "L підійде?"  → rule 4 · asks_question      · size "L"   (a QUESTION — has "?")`,
      `  "L подойдёт"  → fills_missing_slot   |   "L подойдёт?" → asks_question   (RU, same rule)`,
      `  "чорний підходить" → fills_missing_slot   |   "чорний підходить?" → asks_question`,
      `Do NOT let a phrase that merely SOUNDS like agreement ("підійде", "підходить", "хай буде") pull a question into rule 5, and do NOT let a named size pull a statement into rule 4. Check for the marker, nothing else.`,
      ``,
      `The trap: rules 5 and 6 both cover "давайте"/"беру"/"підійде". The ONLY thing separating them is whether the message carries a value. "давайте" → confirmation. "давайте L" → fills_missing_slot. NEVER emit confirmation for a message that carries new information.`,
      `Uncertain between 4 and 5 (a pick or a question?): choose 5 and set confidence ≤ 0.6.`,
      `A bare color or size word is NEVER asks_question — the customer is answering, not asking.`,
      ``,
      // ─── SECTION 5 — STATE-CONDITIONAL (intent routing only) ────
      stateBlocks.length
        ? [`── STATE-CONDITIONAL ROUTING (primary_intent only; never overrides the ladder) ──`, ...stateBlocks].join('\n')
        : '',
      ``,
      // ─── SECTION 6 — CURRENT STATE (volatile — LAST) ────────────
      `── CURRENT STATE ──`,
      params.categories.length
        ? `Available product categories: ${params.categories.join(', ')}.`
        : `Available product categories: (none configured).`,
      memoryContext,
      ``,
      `Classify the customer's LAST message. Call classify_message.`,
    ]
      .filter((s) => s !== undefined && s !== '')
      .join('\n');

    return this.runClassification(params, systemPrompt);
  }

  /**
   * Force the three routing-critical fields onto their schema enums, in place.
   *
   * The allowed values are read from the tool schema itself, so there is no
   * second copy to drift. Fires only for providers that don't enforce enums
   * (Anthropic); with OpenAI strict mode it is a no-op.
   */
  private coerceToSchema(
    raw: Record<string, any>,
    schema: Record<string, unknown>,
    model: string,
    truncatedMessage: string,
  ): void {
    const props = (schema as any)?.properties ?? {};
    const FIELDS: Array<[string, string]> = [
      ['primary_intent', 'unknown'],
      ['recommended_action', 'clarify'],
      ['slot_action', 'new_inquiry'],
    ];

    for (const [field, fallback] of FIELDS) {
      const allowed: string[] | undefined = props[field]?.enum;
      const value = raw[field];
      if (!allowed || value == null) continue;
      if (!allowed.includes(value)) {
        this.logger.error(
          `[CLASSIFIER_SCHEMA_VIOLATION] model=${model} field=${field} ` +
            `value="${value}" → coerced to "${fallback}" message="${truncatedMessage}"`,
        );
        raw[field] = fallback;
      }
    }
  }

  /**
   * Pick the transport for a model id. Routing is per-call and keyed on the id
   * (not a global provider flag) so `classifyWithFallback` keeps reaching
   * OpenAI's gpt-5.4 even when the primary classifier is a Claude model.
   */
  private llmFor(model: string): ClassifierLlm {
    if (isAnthropicModel(model)) {
      if (!this.anthropic) {
        throw new Error(
          `Classifier model "${model}" is an Anthropic model but ANTHROPIC_API_KEY is not set.`,
        );
      }
      return new AnthropicClassifierLlm(this.anthropic);
    }
    return new OpenAiClassifierLlm(this.openai);
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
    /** Offline A/B eval only — override the classifier model for this call
     *  (e.g. 'gpt-5.6-luna'). Reasoning-model families get reasoning_effort
     *  and drop the fixed temperature automatically. Never set in prod. */
    modelOverride?: string;
    reasoningEffort?: string;
  }): Promise<ClassificationResult> {
    const memoryContext = this.buildMemoryContext(params.memory);

    // v2 prompt, selected by CLASSIFIER_PROMPT=v2. Kept behind a toggle so v1
    // and v2 can be A/B'd on the same harness with clean attribution.
    if (this.promptVersion === 'v2') {
      return this.classifyV2(params, this.buildMemoryContext(params.memory, true));
    }

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
            `A product is already selected and state is awaiting_confirmation. If customer ASKS about other sizes/colors of THIS product, classify primary_intent='ask_variant_choice' with slot_action='asks_question' (NOT 'product_inquiry' or generic 'asks_question' intent). The engine routes to a "variant not available" reply if the asked size/color is out of stock.`,
            `  Question examples:`,
            `    "А є в інших розмірах?" → ask_variant_choice; asks_question`,
            `    "Чи є L?"               → ask_variant_choice; asks_question; size: "L"`,
            `    "А інший колір є?"      → ask_variant_choice; asks_question`,
            `    "є в M?"                → ask_variant_choice; asks_question; size: "M"`,
            `But a STATEMENT picking a size/color (no question — "давайте L", "тоді M", "L підійде") is NOT a question — classify slot_action='fills_missing_slot' + extract the entity (the customer is choosing, not asking).`,
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

    // Fires the turn AFTER the bot said "requested variant is unavailable,
    // here are the alternatives". Keyed on `lastAction` (written identically
    // at all 4 variant-not-available sites) rather than `selectionState`
    // (which the engine writes inconsistently here — sometimes
    // 'awaiting_confirmation', sometimes downgraded). Without this block the
    // one rule that resolves a bare-size pick (awaitingVariantRule) is OFF
    // in this state, and "L підійде" free-associates to ask_recommendation
    // → an unwanted handoff. Cause-of-record: prod trace 50036bfb.
    const alternativesOfferedRule =
      params.memory.lastAction === 'told_variant_not_available'
        ? [
            ``,
            `ALTERNATIVES OFFERED (the bot just said the requested size/color is unavailable and listed the alternatives shown under "Available variants" — the customer's reply is usually a PICK, a FIT QUESTION, or a decline):`,
            `- STATEMENT naming an offered size/color → slot_action='fills_missing_slot' + extract the entity. The customer is ACCEPTING an offered alternative. NOT ask_recommendation. NOT pure 'confirmation' (the message carries new information — the chosen size):`,
            `    "L підійде"      → fills_missing_slot; size: "L"`,
            `    "тоді L"         → fills_missing_slot; size: "L"`,
            `    "давайте L"      → fills_missing_slot; size: "L"`,
            `    "ну хай буде S"  → fills_missing_slot; size: "S"`,
            `    "L подойдёт"     → fills_missing_slot; size: "L"    (Russian)`,
            `    "тогда возьму M" → fills_missing_slot; size: "M"    (Russian)`,
            `- QUESTION about fit (has an interrogative marker: "?", "чи", a leading "а …?") → slot_action='asks_question', primary_intent='ask_recommendation', AND STILL extract entities.size. The customer wants a fit check on that size — not a size chart, not stock status:`,
            `    "L підійде?"              → asks_question; ask_recommendation; size: "L"`,
            `    "а L мені підійде?"       → asks_question; ask_recommendation; size: "L"`,
            `    "чи не буде L завеликим?" → asks_question; ask_recommendation; size: "L"`,
            `    "L подойдёт?"             → asks_question; ask_recommendation; size: "L"   (Russian)`,
            `    "а L на меня налезет?"    → asks_question; ask_recommendation; size: "L"   (Russian)`,
            `- No "?" and the named size IS in the Available variants list → treat as the STATEMENT (pick) case. If genuinely uncertain between pick and question, STILL output fills_missing_slot but set confidence ≤ 0.6.`,
            `- Pure decline ("ні", "не треба", "тоді не треба", "нет, спасибо") → slot_action='rejection'.`,
            `- A size NOT in the offered list ("а 46 є?", "может XXL есть?") → primary_intent='availability_check' + extract the size.`,
            // TRIED AND REVERTED: adding v2's side-by-side CONTRAST block here
            // ("L підійде" vs "L підійде?", one character apart). It fixed the
            // statement-pick family inside v2's single-ladder prompt, but grafted
            // into this block it did the OPPOSITE — golden went from a stable
            // 25/25 to 23-25/25, newly failing the PICK cases (alt_pick_L,
            // alt_pick_davayte_L) because the model started over-applying the
            // question reading — and it still did not fix
            // men_demo_fit_statement_picks_size. The v2 win came from the
            // ladder's structure, not from the contrast text; it does not
            // transfer. Don't re-add it without re-running the golden set 3x.
          ].join('\n')
        : '';

    // Fires the turn AFTER the size chart image was sent. The customer is
    // now judging fit against it, giving measurements, or picking a size.
    const sizeChartJustSentRule = params.memory.sizeChartJustSent
      ? [
          ``,
          `SIZE CHART JUST SHOWN (the bot sent the sizing chart last turn — the customer is reacting to it):`,
          `- Body measurements ("зріст 170, вага 60", "180 70", "рост 165 вес 55") → primary_intent='ask_recommendation' (fit check against the chart).`,
          `- Fit question naming a size ("L підійде?", "мій розмір M?", "L подойдёт?") → slot_action='asks_question', primary_intent='ask_recommendation', + extract entities.size.`,
          `- Statement picking a size ("беру L", "тоді M", "давайте L") → slot_action='fills_missing_slot' + extract entities.size.`,
        ].join('\n')
      : '';

    // Surfaces which conditional blocks fired for this call. Grep
    // production logs for `[CLASSIFIER_BLOCKS]` to verify the
    // category-heuristic includes the right tenants and to diagnose
    // unexpected prompt-token deltas.
    this.logger.debug(
      `[CLASSIFIER_BLOCKS] cosmetics=${!!cosmeticsRule} pendingOffer=${!!pendingOfferRule} awaitingVariant=${!!awaitingVariantRule} postSelection=${!!postSelectionRule} altsOffered=${!!alternativesOfferedRule} chartJustSent=${!!params.memory.sizeChartJustSent} productSize=${isClothingLike} categories=${params.categories.join(',')}`,
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
      alternativesOfferedRule,
      sizeChartJustSentRule,
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
      `  History above mentions category "Сорочки"; bot asked which size.`,
      `  Current message: "M"`,
      `    → CORRECT: { size: "M" }                    (category NOT carried from history)`,
      `    → WRONG:   { category: "Сорочки", size: "M" } (category LEAK)`,
      ``,
      `  History above: customer was choosing a white t-shirt (color "білий", size "S").`,
      `  Current message: "Хочу замовити джинси"`,
      `    → CORRECT: { productName: "Джинси" }        (new product — NO color/size/name/phone carried)`,
      `    → WRONG:   { productName: "Джинси", color: "білий", size: "S" }  (LEAK from the prior product)`,
      ``,
      `IMPORTANT RULES:`,
      `- Short replies ("так", "добре", "давайте", "цей", a color, a size) must be interpreted in context of the last action.`,
      `- If products were shown and user gives a short reply, they are likely selecting or confirming.`,
      `- If awaiting delivery info and user provides text, it's likely provide_details.`,
      `- Extract ALL entities that ARE in the current message, but NONE that aren't. (See ENTITY SCOPE above.)`,
      ``,
      `SLOT ACTION RULES:`,
      `- 'confirmation' ONLY for pure confirmations without new information: "так", "беру", "давайте", "добре", "ок". NOTE: "підходить"/"підійде" is 'confirmation' ONLY when bare — together with a size or color ("L підійде", "чорний підходить") it is 'fills_missing_slot' (a pick) or 'asks_question' (if it ends in "?"), never pure 'confirmation'.`,
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
      `- 'ask_recommendation' when customer asks the bot to choose a size for them, OR asks whether a NAMED size will fit them:`,
      `    "порадьте розмір", "що мені підійде? 170см 60кг" → ask_recommendation`,
      `    "L підійде?", "а M мені підійде?", "L подойдёт?" → ask_recommendation + extract entities.size  (fit check on a named size — NOT a size chart, NOT stock status)`,
      `- A COMPOUND message that states a size AND asks a fit/property question keeps the size entity: "У меня хл размер. Они полномерные?" → availability_check (or ask_variant_choice if a product is selected); slot_action='asks_question'; size: "XL" (normalize "хл" → "XL"). The size half must ALWAYS survive.`,
      `- PRECEDENCE: when a conditional block above is active (ALTERNATIVES OFFERED, SIZE CHART JUST SHOWN, AWAITING VARIANT ANSWER, POST-SELECTION), its examples take precedence over these generic ones.`,
      ``,
      `Call classify_message with your analysis.`,
    ]
      .filter((s) => s !== undefined)
      .join('\n');

    return this.runClassification(params, systemPrompt);
  }

  /**
   * Transport + parse, shared by every prompt version.
   *
   * Deliberately identical for v1 and v2: the message list, the tool, the model
   * routing, the enum coercion and the entity normalization all live here, so a
   * v1-vs-v2 A/B can only differ by the system prompt itself.
   */
  private async runClassification(
    params: Parameters<ClassifierService['classify']>[0],
    systemPrompt: string,
  ): Promise<ClassificationResult> {
    // Provider-neutral message list. The adapter decides how to carry the
    // system prompt (OpenAI: first message; Anthropic: top-level param) and
    // normalizes the turns for its API's constraints.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Add recent conversation messages for context
    for (const msg of params.recentMessages) {
      const role =
        msg.role === MessageRole.User ? 'user' : ('assistant' as const);
      messages.push({ role, content: msg.text ?? '' });
    }

    // Add current message
    messages.push({ role: 'user', content: params.messageText });

    const model = params.modelOverride ?? this.model;
    // `ChatCompletionTool` is a union (function | custom) in the current SDK;
    // buildClassifyTool always returns the function variant.
    const toolFn = (buildClassifyTool(params.categories) as any).function as {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };

    const result = await this.llmFor(model).call({
      model,
      system: systemPrompt,
      messages,
      tool: {
        name: toolFn.name,
        description: toolFn.description ?? '',
        schema: toolFn.parameters,
      },
      reasoningEffort: params.reasoningEffort,
    });

    if (params.usageSink) {
      params.usageSink.push({
        model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs: result.latencyMs,
        requestId: result.requestId,
        source: 'classifier',
      });
    }

    // Truncate user-visible text in fallback logs so PII doesn't end
    // up in noisy log retention — first ~100 chars is plenty to
    // identify the failure case.
    const truncatedMessage = params.messageText.slice(0, 100);

    const raw = result.args;
    if (!raw) {
      this.logger.error(
        `[CLASSIFIER_FALLBACK] reason=no_tool_call model=${model} message="${truncatedMessage}"`,
      );
      return this.defaultClassification();
    }

    // Enum enforcement. OpenAI's `strict: true` GUARANTEES the model returns a
    // schema-valid enum member; Anthropic's `input_schema` treats the enum as
    // guidance and will happily return something else (observed:
    // primary_intent='rejection', which is a valid slot_action but NOT a valid
    // primary_intent). An off-enum value matches none of the engine's routing
    // lists (INTENT_TO_SCENARIO, searchIntents, the product_not_found intent
    // lists), so it degrades routing SILENTLY. Coerce to the safe default and
    // log loudly — the violation rate is itself a model-quality metric.
    this.coerceToSchema(raw, toolFn.parameters, model, truncatedMessage);

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

  /**
   * @param ladderMode v2 only. The volatile state block is rendered LAST in v2,
   *   which gives it maximum recency — so it must not carry a slot_action
   *   instruction of its own. v1's variant line ("…names one of these → the
   *   customer is SELECTING it → slot_action='fills_missing_slot'") cites
   *   "L підійде" as a pick, and when placed last it overrode the ladder's
   *   rule 4 and turned "L підійде?" (a QUESTION) into a pick. In ladder mode
   *   the line states the qualifier and defers to the ladder instead.
   */
  private buildMemoryContext(
    memory: AssistantMemory,
    ladderMode = false,
  ): string {
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
    // Render as MATCHABLE tokens, not a passive display list: if the
    // current message names one of these, the customer is selecting it.
    parts.push(
      ladderMode
        ? `- Available variants: ${variantStr}\n  ↑ If the current message names one of these WITHOUT an interrogative marker, the customer is selecting it (ladder rule 5). WITH a "?" it is a question (ladder rule 4) — the ladder decides, not this line.`
        : `- Available variants (if the current message names one of these — bare or inside a short phrase like "L підійде"/"тоді L" — the customer is SELECTING it → slot_action='fills_missing_slot'): ${variantStr}`,
    );
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
    if (memory.sizeChartJustSent) {
      parts.push(`- Size chart was just sent this turn — the customer's next message is likely a fit judgment, a measurement, or a size pick made after seeing the chart`);
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
