// ─── Simulator Scenario Definitions ──────────────────────────────
//
// Each scenario uses real tenant/product/media IDs from the database.
// Two tenants:
//   Pilot Store  (df1ab482-...) — beauty products, color variants
//   Clothes Store (f42abe74-...) — clothing, size variants, pre-qualify enabled

export interface SimulatorTurnExpect {
  /** Expected ReplyEngineOutput.decision */
  decision?: 'reply' | 'handoff' | 'create_draft_order';
  /** Expected templateScenario value (e.g. 'confirm_selection') */
  scenario?: string;
  /** Substring(s) the main reply text MUST contain */
  replyContains?: string | string[];
  /** Substring(s) the main reply text MUST NOT contain */
  replyNotContains?: string | string[];
  /** Expected number of image URLs attached */
  imageCount?: number;
  /** Partial state assertions (all listed keys must match exactly) */
  state?: {
    selectionState?: 'awaiting_product' | 'awaiting_variant' | 'awaiting_confirmation' | 'cart_item_added' | 'confirmed' | null;
    selectedProductId?: string | null;
    selectedVariantName?: string | null;
    cartLength?: number;
    cartHasVariant?: string;
    lastAction?: string;
    awaitingField?: string;
    preQualifyCollected?: boolean;
    recommendedSize?: string;
    orderCreated?: boolean;
  };
  /** Free-form note describing what this turn is testing */
  note?: string;
}

export interface SimulatorTurn {
  /**
   * Inbound message text. Pass a string for a single message, or an array
   * to simulate multiple messages that Instagram's 5-second debounce would
   * combine into one engine call (joined with '\n', matching production).
   */
  message: string | string[];
  mediaReference?: { mediaId: string; type: string };
  expect?: SimulatorTurnExpect;
}

export interface SimulatorScenario {
  name: string;
  description: string;
  tenantId: string;
  turns: SimulatorTurn[];
}

const PILOT_STORE = 'df1ab482-b328-4e8d-9d8c-40f8a426cf66';
const CLOTHES_STORE = 'f42abe74-54af-468f-8912-39f1c19106af';

