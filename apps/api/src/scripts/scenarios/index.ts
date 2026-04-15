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
  message: string;
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

  clothing_post_share: {
    name: 'Clothing — Post share (product card) + order',
    description: 'User shares a product post in DM, then asks to order → should resolve shared post to product',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу замовити',
        mediaReference: { mediaId: '18111766516836068', type: 'post_share' },
        expect: {
          note: 'Must resolve post_share to Zara базова футболка via instagram_media_mappings',
        },
      },
      { message: 'M' },
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
