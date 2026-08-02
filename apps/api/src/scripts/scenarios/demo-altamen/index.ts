// Simulator scenarios for the demo-altamen tenant (Alta Men lead demo).
//
// Four top-level end-to-end order flows, one per headline category, each
// taking a different route to the same create_draft_order, plus four
// guards around the size-correction path (5-8):
//   1. Футболка — name a model in a category where every title shares the
//                 word «футболка»  (currently RED — bug guard, see its note)
//   2. Сорочка  — measurements → recommended size → pick
//   3. Шорти    — fast pick: model + colour + size in one message
//   4. Штани    — ask price first, then pick colour+size from the focused product
//
// Tenant config: businessType=clothing, preQualifyStrategy=before_search,
// sizeHelpMode=measurements, sizeChart S–3XL.
//
// Under `before_search` turn 1 ALWAYS asks for height/weight — the only
// exceptions are a turn that already carries a size, a turn with no product
// intent, and a story/post/screenshot whose product we resolved. So every
// scenario here opens with the measurements question and answers it on
// turn 2.

import { SimulatorScenario, DEMO_ALTAMEN_SLUG } from '../types';

const DELIVERY = 'Олександр Ханас, 0991234567, Тернопіль, НП 3';

/** Turn 1 is the height/weight question for every opener. */
const ASKS_MEASUREMENTS = {
  decision: 'reply' as const,
  replyContains: 'зріст',
  state: { awaitingField: 'pre_qualify_data' },
  note: 'before_search: ask before showing anything',
};

/** Turn 2 answers it — 182/78 maps to L on the men\'s chart (175-185 / 75-90). */
const RECOMMENDS_L = {
  decision: 'reply' as const,
  replyContains: 'L',
  replyNotContains: '💛',
  state: { preQualifyCollected: true, recommendedSize: 'L' },
  note: 'Recommendation rendered via the recommend_size template (no 💛)',
};

