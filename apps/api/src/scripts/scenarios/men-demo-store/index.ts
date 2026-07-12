// Simulator scenarios for the men-demo-store tenant.
//
// The tenant has been copied to local (catalog + variants + size charts +
// templates + media), so these run locally as well as on prod.
//
// The first five scenarios are derived from real production traces:
//   ad5e44ac — story reply → "Яка ціна?"      (price on a media-resolved product)
//   37fb5032 — then "Є розмір М?"             → product_not_found handoff (M was in stock)
//   f73b4cc1 — "допоможіть з розміром"        → recommend_product (sales blurb, not size help)
//
// The rest broaden coverage: this is the cleanest tenant we have, so it doubles
// as the measuring instrument for classifier A/B tests. Each of those targets a
// family where a classifier can plausibly differ AND that has a single
// deterministic correct answer — checkout commit, fit-question vs fit-statement,
// a size that does not exist, a question the catalog cannot answer, entity leak
// across a product pivot.
//
// Catalog facts these assertions depend on (verified in DB):
//   - all 4 products are SIZE-ONLY (no colour axis), every variant in stock
//   - Сорочка з льону        1599 грн, S/M/L      story media 17934760002319883
//   - Шорти джинсові світлі  1199 грн, S/M/L      story media 17889274518596043
//   - Футболка базова чорна   699 грн, S/M/L/XL   ← the ONLY product with XL
//   - Джинси МОМ світлі      1499 грн, S/M/L      ← no XL (used by the XL scenario)
//   - NO product has a description → any attribute question must hand off
//   - flow_config = {} → sizeHelpMode resolves to 'chart'
//   - size_charts: Верх (сорочки, футболки…), Низ (джинси, шорти) — no brands
//   - `show_size_chart` requires {brand} + {name}; with no brand on the
//     chart the template is non-viable, so the reply falls back to the
//     hardcoded 'Ось наша розмірна сітка 💛'. Assert on that, not the
//     template text.
//   - templates include the full checkout set (ask_continue_or_checkout,
//     collect_checkout_info, confirm_order, order_confirmed_ask_delivery)

import { SimulatorScenario, MEN_DEMO_STORE } from '../types';

const SHIRT_STORY = { mediaId: '17934760002319883', type: 'story_reply' };
const SHORTS_STORY = { mediaId: '17889274518596043', type: 'story_reply' };

