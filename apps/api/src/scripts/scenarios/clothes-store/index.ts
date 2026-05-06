// Clothes Store — clothing, size variants, pre-qualify enabled.

import { CLOTHES_STORE, DEMO_WOMEN_CLOTHES_SLUG, SimulatorScenario } from '../types';

export const CLOTHES_STORE_SCENARIOS: Record<string, SimulatorScenario> = {
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

  pre_qualify_flow: {
    name: 'Pre-Qualify — Clothing with height/weight (legacy before_search)',
    description: 'Product inquiry → pre-qualify ask → filtered results → pick → confirm → order. Pinned to before_search via override (clothes-store DB defaults to after_search_offered for the new demo UX).',
    tenantId: CLOTHES_STORE,
    flowConfigOverride: { preQualifyStrategy: 'before_search' },
    turns: [
      { message: 'хочу футболку' },
      { message: '180 см, 75 кг' },
      { message: 'перша' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

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
    description: 'Product with both color and size → pick color → pick size → confirm. Pinned to before_search to preserve T1=ask, T2=params shape.',
    tenantId: CLOTHES_STORE,
    flowConfigOverride: { preQualifyStrategy: 'before_search' },
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
    description: 'Browse by category (куртки) → pick product → pick size → confirm. Pinned to before_search.',
    tenantId: CLOTHES_STORE,
    flowConfigOverride: { preQualifyStrategy: 'before_search' },
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
    description: 'Pick color+size → correct to different color before confirming. Pinned to before_search.',
    tenantId: CLOTHES_STORE,
    flowConfigOverride: { preQualifyStrategy: 'before_search' },
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
      {
        message: 'розмір М є в наявності?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
      {
        message: 'Є чорна футболка в розмірі M?',
        expect: {
          scenario: 'confirm_variant_available',
          imageCount: 1,
          state: { selectionState: 'awaiting_confirmation', selectedVariantName: 'Чорний, M' },
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
    description: 'Start product flow → leave unfinished → "Привіт" → must reset stale state. Pinned to before_search so T2 is the natural answer to bot ask.',
    tenantId: CLOTHES_STORE,
    flowConfigOverride: { preQualifyStrategy: 'before_search' },
    turns: [
      { message: 'хочу футболку' },
      { message: '175 см, 70 кг' },
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
    description: 'User browsing products asks "порадьте щось" → should recommend from shown products. Pinned to before_search.',
    tenantId: CLOTHES_STORE,
    flowConfigOverride: { preQualifyStrategy: 'before_search' },
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

  // ─── Customer photo scenarios ────────────────────────────────────

  customer_photo_unrelated: {
    name: 'Customer Photo — Unrelated image (handoff)',
    description: 'Customer sends a random photo (not a product) → vision finds no match → handoff',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'є таке?',
        mediaReference: {
          mediaId: 'https://placehold.co/600x400/EEE/31343C.png?text=Random+Photo',
          type: 'customer_photo',
        },
        expect: {
          decision: 'handoff',
          note: 'Random image must not match any linked product → handoff with holding message',
        },
      },
    ],
  },

  customer_photo_matches_linked_post: {
    name: 'Customer Photo — Matches already-linked post (vision)',
    description:
      'Customer sends a photo that is the same as one of the linked post/story images. ' +
      'Vision matches it to the linked product → continue normal flow (pick variant → order).',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'ось таке є у вас?',
        mediaReference: { mediaId: '__RESOLVED_AT_RUNTIME__', type: 'customer_photo' },
        resolveMediaFromLinkedProduct: true,
        expect: {
          decision: 'reply',
          note: 'Vision must detect match to linked product → NOT handoff. Reply engine continues the normal flow.',
          replyNotContains: 'Секунду, зараз перевірю',
        },
      },
      { message: 'M' },
      { message: 'так' },
      { message: 'оформлюємо' },
      { message: 'Олена Коваленко, 0997654321, Львів, НП 12' },
    ],
  },

  customer_photo_mid_flow: {
    name: 'Customer Photo — Mid-flow photo derails into handoff',
    description: 'Shopping flow interrupted by an unrelated photo → vision finds no match → handoff',
    tenantId: CLOTHES_STORE,
    turns: [
      { message: 'хочу футболку' },
      {
        message: 'а ось таке',
        mediaReference: {
          mediaId: 'https://placehold.co/600x400/DDDDDD/000000.png?text=Mid+Flow+Photo',
          type: 'customer_photo',
        },
        expect: {
          decision: 'handoff',
          note: 'Photo sent mid-flow that does not match any linked product must handoff',
        },
      },
    ],
  },

  // ─── Size chart scenarios ────────────────────────────────────────

  size_chart_request_no_chart: {
    name: 'Size Chart — Request with no chart configured (silent handoff)',
    description:
      'Customer asks for a size chart but tenant has none uploaded → silent handoff (no holding message).',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'а розмірна сітка Versace є?',
        expect: {
          decision: 'handoff',
          replyNotContains: ['Секунду', 'уточню', 'сітка'],
          note: 'No matching chart → silent handoff (reply.text must be null, not a holding message).',
        },
      },
    ],
  },

  size_chart_false_positive_availability: {
    name: 'Size Chart — Availability question must NOT trigger chart',
    description:
      'Customer asks whether size M is in stock — classifier must treat as availability_check, not size_chart_request.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'у вас є розмір М?',
        expect: {
          replyNotContains: ['розмірна сітка', 'uploads/'],
          note: 'Must classify as availability_check / show_products — NOT size_chart_request.',
        },
      },
    ],
  },

  size_chart_false_positive_recommendation: {
    name: 'Size Chart — Recommendation question must NOT trigger chart',
    description:
      'Customer gives height/weight and asks what fits — ask_recommendation / pre-qualify path, not size chart.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'що мені підійде? 170см 60кг',
        expect: {
          replyNotContains: ['розмірна сітка', 'uploads/'],
          note: 'Classifier must pick ask_recommendation / pre-qualify, NOT size_chart_request.',
        },
      },
    ],
  },

  size_chart_request_with_product: {
    name: 'Size Chart — Request with product context (requires pre-seeded chart)',
    description:
      'Story-reply to a Zara t-shirt, then ask for the size chart. ' +
      'REQUIRES a size_charts row tagged brand=zara or category=футболки to be uploaded in the admin panel before this scenario passes the positive assertion.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'розмір М є в наявності?',
        mediaReference: { mediaId: '17983952801809405', type: 'story_reply' },
      },
      {
        message: 'а розмірна сітка є?',
        expect: {
          imageCount: 1,
          scenario: 'show_size_chart',
          note: 'With a seeded chart, must respond with the chart image attached. Without one, this scenario falls back to silent handoff and fails the imageCount assertion — that is the expected failure mode documenting the feature is wired correctly but not provisioned.',
        },
      },
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

  // ─── after_search_offered flow (clothes-store DB default) ──────

  clothing_after_search_yes_to_offer: {
    name: 'Clothing — after_search_offered, user accepts size help',
    description:
      'T1 product browse → bot shows products + offer suffix; T2 "так" → bot asks height/weight; T3 "180 80" → recommend size, show filtered products with prefix.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу футболку',
        expect: {
          replyContains: ['Хочете, допоможу з розміром'],
          state: { awaitingPreQualifyAnswer: true, shouldOfferSizeHelp: true },
        },
      },
      {
        message: 'так',
        expect: {
          replyContains: ['зріст', 'вагу'],
          state: {
            awaitingPreQualifyAnswer: false,
            lastAction: 'asked_pre_qualify',
            awaitingField: 'pre_qualify_data',
          },
        },
      },
      {
        message: '180 80',
        expect: {
          replyContains: ['рекомендую розмір'],
          state: { preQualifyCollected: true, recommendedSize: 'L' },
        },
      },
    ],
  },

  clothing_after_search_no_to_offer: {
    name: 'Clothing — after_search_offered, user declines size help',
    description:
      'T1 product browse → offer; T2 "ні" → short ack reply, no re-offer; flags cleared.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу футболку',
        expect: {
          replyContains: ['Хочете, допоможу з розміром'],
          state: { awaitingPreQualifyAnswer: true },
        },
      },
      {
        message: 'ні, дякую',
        expect: {
          replyNotContains: ['зріст', 'вагу'],
          state: {
            awaitingPreQualifyAnswer: false,
            lastAction: 'declined_offer',
          },
        },
      },
    ],
  },

  clothing_after_search_skip_offer_pick_variant: {
    name: 'Clothing — after_search_offered, user picks variant directly',
    description:
      'T1 offer; T2 user names a color ("беру синю") — entities present → not yes/no, ignore offer, continue normal flow. State flags cleared.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу футболку',
        expect: {
          replyContains: ['Хочете, допоможу з розміром'],
          state: { awaitingPreQualifyAnswer: true },
        },
      },
      {
        message: 'беру синю',
        expect: {
          replyNotContains: ['зріст', 'вагу'],
          state: { awaitingPreQualifyAnswer: false, shouldOfferSizeHelp: false },
        },
      },
    ],
  },

  clothing_size_in_first_message: {
    name: 'Clothing — size short-circuit on first message (after_search_offered)',
    description:
      'T1 user provides size upfront ("розміру M") → entities.size short-circuits gate; no offer suffix appended (user already gave size).',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу футболку розміру M',
        expect: {
          replyNotContains: ['Хочете, допоможу з розміром'],
        },
      },
    ],
  },

  clothing_help_size: {
    name: 'Clothing — user asks for size help directly',
    description:
      'User asks for size help without waiting for offer → should respond with pre-qualify questions',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'хочу замовити сукню',
      }, 
      {
        message: 'допоможіть з розміром',
        expect: {
          replyContains: ['зріст', 'вагу'],
          state: { awaitingPreQualifyAnswer: false, lastAction: 'asked_pre_qualify', awaitingField: 'pre_qualify_data' },
        },
      }
    ]
  }, 

  clothing_correction_ask_size_for_color: {
    name: 'Clothing — correction with color → ask_size_for_color',
    description:
      'User corrects mid-confirmation with new product + color (no size). Bot must ask only for size, with dedicated wording, listing only sizes available for that color. Uses Zara midi сукня (White/Brown × XS/S/M/L) since Mango Сукня міді is single-color.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'хочу сукню' },
      { message: 'Mango коктейльна' },
      { message: 'так' },
      {
        message: 'ні давайте краще Zara midi білу',
        expect: {
          scenario: 'ask_size_for_color',
          replyContains: ['Zara midi', 'розмір'],
          replyNotContains: ['Який вам подобається'],
          state: {
            selectionState: 'awaiting_variant',
          },
        },
      },
    ],
  },

  clothing_chart_attached_size_for_color: {
    name: 'Clothing — ask_size_for_color attaches Zara size chart as second reply',
    description:
      'Single-product context (Zara midi сукня) + size-asking scenario + Zara chart row exists (brand-only fallback since Zara chart categories don\'t include "сукні") → engine emits 2 replies: primary partial-variant question + chart bubble.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'хочу сукню' },
      { message: 'Mango коктейльна' },
      { message: 'так' },
      {
        message: 'ні давайте краще Zara midi білу',
        expect: {
          scenario: 'ask_size_for_color',
          extraReplyCount: 1,
          extraReplyImageContains: 'demo-chart-zara',
        },
      },
    ],
  },

  clothing_chart_skipped_color_for_size: {
    name: 'Clothing — ask_color_for_size does NOT attach chart (size already locked)',
    description:
      'When size is the known axis and color is being asked, the chart is not relevant. Verify silent skip.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'хочу сукню' },
      {
        message: 'Zara midi сукня розмір M',
        expect: {
          scenario: 'ask_color_for_size',
          extraReplyCount: 0,
        },
      },
    ],
  },

  clothing_chart_skipped_two_step_color_first: {
    name: 'Clothing — ask_variant_choice on color step does NOT attach chart',
    description:
      'Both axes ambiguous → engine starts two-step flow with color (variantStep=color). Per the trigger gate, chart fires ONLY on the size step. The color-step turn must NOT include chart.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'хочу сукню' },
      {
        message: 'Zara midi сукня',
        expect: {
          scenario: 'ask_variant_choice',
          extraReplyCount: 0,
          imageCount: 2,
        },
      },
    ],
  },

  clothing_size_in_first_message_ask_color_for_size: {
    name: 'Clothing — product + size on second turn → ask_color_for_size',
    description:
      'After multiple products shown, user names a specific product + size only ("Zara midi сукня розмір M"). Color ambiguous (White M and Brown M both exist). Bot must ask only for color with dedicated wording.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'хочу сукню' },
      {
        message: 'Zara midi сукня розмір M',
        expect: {
          scenario: 'ask_color_for_size',
          replyContains: ['Білий', 'Коричневий', 'M'],
          replyNotContains: ['Який вам подобається'],
          state: {
            selectionState: 'awaiting_variant',
          },
        },
      },
    ],
  },

  clothing_two_products_recommend: {
    name: 'Clothing — Two products + height/weight must keep both in scope',
    description:
      'After 2 products are shown and user provides height/weight, bot must NOT silently narrow to the first product. Either both products stay in consideration, or bot asks which one. Captures the regression where T1 unconditionally sets selectedProductId to the first product, locking T2 narrowing onto a single product.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          replyContains: ['Mango Сукня міді', 'Mango Сукня коктейльна'],
          state: {
            selectionState: 'awaiting_product',
            selectedProductId: null,
          },
        },
      },
      {
        message: '170 60',
        expect: {
          replyContains: ['Mango Сукня коктейльна'],
        },
      },
    ],
  },

  clothing_suggestion_multiple_variants: {
    name: 'Clothing — Suggestion with multiple variants available',
    description:
      'After recommendation narrows to size L, user picks Zara midi сукня but White+L and Brown+L both exist → bot must ask which color, not auto-pick.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'хочу сукню',
      },
      {
        message: '170 см 70 кг',
      },
      {
        message: 'давайте Zara midi сукню',
        expect: {
          scenario: 'ask_variant_choice',
          replyContains: ['Білий', 'Коричневий'],
          replyNotContains: ['оформлюємо?'],
          imageCount: 2,
          state: {
            selectionState: 'awaiting_variant',
            recommendedSize: 'L',
          },
        },
      }
    ]
  },

  clothing_offer_accept_with_product_specifics: {
    name: 'Clothing — Offer accept with new product+size specifics (PRIMARY/gating)',
    description:
      'After bot offers size help ("Хочете, допоможу з розміром?"), user replies with NEW product + size in a single utterance. Classifier may misclassify this as slot_action=confirmation (because the message starts with "давайте", a pure-accept marker). The engine must still resolve the variant correctly — Fix B at reply-engine 5.5c gates on confirmation+entities, Fix A trains the classifier to prefer fills_missing_slot. Targets H&M Плаття міді чорне (single-axis, sizes S/M/L) so the resolution is deterministic regardless of which color/size axis the classifier emphasizes.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'хочу плаття',
        expect: {
          replyContains: ['Хочете', 'розміром'],
        },
      },
      {
        message: 'давайте H&M Плаття міді чорне, розмір М',
        expect: {
          scenario: 'confirm_variant_available',
          replyContains: ['H&M', 'M'],
          state: {
            selectionState: 'awaiting_confirmation',
          },
        },
      },
    ],
  },

  clothing_color_in_title_size_only_variant_repro: {
    name: 'Clothing — color-in-title + size-only variant (regression guard)',
    description:
      'Regression guard for the conv 22e5fdcc stuck-state bug. JACK&JONES Темно-сині карго штани has the color in the product title (no color variant axis). Pre-fix: when the user picked the product with "давайте сині", the engine entered two-step variant flow (variantStep=size). On "давайте 32", the variant matcher rejected all variants because classifier returned entities.color="сині" but variants have color=null — selectedVariantId never got set, conversation stuck in awaiting_variant, every subsequent turn fell to ai_fallback. Fix: matchVariant skips the color filter when no variant has a color axis (color is title-match only). 5.5c match-failure routes to single-axis ask_variant_choice for sizes when no color axis exists, NOT to two-step ask_size_for_color.',
    tenantId: CLOTHES_STORE,
    turns: [
      {
        message: 'хочу штани',
        expect: {
          scenario: 'show_products',
          replyContains: ['JACK&JONES'],
        },
      },
      {
        message: 'давайте сині',
        expect: {
          // Color-in-title product → narrowed to JACK&JONES, single-axis
          // (sizes only). Engine should NOT enter two-step flow. Routes to
          // ask_variant_choice asking for size with all 4 sizes listed.
          state: {
            selectionState: 'awaiting_variant',
            variantStep: null,
          },
          note: 'No color axis on variants → engine stays single-axis, asks for size via ask_variant_choice. variantStep stays null.',
        },
      },
      {
        message: 'давайте 32',
        expect: {
          // matchVariant now bypasses color filter (no color axis), matches
          // size 32 against the 4 variants → 1 unique match → resolves to
          // confirm_variant_available (since user provided a size).
          scenario: 'confirm_variant_available',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedVariantName: '32',
          },
          note: 'Variant matcher resolves size 32 despite redundant color="сині" entity.',
        },
      },
      {
        message: 'оформлюємо',
        expect: {
          // Standard flow: confirmation in awaiting_confirmation triggers
          // 5.5a cart-add, then ask_continue_or_checkout fires.
          scenario: 'ask_continue_or_checkout',
          state: {
            selectionState: 'cart_item_added',
            cartLength: 1,
          },
        },
      },
      {
        message: 'оформлюємо',
        expect: {
          scenario: 'collect_checkout_info',
          replyContains: ['ПІБ'],
        },
      },
      {
        message: 'ханас олександр\n0991345713\nтернопіль нп 2',
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true },
          replyContains: ['JACK&JONES', '1999 грн'],
        },
      },
    ],
  },
}
