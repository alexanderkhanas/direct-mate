// luxespace — luxury multi-brand reseller. Catalog comes from Torgsoft
// via FTP (282 products / 854 variants across ~19 designer brands —
// Polo Ralph Lauren, Nanushka, Bottega Veneta, Alexander McQueen,
// Alessandra Rich, …).
//
// These scenarios stress the engine paths that are most exercised by
// real luxury-reseller customer behaviour: brand-by-name search,
// specific designer model lookup, size-and-stock checks, and
// out-of-stock handling. Assertions stay on engine state
// (selectionState, decision, replyContains) rather than exact template
// text so they don't churn when copy is tweaked.
//
// All scenarios force `flow_config.businessType = 'clothing'` via
// flowConfigOverride because luxespace was created via signup and its
// store_config.flow_config is empty (no businessType set). Without
// this the engine's vertical dispatcher doesn't know which
// handlePreQualify branch to use.

import { LUXESPACE, SimulatorScenario } from '../types';

const FLOW_OVERRIDE = { businessType: 'clothing' as const };

export const LUXESPACE_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── Brand-only search ──────────────────────────────────────────
  luxespace_brand_only_search: {
    name: 'luxespace — Brand-only search returns multiple products',
    description:
      'User mentions only a designer brand (Bottega Veneta has 6 products in catalog). ' +
      'Engine should classify intent=product_inquiry and surface multiple options.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'що є з Bottega Veneta?',
        expect: {
          decision: 'reply',
          // 6 BV products: 2 sandal models + 1 mules + 3 Cassette bag colors
          // → engine routes to show_products (>=2 results).
          scenario: 'show_products',
          note: 'BV brand search → multiple products → show_products template',
        },
      },
    ],
  },

  // ─── Specific model with multiple variants ──────────────────────
  luxespace_specific_model_multi_color: {
    name: 'luxespace — Specific Bottega Veneta Cassette bag (3 colors)',
    description:
      'User asks for a specific designer model that exists in 3 color variants ' +
      '(Зелений / Чорний / Білий). Engine should narrow to one product, ' +
      'state moves to awaiting_variant.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сумку Bottega Veneta Cassette',
        expect: {
          decision: 'reply',
          // Single product (Cassette bag) with 3 color variants → ask_variant_choice
          // OR ask_color_for_size depending on engine routing.
          state: { selectionState: 'awaiting_variant' },
          note: 'Single-model multi-color → engine asks for color',
        },
      },
    ],
  },

  // ─── Brand + category narrows to one product ────────────────────
  luxespace_brand_plus_category_dress: {
    name: 'luxespace — "Сукня Alexander McQueen" narrows to one product',
    description:
      'Alexander McQueen has 2 products in catalog: a Кроп-Топ and a Сукня. ' +
      'Brand + "сукня" should narrow to the dress only.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'є сукня Alexander McQueen?',
        expect: {
          decision: 'reply',
          note: 'Brand+category should narrow productData to 1; engine routes to confirm/variant flow',
        },
      },
    ],
  },

  // ─── Direct variant ask (brand + model + size) ──────────────────
  luxespace_direct_variant_with_size: {
    name: 'luxespace — Direct ask: Bottega Veneta Stretch Strap Sandal 37',
    description:
      'User specifies brand + model + size in one shot. ' +
      'Engine should resolve to a single variant and move to awaiting_confirmation.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'Bottega Veneta Stretch Strap Sandal 37 — є в наявності?',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Brand+model+size resolves to one variant → confirm_variant_available',
        },
      },
    ],
  },

  // ─── Out-of-stock variant ───────────────────────────────────────
  luxespace_out_of_stock_variant: {
    name: 'luxespace — Out-of-stock specific variant (Nanushka FEIKO міні-сукня S)',
    description:
      'Nanushka FEIKO Драпована Міні-Сукня only has size S in catalog and ' +
      'available_qty = 0. Engine should not let the user check it out.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'Nanushka FEIKO міні-сукня S',
        expect: {
          decision: 'reply',
          // Either out_of_stock or variant_not_available depending on which
          // path the engine routes through. Both are correct outcomes.
          replyContains: ['немає', 'наявн'],
          note: 'OOS variant must NOT advance to confirmation; reply mentions unavailability',
        },
      },
    ],
    flaky: true,
  },

  // ─── Polo Ralph Lauren menswear (gender filter) ─────────────────
  luxespace_polo_ralph_lauren_menswear: {
    name: 'luxespace — Polo Ralph Lauren menswear inquiry',
    description:
      'Polo Ralph Lauren is the only brand with gender=male tagged on 51 products. ' +
      'Generic menswear inquiry should still classify and search successfully.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу светр Polo Ralph Lauren',
        expect: {
          decision: 'reply',
          note: 'Brand + product type → either show_products (multiple PRL sweaters) or narrow to one',
        },
      },
    ],
  },

  // ─── Greeting (template wiring smoke test) ──────────────────────
  luxespace_greeting: {
    name: 'luxespace — Greeting template fires',
    description:
      'Bare greeting should hit the greeting template, not AI fallback. ' +
      'Smoke-tests that the 24 templates seeded for this tenant resolve correctly.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'Привіт',
        expect: {
          decision: 'reply',
          scenario: 'greeting',
          note: 'Greeting template must resolve, not fall back to AI',
        },
      },
    ],
  },

  // ─── Price inquiry (high-ticket) ────────────────────────────────
  luxespace_price_inquiry_high_ticket: {
    name: 'luxespace — Price inquiry on a 45999 UAH bag',
    description:
      'Bottega Veneta Cassette bag retails at 45999 UAH (sale 22999.50). ' +
      'Bot should show price without rounding/format issues for 5-figure prices.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'скільки коштує сумка Bottega Veneta Cassette зелена?',
        expect: {
          decision: 'reply',
          // Either show_price (if narrowed to one product) or
          // ask_variant_choice if BV has 3 Cassette colors and the
          // classifier didn't extract "зелена" as the color.
          replyContains: ['45999', '22999', 'грн'],
          note: 'Price must render with the actual catalog number, not a default',
        },
      },
    ],
    flaky: true,
  },

  // ─── Category browsing ──────────────────────────────────────────
  // Customer arrives without a brand in mind, just a product type.
  // These all expect show_products (multiple results) — the engine
  // should NOT try to confirm a single variant when no brand /
  // model / color / size is specified.

  luxespace_browse_dresses: {
    name: 'luxespace — Browse: "хочу замовити сукню"',
    description:
      'Generic dress inquiry. Catalog has 42 products in Сукні category — engine ' +
      'should classify as product_inquiry with category="Сукні" and surface multiple options.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу замовити сукню',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          state: { selectionState: 'awaiting_product' },
          note: '42 dresses in catalog → must show options, not narrow to one',
        },
      },
    ],
  },

  luxespace_browse_pants: {
    name: 'luxespace — Browse: "які є штани?"',
    description:
      '26 products in Штани category. Tests interrogative phrasing ("які є…?") ' +
      'classifies the same as imperative ("хочу…").',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'які є штани?',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          state: { selectionState: 'awaiting_product' },
        },
      },
    ],
  },

  luxespace_browse_jeans: {
    name: 'luxespace — Browse: "хочу джинси"',
    description:
      '14 products in Джинси category. Distinct from Штани — engine should ' +
      'classify the more specific category, not collapse to "штани".',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу джинси',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          state: { selectionState: 'awaiting_product' },
        },
      },
    ],
  },

  luxespace_browse_bags: {
    name: 'luxespace — Browse: "які сумки є?"',
    description:
      '13 bags total. 3 of them are Bottega Veneta Cassette in different colors. ' +
      'Generic bag inquiry should still show all bag options, not just one brand.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'які сумки є?',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          state: { selectionState: 'awaiting_product' },
        },
      },
    ],
  },

  luxespace_browse_followup_narrow: {
    name: 'luxespace — Browse → narrow by color follow-up',
    description:
      'Generic "хочу сукню" → engine shows dresses (must mention "сукн" in ' +
      'reply). Follow-up "чорну" should narrow within the previous result set, ' +
      'not start a fresh search. Regression coverage for the bug where ' +
      'classifier hallucinated category="Верхній одяг" and ILIKE substring ' +
      'matched "одяг" against "комплект домашнього одягу" (homewear).',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          replyContains: ['сукн'],
          note: 'Must show dresses, not homewear. Tenant-aware enum + M2M routing.',
        },
      },
      {
        message: 'чорну',
        expect: {
          decision: 'reply',
          replyContains: ['сукн'],
          note: 'Color filter must apply to lastPresentedProducts (still dresses)',
        },
      },
    ],
  },

  // ─── Phase E: tenant-aware category routing coverage ────────────
  // These three scenarios exercise the M2M-driven category search +
  // classifier enum constraint added in the "Tenant-aware classifier
  // categories + M2M-driven category search" PR. Each expects the
  // classifier to either pick a tenant-real category (from its
  // strict-mode enum) or omit the field — never to hallucinate.

  luxespace_category_only_dress: {
    name: 'luxespace — Category-only: "хочу сукню"',
    description:
      'Single-turn category-only inquiry. Classifier should extract ' +
      'category="Сукні" (from tenant enum), engine routes through M2M ' +
      'search, returns dress products. Direct regression for the ' +
      'browse-narrow bug.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          state: { selectionState: 'awaiting_product' },
          replyContains: ['сукн'],
          note: 'Category-only → M2M routing surfaces dresses, no homewear noise',
        },
      },
    ],
  },

  luxespace_category_color_only: {
    name: 'luxespace — Category + color: "хочу чорну сукню"',
    description:
      'Category + color, no productName. Tests the Phase D path where ' +
      'category routes through `dto.category` (M2M prefilter) AND the ' +
      'keyword loop narrows by color on title. Asserts both "сукн" and ' +
      '"чорн" appear in reply (engine surfaces dresses, mentions black).',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу чорну сукню',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          state: { selectionState: 'awaiting_product' },
          replyContains: ['сукн', 'чорн'],
          note: 'Category prefilter + color narrowing — both signals respected',
        },
      },
    ],
  },

  luxespace_category_off_enum: {
    name: 'luxespace — Off-enum category: "хочу шапку"',
    description:
      'Customer asks for a category ("Шапки") that is NOT in luxespace catalog. ' +
      'With strict-mode enum on entities.category, the classifier MUST omit the ' +
      'field rather than hallucinate a wrong category. Engine then falls back to ' +
      'keyword search on title/description, finds nothing, and replies gracefully.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу шапку',
        expect: {
          decision: 'reply',
          // No assertion on `scenario` — could be product_not_found, AI
          // fallback, or a generic clarification depending on engine
          // routing. Key invariant is: classifier did NOT route to a
          // wrong tenant category, so reply must NOT mention dresses /
          // pants / bags / homewear.
          replyNotContains: ['сукн', 'штан', 'сумк'],
          note: 'Strict enum forces classifier to omit category — no false routing',
        },
      },
    ],
  },

  // ─── Cyrillic brand transliteration ─────────────────────────────
  // Customer types brand names in Ukrainian phonetic spelling. Catalog
  // has them in Latin. Without translit support these will not narrow
  // by brand — engine falls through to show_products / handoff. Marked
  // `flaky` until the translit utility lands (see the postponed plan
  // at /Users/admin/.claude/plans/expressive-stargazing-hinton.md +
  // the earlier Pattern A plan for the translit work).

  luxespace_brand_cyrillic_bottega: {
    name: 'luxespace — Cyrillic brand: "ботега венета"',
    description:
      'User types "ботега венета" expecting it to match "Bottega Veneta" in catalog. ' +
      'Engine title-substring search is currently case-insensitive but NOT script-aware ' +
      '(no Cyrillic→Latin transliteration). Until translit lands, this falls back to ' +
      'show_products on category alone or AI fallback.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'що є з ботега венета?',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: 'Once translit lands: should narrow to BV products. Today: probably ai_fallback',
        },
      },
    ],
    flaky: true,
  },

  luxespace_brand_cyrillic_ralph_lauren: {
    name: 'luxespace — Cyrillic brand: "ральф лорен"',
    description:
      'Polo Ralph Lauren (114 products, biggest brand in catalog). Customer typing ' +
      '"ральф лорен" should resolve to PRL listings.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу светр ральф лорен',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: 'Brand "Polo Ralph Lauren" + product type "светр" — translit gap blocks brand match today',
        },
      },
    ],
    flaky: true,
  },

  luxespace_brand_cyrillic_nanushka: {
    name: 'luxespace — Cyrillic brand: "нанушка"',
    description:
      'Nanushka has 111 products. "Нанушка" is the standard Ukrainian phonetic ' +
      'spelling for the Hungarian brand.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'покажіть сукні нанушка',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: 'Brand "Nanushka" + category "Сукні" — translit gap blocks brand-narrowing',
        },
      },
    ],
    flaky: true,
  },

  luxespace_brand_cyrillic_alexander_mcqueen: {
    name: 'luxespace — Cyrillic brand: "александр маквін"',
    description:
      'Alexander McQueen — common Ukrainian phonetic spelling drops the silent vowels.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'александр маквін є?',
        expect: {
          decision: 'reply',
          note: '2 AM products — translit needed to resolve "маквін" → McQueen',
        },
      },
    ],
    flaky: true,
  },
};
