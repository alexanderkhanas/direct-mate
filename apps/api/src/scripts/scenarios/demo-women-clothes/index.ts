// Simulator scenarios for the demo-women-clothes tenant.
//
// Regression cover for prod trace 37fb5032: a customer with a product
// already in focus asked a bare size question ("Є розмір М?") and the
// engine handed off with `product_not_found` — because the classifier
// emitted only `entities.size`, `extractSearchKeywords` dropped it, the
// search ran with an empty query, and the 0-row branch escalated without
// checking `memory.selectedProductId`.

import { SimulatorScenario, DEMO_WOMEN_CLOTHES_SLUG } from '../types';

export const DEMO_WOMEN_CLOTHES_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── Price answer offers the in-stock variants ──────────────────
  demo_women_price_offers_variants: {
    name: 'demo-women — Price answer offers variants',
    description:
      'Customer browses to a product, then asks its price. The reply ' +
      'quotes the price AND lists what is in stock. A first-turn price ' +
      'question about an UNSEEN product is a different path — 5.5d ' +
      'rewrites it to a product presentation — so the product must be ' +
      'in focus first, which is also the real trace shape (story reply, ' +
      'then "Яка ціна?").',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'Покажіть Zara Кремова блуза з рюшами',
        expect: {
          decision: 'reply',
          note: 'Product enters focus',
        },
      },
      {
        message: 'Яка ціна?',
        expect: {
          decision: 'reply',
          scenario: 'show_price_with_variants',
          replyContains: ['1299', 'S', 'M', 'L'],
          state: { selectionState: 'awaiting_variant' },
          note: 'show_price upgraded: >1 variant in stock, none chosen',
        },
      },
    ],
  },

  // ─── Bare size question about the focused product ───────────────
  demo_women_focused_size_question_no_handoff: {
    name: 'demo-women — Size question on focused product does not hand off',
    description:
      'Prod trace 37fb5032. With a product in focus, "Є розмір М?" ' +
      'yields entities={size} and no product identifier. The focus gate ' +
      'must hydrate the focused product by id instead of firing an ' +
      'empty search that returns 0 rows and escalates.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'Скільки коштує Zara Кремова блуза з рюшами?',
        expect: {
          decision: 'reply',
          note: 'Product enters focus via search',
        },
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

  // ─── Out-of-stock size on the focused product ───────────────────
  demo_women_focused_size_out_of_stock: {
    name: 'demo-women — Out-of-stock size answers, does not hand off',
    description:
      'Zara Базова футболка oversize has Чорний XL at stock=0. Asking ' +
      'for XL must surface variant_not_available with the sizes that ' +
      'ARE in stock — not a product_not_found handoff. Guards the ' +
      'focus gate against pre-filtering the hydrated product by the ' +
      "user's requested variant (which would collapse it to 0 rows).",
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'Скільки коштує Zara Базова футболка oversize?',
        expect: { decision: 'reply' },
      },
      {
        message: 'Є розмір XL?',
        expect: {
          decision: 'reply',
          replyNotContains: ['уточню наявність'],
          note: 'XL is stock=0 → informative answer, never a handoff',
        },
      },
    ],
  },

  // ─── Size help: sizeHelpMode='measurements' → ask height/weight ─
  demo_women_size_help_asks_measurements: {
    name: 'demo-women — Size help asks for height/weight',
    description:
      'sizeHelpMode=measurements, with preQualify enabled so the numeric ' +
      'ranges are usable. A mid-flow "допоможіть з розміром" must ask for ' +
      'measurements rather than answer with a product blurb (prod trace ' +
      'f73b4cc1 rendered recommend_product). The tenant\'s seeded ' +
      'preQualify.enabled is false, hence the override.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flowConfigOverride: {
      sizeHelpMode: 'measurements',
      preQualify: { enabled: true, fields: ['height', 'weight'] },
    },
    turns: [
      {
        message: 'Хочу замовити сорочку',
        expect: { decision: 'reply', note: 'Product enters focus' },
      },
      {
        message: 'допоможіть з розміром',
        expect: {
          decision: 'reply',
          replyContains: ['зріст', 'вагу'],
          state: { awaitingField: 'pre_qualify_data' },
          note: 'Measurement branch, NOT recommend_product',
        },
      },
    ],
  },

  // ─── Size help: sizeHelpMode='chart' → send chart, ask which size ─
  demo_women_size_help_chart_mode: {
    name: 'demo-women — Size help in chart mode sends the chart and asks',
    description:
      'sizeHelpMode=chart. Even with preQualify enabled and numeric ' +
      'ranges present, the explicit setting wins: send the chart image, ' +
      'then ask which size, parking the flow in awaiting_variant so the ' +
      "next turn resolves the size. This is men-demo-store's config.",
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flowConfigOverride: {
      sizeHelpMode: 'chart',
      preQualify: { enabled: true, fields: ['height', 'weight'] },
    },
    turns: [
      {
        message: 'Хочу замовити сорочку',
        expect: { decision: 'reply', note: 'Product enters focus' },
      },
      {
        message: 'допоможіть з розміром',
        expect: {
          decision: 'reply',
          scenario: 'show_size_chart',
          imageCount: 1,
          replyContains: ['В наявності', 'Який вам підходить?'],
          state: { selectionState: 'awaiting_variant', variantStep: null },
          note: 'Chart + ask which size; explicit setting beats inference',
        },
      },
      {
        message: 'M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note:
            'Size reply resolves against the focused product. On this ' +
            'colour+size product 5.5c auto-picks a colour (→ "Білий, M") ' +
            'rather than asking which colour — pre-existing 5.5c ' +
            'behaviour, unchanged here; assert the state transition only.',
        },
      },
    ],
  },

  // ─── Category question still searches ───────────────────────────
  demo_women_category_question_still_searches: {
    name: 'demo-women — Category pivot still runs a fresh search',
    description:
      'Negative control for the focus gate. A turn naming a DIFFERENT ' +
      'category is a pivot, not a question about the focused product: ' +
      'the gate must not fire, the engine must search, and a 0-row ' +
      'search must still escalate. Guards against the handoff suppression ' +
      'being over-broad — an early cut keyed on `memory.selectedProductId` ' +
      'alone swallowed this escalation into AI fallback.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'Скільки коштує Zara Кремова блуза з рюшами?',
        expect: { decision: 'reply' },
      },
      {
        message: 'А спідниці чорні є?',
        expect: {
          decision: 'handoff',
          note: 'Pivot to another category → fresh search → still escalates',
        },
      },
    ],
  },

  // ─── Unknown size is reported, never fuzzy-matched to a real one ──
  demo_women_unknown_size_reported: {
    name: 'demo-women — Non-existent size → variant_not_available (no XL→L)',
    description:
      'Prod trace 764aab8e. "Mango Сукня міді" carries XS/S/M/L, no XL. ' +
      'Asking for XL must report it as unavailable and list the real ' +
      'sizes — NOT fuzzy-match XL onto L and latch the wrong SKU ' +
      '(Part A guard + Part B 5.5o size-existence routing).',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'Покажіть Mango Сукня міді',
        expect: { decision: 'reply', note: 'Product enters focus' },
      },
      {
        message: 'у вас є XL?',
        expect: {
          decision: 'reply',
          scenario: 'variant_not_available',
          replyNotContains: 'XL',
          note: 'XL not carried → variant_not_available listing real sizes, no L-latch',
        },
      },
    ],
  },

  // ─── Size correction beats the bundled question ──────────────────
  demo_women_size_correction_beats_question: {
    name: 'demo-women — Bad size + question → size correction wins',
    description:
      'The exact trace 764aab8e shape: "у меня XL, полномерные?" bundles a ' +
      'non-existent size with a fit question. Size correction takes ' +
      'precedence (Part B runs before the product-question gate) — the ' +
      'turn reports XL unavailable rather than answering the fit question.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      {
        message: 'Покажіть Mango Сукня міді',
        expect: { decision: 'reply', note: 'Product enters focus' },
      },
      {
        message: 'у меня XL размер, они полномерные?',
        expect: {
          decision: 'reply',
          scenario: 'variant_not_available',
          note: 'Bad size wins over the fit question',
        },
      },
    ],
  },

  // ─── Product question answered from description (COVERED_FULLY) ───
  // FLAKY: depends on the classifier emitting recommendedAction=
  // 'answer_question' and the judge returning COVERED_FULLY. Both are
  // LLM calls; assert the shape, not exact copy.
  demo_women_product_question_from_description: {
    name: 'demo-women — Fit question answered from the description',
    description:
      '"H&M Джинси мом-фіт" description is "Висока посадка, вільний крій." ' +
      'Asking about the fit/rise should be answered from that description ' +
      '(judge COVERED_FULLY → grounded answer), not a generic blurb and ' +
      'not a handoff.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flaky: true,
    turns: [
      {
        message: 'Покажіть H&M Джинси мом-фіт',
        expect: { decision: 'reply', note: 'Product enters focus' },
      },
      {
        message: 'яка в них посадка?',
        expect: {
          decision: 'reply',
          replyContains: 'посадка',
          note: 'Answered from description; COVERED_FULLY path',
        },
      },
    ],
  },

  // ─── Product question NOT covered → handoff, never invented ───────
  // FLAKY: same LLM dependence as above.
  demo_women_product_question_not_covered: {
    name: 'demo-women — Uncovered product question hands off, never invents',
    description:
      '"H&M Джинси мом-фіт" has no material on record and a description ' +
      'silent on fabric. Asking the fabric must hand off (judge ' +
      'NOT_COVERED) rather than fabricate a material.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flaky: true,
    turns: [
      {
        message: 'Покажіть H&M Джинси мом-фіт',
        expect: { decision: 'reply', note: 'Product enters focus' },
      },
      {
        message: 'з якої тканини вони пошиті?',
        expect: {
          decision: 'handoff',
          note: 'Fabric not in description/material → handoff, no invention',
        },
      },
    ],
  },

  // ─── Classifier hardening: "L підійде" family ────────────────────
  // Setup: "Mango Сукня міді" is size-only XS/S/M/L (no XL). Asking XL
  // reaches 5.5o → variant_not_available, leaving
  // lastAction='told_variant_not_available' — the state where the new
  // `alternativesOfferedRule` fires.

  // Statement pick after alternatives — the exact prod trace 50036bfb bug.
  demo_women_alt_size_statement_pick: {
    name: 'demo-women — "L підійде" after alternatives → selects L (not handoff)',
    description:
      'Prod trace 50036bfb. After "XL немає, є XS/S/M/L", the customer says ' +
      '"L підійде" (= I\'ll take L). Must resolve to a pick of L and confirm, ' +
      'NOT hand off. Gated (not flaky): this is the acceptance criterion for ' +
      'the alternativesOfferedRule classifier change.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'Покажіть Mango Сукня міді', expect: { decision: 'reply', note: 'Product enters focus' } },
      { message: 'у вас є XL?', expect: { decision: 'reply', scenario: 'variant_not_available', note: 'XL not carried → alternatives offered' } },
      {
        message: 'L підійде',
        expect: {
          decision: 'reply',
          replyNotContains: ['уточню наявність', 'секунду'],
          state: { selectedVariantName: 'L' },
          note: 'Picks L → confirm; NOT product_question handoff',
        },
      },
    ],
  },

  // Same setup, RU phrasing.
  demo_women_alt_size_statement_pick_ru: {
    name: 'demo-women — "L подойдёт" (RU) after alternatives → selects L',
    description: 'Russian-language robustness of the alternatives pick path.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flaky: true,
    turns: [
      { message: 'Покажіть Mango Сукня міді', expect: { decision: 'reply' } },
      { message: 'у вас є XL?', expect: { decision: 'reply' } },
      {
        message: 'L подойдёт',
        expect: { decision: 'reply', state: { selectedVariantName: 'L' }, note: 'RU pick resolves to L' },
      },
    ],
  },

  // "тоді L" — then L.
  demo_women_alt_size_todi_l: {
    name: 'demo-women — "тоді L" after alternatives → selects L',
    description: 'Alternative statement phrasing of a size pick.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    turns: [
      { message: 'Покажіть Mango Сукня міді', expect: { decision: 'reply' } },
      { message: 'у вас є XL?', expect: { decision: 'reply' } },
      {
        message: 'тоді L',
        expect: {
          decision: 'reply',
          replyNotContains: ['уточню наявність'],
          state: { selectedVariantName: 'L' },
          note: 'Pick resolves to L',
        },
      },
    ],
  },

  // Fit QUESTION (with "?") must NOT latch a variant.
  demo_women_alt_size_fit_question: {
    name: 'demo-women — "L підійде?" after alternatives → fit question, no latch',
    description:
      'The genuine ambiguity\'s other reading: "L підійде?" (will L fit me?). ' +
      'Must NOT be treated as a pick — no variant latched, not confirm_selection. ' +
      'FLAKY: depends on the classifier reading the interrogative marker.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flaky: true,
    turns: [
      { message: 'Покажіть Mango Сукня міді', expect: { decision: 'reply' } },
      { message: 'у вас є XL?', expect: { decision: 'reply' } },
      {
        message: 'L підійде?',
        expect: {
          decision: 'reply',
          replyNotContains: ['оформлюємо'],
          note: 'Fit question → not a confirm (confirm copy says "оформлюємо?")',
        },
      },
    ],
  },

  // A size NOT in the offered list → availability, not a pick.
  demo_women_alt_size_new_size_ask: {
    name: 'demo-women — "а 46 є?" after alternatives → availability, not a pick',
    description:
      'A size outside the offered list is a fresh availability question, not a ' +
      'selection. Must not confirm and must not silently handoff with product_not_found.',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flaky: true,
    turns: [
      { message: 'Покажіть Mango Сукня міді', expect: { decision: 'reply' } },
      { message: 'у вас є XL?', expect: { decision: 'reply' } },
      {
        message: 'а 46 є?',
        expect: { decision: 'reply', replyNotContains: ['оформлюємо'], note: '46 not carried → variant_not_available/availability' },
      },
    ],
  },

  // Size chart shown, then a fit question → sizeChartJustSent signal.
  demo_women_chart_then_fit_question: {
    name: 'demo-women — chart shown, then "L підійде?" → fit answer',
    description:
      'After the size chart is sent, "L підійде?" is a fit judgment against it. ' +
      'Exercises the sizeChartJustSent classifier signal. FLAKY (LLM).',
    tenantId: DEMO_WOMEN_CLOTHES_SLUG,
    flaky: true,
    turns: [
      { message: 'Покажіть Mango Сукня міді', expect: { decision: 'reply' } },
      { message: 'розмірна сітка', expect: { decision: 'reply', scenario: 'show_size_chart', note: 'chart sent → sizeChartJustSent set' } },
      {
        message: 'L підійде?',
        expect: { decision: 'reply', replyNotContains: ['оформлюємо'], note: 'Fit question after chart' },
      },
    ],
  },
};
