// Simulator scenarios for the men-demo-store tenant.
//
// PROD-ONLY. This tenant is not seeded from this repo; it exists only on
// production. Running these against a local DB fails at tenant
// resolution. See MEN_DEMO_STORE in ../types.ts.
//
// Every scenario here is derived from a real production trace:
//   ad5e44ac — story reply → "Яка ціна?"      (price on a media-resolved product)
//   37fb5032 — then "Є розмір М?"             → product_not_found handoff (M was in stock)
//   f73b4cc1 — "допоможіть з розміром"        → recommend_product (sales blurb, not size help)
//
// Catalog facts these assertions depend on:
//   - all 4 products are SIZE-ONLY (no colour axis), every variant in stock
//   - Сорочка з льону  1599 грн, S/M/L      story media 17934760002319883
//   - Шорти джинсові світлі 1199 грн, S/M/L story media 17889274518596043
//   - Футболка базова чорна 699 грн, S/M/L/XL
//   - flow_config = {} → sizeHelpMode resolves to 'chart'
//   - size_charts: Верх (сорочки, футболки…), Низ (джинси, шорти) — no brands
//   - `show_size_chart` requires {brand} + {name}; with no brand on the
//     chart the template is non-viable, so the reply falls back to the
//     hardcoded 'Ось наша розмірна сітка 💛'. Assert on that, not the
//     template text.

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
};