export const SCENARIOS: Record<string, SimulatorScenario> = {
  story_reply_clothing: {
    name: 'Story Reply — Clothing (size check)',
    description: 'Story reply with linked product → size M → confirm → checkout → delivery',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'розмір М є в наявності?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  beauty_standard: {
    name: 'Beauty — Standard Order Flow',
    description: 'Greeting → show products → pick color → confirm → delivery → order',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'Привіт, хочу помаду' },
      { message: 'Silk Color, Nude Pink' },
      { message: 'так' },
      { message: 'Іван Петренко, 0991234567, Київ, НП 5' },
    ],
  },

  pre_qualify_flow: {
    name: 'Pre-Qualify — Clothing with height/weight',
    description: 'Product inquiry → pre-qualify → filtered results → pick → confirm → order',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'хочу футболку' },
      { message: '180 см, 75 кг' },
      { message: 'перша' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  adds_to_cart: {
    name: 'Multi-Cart — Two products',
    description: 'Pick product → confirm → add another → confirm → checkout',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'і ще Rosewood' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Марія Шевченко, 0501234567, Одеса, НП 3' },
    ],
  },

  cart_remove_buy_one: {
    name: 'Multi-Cart — Add two, buy only one',
    description: 'Add Nude Pink + Rosewood to cart → "хочу тільки Nude Pink" → cart filtered to 1 → checkout',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'і ще Rosewood' },
      { message: 'так' },
      {
        message: 'хочу тільки Nude Pink',
        expect: {
          state: { cartLength: 1, cartHasVariant: 'Nude Pink' },
          note: 'Cart correction: Rosewood removed, only Nude Pink remains',
        },
      },
      { message: 'оформлюємо' },
      { message: 'оформлюємо' },
      { message: 'Марія Шевченко, 0501234567, Одеса, НП 3' },
    ],
  },

  cart_abandon_pick_new: {
    name: 'Multi-Cart — Add two, abandon cart, buy third',
    description: 'Add Nude Pink + Rosewood → "ні, хочу Color Veil Terracotta" → cart cleared, fresh search',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'і ще Rosewood' },
      { message: 'так' },
      {
        message: 'ні, давайте тільки Color Veil Terracotta',
        expect: {
          note: 'Cart correction: neither Silk Color item matches Color Veil → cart cleared, fresh product search',
        },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Марія Шевченко, 0501234567, Одеса, НП 3' },
    ],
  },

  // ─── Additional Clothing Store scenarios ─────────────────────────

  story_reply_no_size: {
    name: 'Story Reply — No size mentioned',
    description: 'Story reply without specifying size → should ask variant choice',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є в наявності?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      { message: 'M' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Ігор Бондаренко, 0631234567, Харків, НП 8' },
    ],
  },

  story_reply_price: {
    name: 'Story Reply — Price inquiry',
    description: 'Story reply asking price → should show price without listing all variants',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'скільки коштує?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
    ],
  },

  story_reply_bomber: {
    name: 'Story Reply — Bomber jacket (no size variants, only sizes)',
    description: 'Story reply for куртка-бомбер → size L → confirm → checkout',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є розмір L?',
        mediaReference: { mediaId: '18214869007318645', type: 'story_reply' },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Андрій Мельник, 0501112233, Дніпро, НП 3' },
    ],
  },

  story_reply_oos_size: {
    name: 'Story Reply — Out of stock size',
    description: 'Story reply asking for XXL which does not exist → should show available sizes',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є розмір XXL?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      { message: 'тоді XL' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  clothing_direct_variant: {
    name: 'Clothing — Direct variant query (single turn)',
    description: 'User specifies color+size in first message → skip pre-qualify → confirm directly',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'Є чорна футболка в розмірі M?' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Андрій Коваль, 0991234567, Київ, НП 5' },
    ],
  },

  clothing_two_step_variant: {
    name: 'Clothing — Two-step variant (color + size)',
    description: 'Product with both color and size → pick color → pick size → confirm',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'хочу базову футболку' },
      { message: '180 см, 80 кг' },
      { message: 'Zara базова, Black' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Дмитро Сидоренко, 0671234567, Одеса, НП 15' },
    ],
  },

  clothing_category_browse: {
    name: 'Clothing — Category browse',
    description: 'Browse by category (куртки) → pick product → pick size → confirm',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'покажіть куртки' },
      { message: '175 см, 70 кг' },
      { message: 'бомбер Zara' },
      { message: 'L' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Сергій Ткаченко, 0931234567, Київ, НП 22' },
    ],
  },

  clothing_correction: {
    name: 'Clothing — Variant correction',
    description: 'Pick color+size → correct to different color before confirming',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'хочу базову футболку Zara' },
      { message: '175 см, 72 кг' },
      { message: 'White' },
      { message: 'ні, давайте Black' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Катерина Попова, 0991112233, Полтава, НП 6' },
    ],
  },

  story_reply_basic_tshirt: {
    name: 'Story Reply — Basic T-shirt (Чорна базова)',
    description: 'Story reply: size S → variant_not_available → pick Black M → confirm → checkout',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'розмір S є?',
        mediaReference: { mediaId: '18364353361207943', type: 'story_reply' },
      },
      { message: 'Black M' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Марина Лисенко, 0961234567, Вінниця, НП 4' },
    ],
  },

  clothing_split_delivery_info: {
    name: 'Clothing — Delivery info split across 3 messages',
    description: 'User sends full name, phone, and address as 3 separate DMs → debounce combines → order created',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'Є чорна футболка в розмірі M?' },
      { message: 'так' },
      { message: 'оформлюємо' },
      {
        message: [
          'Олена Коваленко',
          '0997654321',
          'Львів, НП 12',
        ],
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true },
          note: 'Debounce must combine 3 messages into one engine call so all delivery fields arrive together',
        },
      },
    ],
  },

  clothing_post_share: {
    name: 'Clothing — Post share (product card) + order',
    description: 'User shares a product post in DM, then asks to order → should resolve shared post to product',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу замовити',
        mediaReference: { mediaId: '18111766516836068', type: 'post_share' },
        expect: {
          state: { selectedProductId: '83895c2a-d769-477f-858a-c8496537fa5b' },
          note: 'Must resolve post_share to Zara базова футболка via instagram_media_mappings',
        },
      },
      { message: 'Black M' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  clothing_two_orders_in_row: {
    name: 'Clothing — Two orders in one conversation',
    description: 'Story reply order → completed → user asks new product → second order → completed',
    tenantId: CLOTHES_STORE,
    turns: [
      // First order: story reply → size M
      {
        message: 'розмір М є в наявності?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
      // Second order: direct variant query after first order completed
      {
        message: 'Є чорна футболка в розмірі M?',
        expect: {
          scenario: 'confirm_variant_available',
          imageCount: 1,
          state: { selectionState: 'awaiting_confirmation', selectedVariantName: 'Black, M' },
          note: 'Post-order new inquiry must reset state and resolve to confirm_variant_available with variant image',
        },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  // ─── Critical regression scenarios ──────────────────────────────

  clothing_direct_variant_no_prequalify: {
    name: 'Critical — Direct variant without pre-qualify or story',
    description: 'User asks "є чорна M?" in plain DM, no story reply. Pre-qualify must NOT trigger when size is specified.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є куртка джек енд джонс чорна M?',
        expect: {
          scenario: 'confirm_variant_available',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Bug 1 regression test: pre-qualify must not fire when entities.size is present',
        },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Тарас Шевченко, 0991234567, Київ, НП 1' },
    ],
  },

  price_inquiry_with_size: {
    name: 'Critical — Price inquiry with size (no pre-qualify)',
    description: 'User asks "скільки коштує футболка M?" — pre-qualify must NOT fire for price questions with size',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'скільки коштує футболка M?',
        expect: {
          note: 'Price inquiry with size: must show price, not trigger pre-qualify. selectionState should NOT be awaiting pre-qualify data.',
        },
      },
    ],
  },

  // ─── Multi-turn edge cases ─────────────────────────────────────

  adds_to_cart_different_product: {
    name: 'Multi-Cart — Two DIFFERENT products (beauty)',
    description: 'Pick Silk Color Nude Pink → confirm → add Color Veil Terracotta → confirm → checkout → order',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'і ще Color Veil Terracotta' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'оформлюємо' },
      {
        message: 'Марія Шевченко, 0501234567, Одеса, НП 3',
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true, cartLength: 2 },
          note: 'Cart must contain 2 different products (Silk Color + Color Veil)',
        },
      },
    ],
  },

  post_order_passive_then_new: {
    name: 'Post-order — Passive ack then new inquiry',
    description: 'Complete order → "дякую" (passive ack) → new product question → must reset and start fresh',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'Є чорна футболка в розмірі M?' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Андрій Коваль, 0991234567, Київ, НП 5' },
      {
        message: 'дякую',
        expect: {
          decision: 'reply',
          replyContains: 'Будь ласка',
          state: { orderCreated: true },
          note: 'Post-order passive intent → ack reply, state preserved',
        },
      },
      {
        message: 'а є синя футболка в розмірі L?',
        expect: {
          state: { selectionState: 'awaiting_confirmation' },
          note: 'New inquiry after passive ack → state must be reset, variant auto-selected',
        },
      },
    ],
  },

  greeting_reset_stale_flow: {
    name: 'Greeting — Reset after stale incomplete flow',
    description: 'Start product flow → leave unfinished → "Привіт" → must reset stale state',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'хочу футболку' },
      { message: '175 см, 70 кг' },
      // Flow is now at selectionState=awaiting_product — user abandons and greets later
      {
        message: 'Привіт',
        expect: {
          scenario: 'greeting',
          note: 'Greeting after stale incomplete flow must reset selectionState (Fix 3 hardening)',
        },
      },
    ],
  },

  // ─── FAQ edge cases ─────────────────────────────────────────────

  faq_mid_checkout: {
    name: 'FAQ — Delivery question mid-checkout',
    description: 'User in checkout asks "як доставка?" → answer FAQ without resetting cart/state',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'Є чорна футболка в розмірі M?' },
      { message: 'так' },
      {
        message: 'як відбувається доставка?',
        expect: {
          note: 'FAQ mid-flow must answer delivery question without clearing cart or selection state',
        },
      },
      { message: 'оформлюємо' },
      { message: 'Андрій Коваль, 0991234567, Київ, НП 5' },
    ],
  },

  // ─── Greeting & state reset scenarios ────────────────────────────

  greeting_fresh: {
    name: 'Greeting — Fresh start, no prior state',
    description: 'Pure greeting → should respond with greeting template, no product context',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'Привіт',
        expect: {
          scenario: 'greeting',
          note: 'Pure greeting must not trigger product search or pre-qualify',
        },
      },
    ],
  },

  greeting_with_product: {
    name: 'Greeting — With product intent in same message',
    description: '"Привіт, є куртки?" → should keep category entity and show products, not just greet',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'Привіт, є куртки?',
        expect: {
          note: 'Greeting with entities must NOT reset state — category "Куртки" should be preserved',
        },
      },
    ],
  },

  // ─── Edge case scenarios ────────────────────────────────────────

  price_inquiry_direct: {
    name: 'Price inquiry — Direct question about product price',
    description: 'User asks about price without story context → should search and show price',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'скільки коштує Zara базова футболка?' },
    ],
  },

  out_of_stock_size: {
    name: 'Out of stock — Requested size unavailable',
    description: 'User asks for XXL via story reply which doesn\'t exist → should show available sizes',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є XXL?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
        expect: {
          note: 'XXL does not exist for this product — should show available sizes or out_of_stock',
        },
      },
    ],
  },

  delivery_faq: {
    name: 'FAQ — Delivery question',
    description: 'User asks about delivery without product context → should answer FAQ',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'як відбувається доставка?' },
    ],
  },

  payment_faq: {
    name: 'FAQ — Payment question',
    description: 'User asks about payment methods → should answer FAQ',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'які способи оплати?' },
    ],
  },

  recommendation_request: {
    name: 'Recommendation — User asks bot to choose',
    description: 'User browsing products asks "порадьте щось" → should recommend from shown products',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'хочу футболку' },
      { message: '175 см, 70 кг' },
      { message: 'порадьте, яку краще взяти' },
    ],
  },

  multi_message_first_turn: {
    name: 'Debounce — Multi-message first inquiry',
    description: 'User sends product question as 2 separate messages within debounce window',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: [
          'Привіт',
          'є чорна футболка?',
        ],
        expect: {
          note: 'Debounce combines greeting + product question — should search for product, not just greet',
        },
      },
    ],
  },

  beauty_color_variant: {
    name: 'Beauty — Direct color variant pick',
    description: 'User asks for specific lipstick color → should match variant and confirm',
    tenantId: PILOT_STORE,
    turns: [
      { message: 'хочу помаду Silk Color Nude Pink' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Анна Петренко, 0991234567, Київ, НП 5' },
    ],
  },

  // ─── Handoff scenarios ───────────────────────────────────────────
  // NOTE: Simulator calls replyEngine.process() directly — no Telegram
  // or Instagram messages are sent. Safe to run without side effects.

  handoff_complaint: {
    name: 'Handoff — Customer complaint',
    description: 'Customer complains about quality → should escalate to manager',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'я отримала замовлення і якість жахлива, шви розходяться, хочу повернення' },
    ],
  },

  handoff_request_human: {
    name: 'Handoff — Explicit manager request',
    description: 'Customer explicitly asks to talk to a human manager',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'можна поговорити з менеджером?' },
    ],
  },

  handoff_mid_flow: {
    name: 'Handoff — Complaint mid-flow',
    description: 'Customer starts shopping then gets frustrated and complains',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є розмір М?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      { message: 'чому так дорого? це неадекватна ціна за таке, хочу знижку або повернення' },
    ],
  },

  handoff_unknown_product: {
    name: 'Handoff — Product not found',
    description: 'Customer asks for product that does not exist → product_not_found → handoff',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'є кросівки Nike Air Max 97?' },
    ],
  },

  handoff_support_issue: {
    name: 'Handoff — Delivery/order problem',
    description: 'Customer has an issue with existing order delivery',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'де моє замовлення? я замовляв тиждень тому і досі немає трек-номера' },
    ],
  },
};