export const MEN_DEMO_STORE_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── Trace ad5e44ac: price on a story-resolved product ──────────
  men_demo_story_price_offers_variants: {
    name: 'men-demo — Story reply → price quotes the in-stock sizes',
    description:
      'Customer replies to the Сорочка з льону story asking the price. ' +
      'The product resolves from the media mapping (needsSearch=false), ' +
      'and because it has 3 sizes in stock and none is chosen, the reply ' +
      'must upgrade to show_price_with_variants — quoting the price AND ' +
      'offering the sizes, leaving the flow in awaiting_variant.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Яка ціна?',
        mediaReference: SHIRT_STORY,
        expect: {
          decision: 'reply',
          scenario: 'show_price_with_variants',
          replyContains: ['Сорочка з льону', '1599', 'S', 'M', 'L'],
          state: { selectionState: 'awaiting_variant' },
          note: 'Media pre-seed also names selectionState (was undefined before)',
        },
      },
      {
        message: 'M',
        expect: {
          decision: 'reply',
          state: { selectedVariantName: 'M', selectionState: 'awaiting_confirmation' },
          note: 'Size reply resolves on a size-only product',
        },
      },
    ],
  },

  // ─── Trace 37fb5032: bare size question must not hand off ───────
  men_demo_focused_size_question_no_handoff: {
    name: 'men-demo — "Є розмір М?" on the focused product does not hand off',
    description:
      'The regression this whole change exists for. After the price turn ' +
      'the shirt is in focus. "Є розмір М?" yields entities={size:M} and ' +
      'no product identifier, so the old engine searched with an empty ' +
      'query, got 0 rows, and escalated product_not_found — while M was ' +
      'in stock. The focus gate must hydrate the shirt by id instead.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Яка ціна?',
        mediaReference: SHIRT_STORY,
        expect: { decision: 'reply', note: 'Shirt enters focus via media' },
      },
      {
        message: 'Є розмір М?',
        expect: {
          decision: 'reply',
          replyNotContains: ['уточню наявність'],
          note: 'MUST NOT hand off — M is in stock on the focused product',
        },
      },
    ],
  },

  // ─── Trace f73b4cc1: size help sends the chart, not a blurb ─────
  men_demo_size_help_sends_chart: {
    name: 'men-demo — "допоможіть з розміром" sends the size chart',
    description:
      'flow_config={} → sizeHelpMode=chart, and the tenant has authored ' +
      'size_charts. The mid-flow size-help branch must delegate to ' +
      'size_chart_request, attach the chart image, and ask which size — ' +
      'not render recommend_product ("чудова якість та гарні відгуки").',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Хочу замовити сорочку',
        expect: { decision: 'reply', note: 'Shirt enters focus via search' },
      },
      {
        message: 'допоможіть з розміром',
        expect: {
          decision: 'reply',
          scenario: 'show_size_chart',
          imageCount: 1,
          replyContains: ['розмірна сітка', 'В наявності', 'Який вам підходить?'],
          replyNotContains: ['відгуки'],
          state: { selectionState: 'awaiting_variant', variantStep: null },
          note:
            'Chart mode. variantStep stays null — this product has no ' +
            'colour axis, and variantStep=size would strand the next turn.',
        },
      },
      {
        message: 'L',
        expect: {
          decision: 'reply',
          state: { selectedVariantName: 'L' },
          note: 'Size picked off the chart resolves against the focused product',
        },
      },
    ],
  },

  // ─── Size chart resolves per category (Верх vs Низ) ─────────────
  men_demo_size_chart_category_scoped: {
    name: 'men-demo — Size help on shorts resolves the Низ chart',
    description:
      'Charts are category-scoped: Верх covers сорочки/футболки, Низ ' +
      'covers джинси/шорти. Asking for size help while shorts are in ' +
      'focus must resolve a chart via the product category rather than ' +
      'handing off with size_chart_not_available.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Яка ціна?',
        mediaReference: SHORTS_STORY,
        expect: {
          decision: 'reply',
          replyContains: '1199',
          note: 'Shorts enter focus via story media',
        },
      },
      {
        message: 'допоможіть з розміром',
        expect: {
          decision: 'reply',
          scenario: 'show_size_chart',
          imageCount: 1,
          note: 'Низ chart resolved from category=Шорти, not a handoff',
        },
      },
    ],
  },

  // ─── Pivot to another category still escalates ──────────────────
  men_demo_category_pivot_still_escalates: {
    name: 'men-demo — Pivot to an unstocked category still hands off',
    description:
      'Negative control for the focus gate and the product_not_found ' +
      'guard. A turn naming a DIFFERENT category is a pivot, not a ' +
      'question about the focused product: the gate must not fire, the ' +
      'search must run, and 0 rows must still escalate to a human. This ' +
      'tenant stocks no куртки.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Яка ціна?',
        mediaReference: SHIRT_STORY,
        expect: { decision: 'reply', note: 'Shirt enters focus' },
      },
      {
        message: 'А куртки зимові є?',
        expect: {
          decision: 'handoff',
          note: 'Pivot → fresh search → 0 rows → escalate, despite a focused product',
        },
      },
    ],
  },

  // ─── Checkout: the flip that used to drop the cart ──────────────
  men_demo_full_checkout: {
    name: 'men-demo — Full checkout creates the order',
    description:
      'men-demo had NO checkout scenario despite authoring every checkout ' +
      'template. This is the regression guard for the bug where "оформлюємо" ' +
      'on a full cart classified as ready_to_order/ask_delivery instead of ' +
      'ready_to_order/start_checkout: the narrow cart gate missed, the engine ' +
      'fired an empty-keyword search, got 0 rows, and escalated ' +
      'product_not_found — dropping a sale the customer had already agreed to. ' +
      'The turn must reach collect_checkout_info regardless of which ' +
      'recommendedAction the classifier picks.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Хочу замовити джинси',
        expect: { decision: 'reply', note: 'Jeans enter focus' },
      },
      {
        message: 'M',
        expect: {
          decision: 'reply',
          state: { selectedVariantName: 'M' },
          note: 'Size resolves on a size-only product',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          scenario: 'ask_continue_or_checkout',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
          note: 'Confirmation adds to cart and asks continue-or-checkout',
        },
      },
      {
        message: 'оформлюємо',
        expect: {
          decision: 'reply',
          scenario: 'collect_checkout_info',
          replyNotContains: ['уточню наявність'],
          note:
            'THE BUG. Must never hand off: the cart is the payload, there is ' +
            'nothing to search for. Guarded by isCheckoutCommitOnFullCart.',
        },
      },
      {
        message: 'Олександр Ханас, 0991234567, Тернопіль, НП 3',
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true },
          note: 'Delivery details complete the order',
        },
      },
    ],
  },

  // ─── adds_to_cart must still search (the predicate's bail) ──────
  men_demo_adds_to_cart_second_item: {
    name: 'men-demo — "і ще сорочку" adds a second item, then checks out',
    description:
      'Negative control for isCheckoutCommitOnFullCart: a turn with a full ' +
      'cart that says "і ще сорочку" is slot_action=adds_to_cart and MUST ' +
      'still fire a search for the new product — the checkout predicate bails ' +
      'on adds_to_cart precisely so this keeps working. Then the real ' +
      'checkout turn creates a 2-item order.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      { message: 'Хочу замовити джинси', expect: { decision: 'reply' } },
      { message: 'M', expect: { decision: 'reply' } },
      {
        message: 'так',
        expect: { state: { cartLength: 1 }, note: 'First item in cart' },
      },
      {
        message: 'і ще сорочку',
        expect: {
          decision: 'reply',
          replyContains: ['Сорочка з льону'],
          note: 'adds_to_cart with a new product → must SEARCH, not check out',
        },
      },
      { message: 'L', expect: { decision: 'reply' } },
      {
        message: 'так',
        expect: {
          state: { cartLength: 2 },
          note: 'Second item joins the cart',
        },
      },
      {
        message: 'оформлюємо',
        expect: {
          decision: 'reply',
          scenario: 'collect_checkout_info',
          note: 'Now the checkout commit fires, with 2 items',
        },
      },
      {
        message: 'Олександр Ханас, 0991234567, Тернопіль, НП 3',
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true, cartLength: 2 },
          note: 'Multi-item order created',
        },
      },
    ],
  },

  // ─── The fit-check family: question vs statement ────────────────
  men_demo_fit_question_asks_size_help: {
    name: 'men-demo — "L підійде?" is a fit QUESTION → size help',
    description:
      'Half of the classifier nuance family. A named size ending in "?" is a ' +
      'fit check ("will L fit me?"), not a pick and not a stock question. ' +
      'It classifies as ask_recommendation, and on a focused product the ' +
      'engine routes to size help — chart mode here — rather than rendering a ' +
      'recommend_product sales blurb about the item already on screen.',
    tenantId: MEN_DEMO_STORE,
    flaky: true,
    turns: [
      { message: 'Хочу замовити сорочку', expect: { decision: 'reply' } },
      {
        message: 'L підійде?',
        expect: {
          decision: 'reply',
          scenario: 'show_size_chart',
          replyNotContains: ['відгуки', 'чудова якість'],
          note:
            'Fit question → size help (chart), NOT a product blurb and NOT a ' +
            'silent latch of L as the chosen variant.',
        },
      },
    ],
  },

  men_demo_fit_statement_picks_size: {
    name: 'men-demo — "L підійде" (no "?") is a PICK → confirm',
    description:
      'The other half. The same words WITHOUT the question mark are a ' +
      'statement: the customer is choosing L. slot_action=fills_missing_slot ' +
      'and the engine must resolve the variant and move to confirmation — ' +
      'not send a size chart. This pair is the sharpest classifier ' +
      'discrimination test in the suite.',
    tenantId: MEN_DEMO_STORE,
    flaky: true,
    turns: [
      { message: 'Хочу замовити сорочку', expect: { decision: 'reply' } },
      {
        message: 'L підійде',
        expect: {
          decision: 'reply',
          state: { selectedVariantName: 'L' },
          note: 'Statement → pick L, not a size chart',
        },
      },
    ],
  },

  // ─── A size that does not exist must be named, not fuzzy-matched ─
  men_demo_unknown_size_xl_on_jeans: {
    name: 'men-demo — XL on jeans does not exist → say so, never match L',
    description:
      'XL exists on Футболка базова чорна but NOT on Джинси МОМ світлі ' +
      '(S/M/L only). The variant matcher must not fuzzy-match XL→L (the ' +
      '"contains" strategy would, since "xl".includes("l")). The customer ' +
      'must be told XL is unavailable and offered the sizes that are.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      { message: 'Хочу замовити джинси', expect: { decision: 'reply' } },
      {
        message: 'у вас є XL?',
        expect: {
          decision: 'reply',
          scenario: 'variant_not_available',
          replyContains: ['S', 'M', 'L'],
          state: { selectedVariantName: null },
          note:
            'MUST NOT latch L. The size does not exist on this product — name ' +
            'it as unavailable and list the in-stock alternatives.',
        },
      },
    ],
  },

  // ─── Price → offer the sizes ────────────────────────────────────
  men_demo_price_then_variants: {
    name: 'men-demo — Price on a multi-size product offers the sizes',
    description:
      'Text-first counterpart to men_demo_story_price_offers_variants (which ' +
      'arrives via story media). A priced product with >1 in-stock variant and ' +
      'none chosen upgrades show_price → show_price_with_variants.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      {
        message: 'Скільки коштує сорочка з льону?',
        expect: {
          decision: 'reply',
          replyContains: ['1599'],
          note: 'Price quoted; sizes offered alongside it',
        },
      },
    ],
  },

  // ─── Never invent: no description ⇒ hand off ────────────────────
  men_demo_product_question_no_description_handoff: {
    name: 'men-demo — Question the catalog cannot answer hands off',
    description:
      'The never-invent guarantee. No product here has a description, so the ' +
      'grounded-answer judge can only work from title / category / price / ' +
      'variants. A question about washing behaviour is covered by NONE of ' +
      'those, so the judge must return NOT_COVERED and the bot must escalate ' +
      'rather than improvise care instructions.\n' +
      'NOTE: do NOT ask "з якої тканини?" here — the product is TITLED ' +
      '"Сорочка з льону", so the title itself answers it and the bot ' +
      'correctly replies "з льону". That is grounded, not invented. The ' +
      'question has to be one the catalog genuinely cannot support.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      { message: 'Хочу замовити сорочку', expect: { decision: 'reply' } },
      {
        message: 'Чи сідає вона після прання?',
        expect: {
          decision: 'handoff',
          note:
            'Nothing in title/category/price/variants covers shrinkage → ' +
            'NOT_COVERED → handoff. Must never fabricate care advice.',
        },
      },
    ],
  },

  // ─── Entity leak across a product pivot ─────────────────────────
  men_demo_history_leak_pivot: {
    name: 'men-demo — New product mid-conversation drops the old size',
    description:
      'The classifier carries entities forward from history: after picking M ' +
      'on the jeans, a turn naming a NEW product often comes back with ' +
      'size=M still attached, which would silently pre-select M on the ' +
      'shirt. The pivot must reset the variant — the customer never said ' +
      'what size shirt they want.',
    tenantId: MEN_DEMO_STORE,
    flaky: true,
    turns: [
      { message: 'Хочу замовити джинси', expect: { decision: 'reply' } },
      {
        message: 'M',
        expect: { state: { selectedVariantName: 'M' }, note: 'M chosen on the jeans' },
      },
      {
        message: 'А тепер хочу замовити сорочку',
        expect: {
          decision: 'reply',
          replyContains: ['Сорочка з льону'],
          state: { selectedVariantName: null },
          note:
            'Pivot to a new product must NOT carry size=M across. The shirt ' +
            'has its own S/M/L and the customer has not picked one.',
        },
      },
    ],
  },

  // ─── Post-order memory hygiene ──────────────────────────────────
  men_demo_post_order_new_inquiry: {
    name: 'men-demo — New inquiry after an order starts clean',
    description:
      'After an order is created the memory reset must clear the selected ' +
      'product, variant AND category. A stale selectedCategory silently ' +
      'filters the next search (a shirt inquiry after a jeans order returning ' +
      'jeans), so assert the new product actually surfaces.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      { message: 'Хочу замовити джинси', expect: { decision: 'reply' } },
      { message: 'M', expect: { decision: 'reply' } },
      { message: 'так', expect: { state: { cartLength: 1 } } },
      { message: 'оформлюємо', expect: { decision: 'reply' } },
      {
        message: 'Олександр Ханас, 0991234567, Тернопіль, НП 3',
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
      {
        message: 'А футболки у вас є?',
        expect: {
          decision: 'reply',
          replyContains: ['Футболка'],
          note:
            'Post-order reset: a stale category would filter this search back ' +
            'to jeans. The t-shirt must surface.',
        },
      },
    ],
  },

  // ─── FAQ mid-flow must not destroy the selection ────────────────
  men_demo_delivery_faq_mid_flow: {
    name: 'men-demo — Delivery question mid-selection keeps the selection',
    description:
      'A FAQ turn in the middle of a selection must answer from the delivery ' +
      'template and leave the chosen product/variant intact — the customer ' +
      'should not have to re-pick their size because they asked about Нова ' +
      'Пошта.',
    tenantId: MEN_DEMO_STORE,
    turns: [
      { message: 'Хочу замовити джинси', expect: { decision: 'reply' } },
      { message: 'M', expect: { state: { selectedVariantName: 'M' } } },
      {
        message: 'а як доставка?',
        expect: {
          decision: 'reply',
          scenario: 'answer_delivery',
          state: { selectedVariantName: 'M' },
          note: 'FAQ answered; the M selection survives the detour',
        },
      },
    ],
  },
};
