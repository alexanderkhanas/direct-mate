// showcase-women-clothes — sales-demo clothing tenant (10 products /
// 52 variants), prod-only twin of demo-women-clothes with
// is_demo=false so orders persist for live customer showings.
//
// These scenarios exercise the engine paths most useful when
// walking a potential customer through the bot:
//   - greeting + brand voice
//   - product browse → variant pick → checkout (happy path)
//   - out-of-stock variant handling (variant_not_available)
//   - last-in-stock signalling (confirm_last_in_stock)
//   - direct ask resolving to a single variant in one turn
//   - search-keyword synonym coverage (e.g. "плаття" → "сукня")
//
// Catalog facts the scenarios rely on (see
// /tmp/showcase-women-clothes-catalog.sql for the canonical source):
//
// OOS (qty=0):
//   • Сукня міді базова  Чорний XL
//   • Сатинова сукня     Чорний XS
//   • Футболка           Білий M
//   • Футболка           Бежевий L
//   • Сорочка лляна      Блакитний M
//   • Спідниця плісе     Чорний L
//   • Бомбер             Хакі S
//
// Last-in-stock (qty=1):
//   • Літня сукня        M
//   • Футболка           Чорний L
//   • Джинси             28
//   • Тренч              Бежевий M
//
// Store config is set by clothing-builder:
//   businessType=clothing
//   preQualifyStrategy=after_search_offered
// So `show_products` replies append a "Допомогти з розміром?" offer
// suffix. Scenarios sidestep the suffix by either supplying a size
// upfront or replying with a direct variant pick in the next turn.

import { SHOWCASE_WOMEN_CLOTHES, SimulatorScenario, SimulatorTurn } from '../types';

// Standard checkout finish — appended only to scenarios that demo
// the full purchase flow. Each CHECKOUT_FINISH creates a real
// `orders` row on prod (is_demo=false), so use sparingly.
const CHECKOUT_FINISH: SimulatorTurn[] = [
  { message: 'так' },
  { message: 'оформлюємо' },
  {
    message: 'Олена Петренко, 0671234567, Київ, НП 12',
    expect: {
      decision: 'create_draft_order',
      state: { orderCreated: true },
      note: 'Delivery info → engine emits create_draft_order + sets memory.orderCreated.',
    },
  },
];

export const SHOWCASE_WOMEN_CLOTHES_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── Greeting ───────────────────────────────────────────────────
  showcase_women_greeting: {
    name: 'showcase — Greeting template fires',
    description:
      'A bare "Привіт" should hit the greeting template — the simplest ' +
      'sanity check that the showcase tenant is wired up and the engine ' +
      'reaches its template-engine path for this slug.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Привіт',
        expect: {
          decision: 'reply',
          scenario: 'greeting',
          note: 'greeting template should fire',
        },
      },
    ],
  },

  // ─── Happy path: dress browse → size pick → checkout ────────────
  showcase_women_dress_to_checkout: {
    name: 'showcase — Сукня browse → pick → checkout',
    description:
      'Customer asks for a dress (3 products in Сукні: міді базова, ' +
      'літня квіткова, сатинова комбінація). Engine surfaces options. ' +
      'Customer narrows to the basic midi in M and completes checkout ' +
      'end-to-end. Validates the full purchase flow on a non-demo tenant ' +
      'and confirms a real order row is persisted.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: '3 dresses surfaced',
        },
      },
      {
        message: 'базова міді в M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'product + size resolved → confirm step',
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  // ─── Color × size narrowing on multi-variant product ────────────
  showcase_women_tshirt_color_size_pick: {
    name: 'showcase — Футболка multi-color → narrow to one variant',
    description:
      'Oversize футболка has 3 colors × 3 sizes = 9 variants. Customer ' +
      'starts vague, narrows by color (Чорний), then size (S). Engine ' +
      'should resolve to a single in-stock variant (Чорний S, qty=10). ' +
      'No checkout — keeps order spam down.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'є футболки?',
        expect: {
          decision: 'reply',
          note: '1 product (oversize tshirt) surfaced with multiple colors',
        },
      },
      { message: 'чорна' },
      {
        message: 'S',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Color + size → single in-stock variant',
        },
      },
    ],
  },

  // ─── Out-of-stock variant (variant_not_available) ───────────────
  showcase_women_oos_dress_xl: {
    name: 'showcase — Сукня міді XL → variant unavailable',
    description:
      'Customer asks for the basic midi dress in XL. Only Чорний XL exists ' +
      'as a variant row and stock_balances.available_qty = 0. Engine must ' +
      'NOT advance to confirmation — reply should mention unavailability ' +
      'and offer the in-stock sizes (S/M/L).',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'базова міді сукня в XL',
        expect: {
          decision: 'reply',
          // The reply could be variant_not_available, out_of_stock, or
          // ask_size_choice depending on which template the engine picks.
          // All three carry the "немає" cue.
          replyContains: ['немає', 'наявн'],
          note: 'XL is OOS — must not advance to checkout',
        },
      },
    ],
    flaky: true,
  },

  // ─── Out-of-stock specific color×size combo ─────────────────────
  showcase_women_oos_tshirt_white_m: {
    name: 'showcase — Футболка Білий M → variant unavailable',
    description:
      'Customer directly asks for the white tee in M. That variant exists ' +
      'but qty=0. Other M sizes (Чорний M, Бежевий M) are in stock so the ' +
      'engine has alternatives to mention.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'футболка біла M',
        expect: {
          decision: 'reply',
          replyContains: ['немає', 'наявн'],
          note: 'Білий M qty=0 — engine offers alternatives or declines',
        },
      },
    ],
    flaky: true,
  },

  // ─── Last-in-stock signalling ───────────────────────────────────
  showcase_women_last_in_stock_jeans: {
    name: 'showcase — Джинси 28 → last-in-stock',
    description:
      'Customer asks for jeans in size 28 (qty=1). Engine should either ' +
      'fire confirm_last_in_stock template (preferred) or note "залишився" ' +
      'in some other form. Validates the low-stock signalling path.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'джинси розмір 28',
        expect: {
          decision: 'reply',
          // confirm_last_in_stock has a "Наразі залишився лише" copy;
          // out_of_stock has "немає". Either ack the scarcity is the
          // goal here, not the exact template.
          replyContains: ['залиш'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Single-unit variant → engine should signal scarcity',
        },
      },
    ],
    flaky: true,
  },

  // ─── Direct variant ask (one-shot resolution) ───────────────────
  showcase_women_direct_bomber_pick: {
    name: 'showcase — Direct: Бомбер Чорний M → confirm',
    description:
      'Single-message ask with brand-equivalent (product type) + color + ' +
      'size. The variant (Бомбер Чорний M, qty=10) is in stock. Engine ' +
      'should resolve to awaiting_confirmation in one turn.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'хочу бомбер чорний M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'product + color + size in one shot → variant resolved',
        },
      },
    ],
  },

  // ─── Synonym search via search_keywords ─────────────────────────
  showcase_women_plattya_synonym: {
    name: 'showcase — Synonym: "плаття" matches "сукня"',
    description:
      'Customer uses the Russian/colloquial synonym "плаття" instead of ' +
      '"сукня". The products.search_keywords column lists both forms so ' +
      'the ILIKE/trigram search should still surface the 3 dresses. ' +
      'Validates the search_keywords coverage we packed into the catalog.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'покажіть плаття',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: '"плаття" should hit search_keywords on all 3 dresses',
        },
      },
    ],
    flaky: true,
  },
};