export const DEMO_ALTAMEN_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── 1. Футболка — model name inside a generic-token category ───
  demo_altamen_tshirt_order: {
    name: 'demo-altamen — T-shirt order (model + colour + size)',
    description:
      'RED — bug guard, not a passing test. Naming a specific model in ' +
      '«Футболки / Поло» resolves to a DIFFERENT product: every title in ' +
      'that category shares the token «футболка», so post-search narrowing ' +
      'picks by recency/overlap instead of honouring the model name. The ' +
      'other three scenarios pass end-to-end, which is what isolates this ' +
      'to product-name matching inside a generic-token category.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити футболку', expect: ASKS_MEASUREMENTS },
      { message: 'Зріст 182, вага 78', expect: RECOMMENDS_L },
      {
        message: 'давайте поло на блискавці хакі розмір L',
        expect: {
          decision: 'reply',
          replyContains: 'поло на блискавці',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'THE BUG: resolves to a different model entirely',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
        },
      },
      {
        message: 'оформлюємо',
        expect: { decision: 'reply', scenario: 'collect_checkout_info' },
      },
      {
        message: DELIVERY,
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
    ],
  },

  // ─── 2. Сорочка — the canonical before_search path ──────────────
  demo_altamen_shirt_measurements_order: {
    name: 'demo-altamen — Shirt order through the measurements flow',
    description:
      'The reference before_search flow: measurements up front, engine maps ' +
      '182/78 → L, customer then names model + colour + size and checks out. ' +
      'Also guards the `recommend_size` template override — the hardcoded ' +
      'engine prefix carries 💛, which a men\'s store must not emit.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити сорочку', expect: ASKS_MEASUREMENTS },
      { message: 'Зріст 182, вага 78', expect: RECOMMENDS_L },
      {
        message: 'Сорочка льон чорна розмір L',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedVariantName: 'Чорний, L',
          },
          note: 'Explicit size also skips the recommended-size variant filter',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          scenario: 'ask_continue_or_checkout',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
        },
      },
      {
        message: 'оформлюємо',
        expect: { decision: 'reply', scenario: 'collect_checkout_info' },
      },
      {
        message: DELIVERY,
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
    ],
  },

  // ─── 3. Шорти — model + colour + size in one message ────────────
  demo_altamen_shorts_fast_order: {
    name: 'demo-altamen — Shorts fast order (one-message pick)',
    description:
      'After measurements, the customer names everything at once and 5.5c ' +
      'resolves the exact variant (Хакі, M) in one hop on a merged ' +
      'multi-colour product — the flow the one-product-per-colour catalog ' +
      'could not express before the colour merge. The requested M also ' +
      'differs from the recommended L, so it doubles as a guard that an ' +
      'explicit size beats the recommendation.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити шорти', expect: ASKS_MEASUREMENTS },
      { message: 'Зріст 182, вага 78', expect: RECOMMENDS_L },
      {
        message: 'Шорти льон з манжетом хакі розмір M',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          replyContains: '2700',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedVariantName: 'Хакі, M',
          },
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          scenario: 'ask_continue_or_checkout',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
        },
      },
      {
        message: 'оформлюємо',
        expect: { decision: 'reply', scenario: 'collect_checkout_info' },
      },
      {
        message: DELIVERY,
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
    ],
  },

  // ─── 4. Штани — price question, then colour+size on the focus ───
  demo_altamen_pants_price_then_order: {
    name: 'demo-altamen — Pants order after a price question',
    description:
      'Customer asks the price of a named model and gets ' +
      'show_price_with_variants (>1 in-stock variant, none chosen). The ' +
      'follow-up names only colour + size — no product — so the focus gate ' +
      'must answer from the product already in focus rather than firing a ' +
      'fresh search.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити штани', expect: ASKS_MEASUREMENTS },
      { message: 'Зріст 182, вага 78', expect: RECOMMENDS_L },
      {
        message: 'Скільки коштують Брюки Santorini?',
        expect: {
          decision: 'reply',
          replyContains: '3400',
          note: 'Named product must not be pruned by the recommended-size filter',
        },
      },
      {
        message: 'Темно-сині, розмір L',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedVariantName: 'Темно-синій, L',
          },
          note: 'Focus gate: colour+size with no product name',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          scenario: 'ask_continue_or_checkout',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
        },
      },
      {
        message: 'оформлюємо',
        expect: { decision: 'reply', scenario: 'collect_checkout_info' },
      },
      {
        message: DELIVERY,
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
    ],
  },

  // ─── 5. Customer overrides the recommended size ─────────────────
  demo_altamen_size_correction_after_recommendation: {
    name: 'demo-altamen — Customer rejects the recommended size',
    description:
      'Measurements map 182/78 → L, products are shown scoped to L, and the ' +
      'customer then says «мені потрібен XL, а не L». A size the customer ' +
      'states OUT LOUD has to retire the chart-inferred one: `recommendedSize` ' +
      'is sticky (cleared only on a greeting or post-order reset) and silently ' +
      'drives the 5.5d variant filter, 5.5b-2/5.5c early-resolve and the ' +
      'size-suppressed rendering. Before the fix it stayed L and the customer ' +
      'was confirmed into — and ordered — the very size they had just ' +
      'rejected.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити сорочку', expect: ASKS_MEASUREMENTS },
      { message: 'Зріст 182, вага 78', expect: RECOMMENDS_L },
      {
        message: 'Мені потрібен розмір XL, а не L',
        expect: {
          decision: 'reply',
          // `recommendedSize` is set, so the sized header variant renders
          // instead of the plain list (see `show_products_with_size`).
          scenario: 'show_products_with_size',
          replyContains: 'XL',
          // The old failure: an unsolicited «З цих раджу … — чудова якість та
          // гарні відгуки», which also LATCHED that product, so the next «так»
          // bought a shirt the customer never picked.
          replyNotContains: ['раджу', 'чудова якість'],
          // The narrowed list is rebuilt in memory from
          // `lastPresentedProducts`, which carries no image data — without the
          // image re-hydration this turn renders text-only while the list it
          // narrows had photos.
          imageCountMin: 1,
          state: { recommendedSize: 'XL', selectedProductId: null },
          note: 'THE GUARD: re-show the shown list narrowed to XL, select nothing',
        },
      },
      {
        // Turns 4-7 used to open with a bare «так», which only worked because
        // the recommendation had pre-selected a product. With nothing latched
        // (correctly), the customer has to name what they want.
        message: 'Сорочка льон чорна',
        expect: {
          decision: 'reply',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedVariantName: 'Чорний, XL',
          },
          note: 'Resolves at XL — proves the rejected L is really gone',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          scenario: 'ask_continue_or_checkout',
          replyContains: 'XL',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
          note: 'The XL variant is what lands in the cart',
        },
      },
      {
        // Answering the bot's own «Дивимось ще щось чи оформлюємо?».
        message: 'оформлюємо',
        expect: { decision: 'reply', scenario: 'collect_checkout_info' },
      },
      {
        message: DELIVERY,
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
    ],
  },

  // ─── 7. Nothing shown carries that size → offer to look wider ───
  demo_altamen_narrow_no_match_broaden: {
    name: 'demo-altamen — «Пошукати ширше?» is a question the bot can answer',
    description:
      'A size correction none of the shown products can satisfy renders ' +
      '`narrowing_no_match`, which ASKS «Пошукати ширше в каталозі?». Nothing ' +
      'read `lastAction=\'narrow_no_match\'`, so «так» fell through to generic ' +
      'routing — the bot asked a question it had no way to act on. Corrections ' +
      'never reached this before (they always searched the DB), so admitting ' +
      'them to the narrow path is what made the dead end reachable.\n' +
      'Uses a shoe size on purpose: 42 exists in the catalog (the footwear ' +
      'products) but on no shirt, so the empty narrow is a catalog fact rather ' +
      'than a guess about which shirts the browse happened to surface. The ' +
      'wider search then correctly finds nothing and escalates — the honest ' +
      'answer, and proof the answer was ACTED on rather than ignored.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити сорочку', expect: ASKS_MEASUREMENTS },
      { message: 'Зріст 182, вага 78', expect: RECOMMENDS_L },
      {
        message: 'Мені потрібен розмір 42, а не L',
        expect: {
          decision: 'reply',
          scenario: 'narrowing_no_match',
          replyContains: 'ширше',
          replyNotContains: '💛',
          state: { awaitingField: 'narrow_broaden_choice' },
          note: 'Parks the narrowing entity and arms the one-shot guard',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'handoff',
          // The bug shape to guard: asking the same question again, or
          // silently doing nothing at all.
          replyNotContains: 'ширше',
          note: 'Wider search ran, found no shirt in 42, escalated honestly',
        },
      },
    ],
  },

  // ─── 8. The rewritten recommendation copy ───────────────────────
  demo_altamen_recommendation_is_a_question: {
    name: 'demo-altamen — «З цих раджу …» asks rather than decides',
    description:
      'The engine PRE-SELECTS the recommended product (`updateMemoryFromAction` ' +
      'case `recommend`), so recommendation copy phrased as a statement turned ' +
      'the customer\'s next «так» into a confirmation of a product they never ' +
      'chose. The copy is a question now, and `{reason}` — which nothing ever ' +
      'wrote, so it always rendered the same hardcoded «чудова якість та гарні ' +
      'відгуки» — is gone.\n' +
      'After the size-correction fix no other demo-altamen scenario reaches ' +
      'this scenario, so without this turn the new copy ships uncovered. ' +
      'Deliberately does NOT collect measurements first: `recommendedSize` ' +
      'must be unset or the classifier\'s SIZE ALREADY ESTABLISHED block is ' +
      'armed and this stops being a recommendation turn.',
    tenantId: DEMO_ALTAMEN_SLUG,
    flaky: true,
    turns: [
      { message: 'Хочу замовити сорочку', expect: ASKS_MEASUREMENTS },
      { message: 'Покажіть сорочки', expect: { decision: 'reply' } },
      {
        message: 'А що з цих порадите?',
        expect: {
          decision: 'reply',
          scenario: 'ask_recommendation_from_shown',
          replyContains: 'Оформлюємо',
          replyNotContains: ['чудова якість', 'відгуки', '💛'],
          note: 'Question form, no filler reason, no 💛 in a men\'s store',
        },
      },
    ],
  },

  // ─── 6. Customer answers the size question with a size ──────────
  demo_altamen_states_size_instead_of_measurements: {
    name: 'demo-altamen — Customer answers height/weight with their size',
    description:
      'We ask for height and weight; the customer replies «У мене розмір L». ' +
      'That IS the answer — it is what the chart was going to infer, stated ' +
      'first-hand — so it must be accepted as `recommendedSize` and the ' +
      'question must not be re-asked. Before the fix the gate\'s ' +
      '`!entities.size` term blocked the answer from reaching the collector: ' +
      'pre-qualify stayed pending, the size was dropped, and the turn fell ' +
      'through to AI fallback («Дякую 💛 Підкажіть, який товар вас цікавить?») ' +
      '— which also leaked a 💛 into a men\'s store. No recommendation prefix ' +
      'either: echoing «ваш розмір — L» at someone who just said L is absurd.',
    tenantId: DEMO_ALTAMEN_SLUG,
    turns: [
      { message: 'Хочу замовити шорти', expect: ASKS_MEASUREMENTS },
      {
        message: 'У мене розмір L',
        expect: {
          decision: 'reply',
          // The size they just stated becomes `recommendedSize`, so the list
          // renders with the sized header.
          scenario: 'show_products_with_size',
          replyContains: 'розміру L',
          replyNotContains: ['💛', 'зріст'],
          state: { preQualifyCollected: true, recommendedSize: 'L' },
          note: 'Size accepted as the answer; question not re-asked',
        },
      },
      {
        message: 'Шорти льон з манжетом хакі',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedVariantName: 'Хакі, L',
          },
          note: 'Colour named + size already known → resolve, do not ask again',
        },
      },
      {
        message: 'так',
        expect: {
          decision: 'reply',
          scenario: 'ask_continue_or_checkout',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
        },
      },
      {
        message: 'оформлюємо',
        expect: { decision: 'reply', scenario: 'collect_checkout_info' },
      },
      {
        message: DELIVERY,
        expect: { decision: 'create_draft_order', state: { orderCreated: true } },
      },
    ],
  },
};
