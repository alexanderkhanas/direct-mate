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
};
