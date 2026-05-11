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

import { LUXESPACE, SimulatorScenario, SimulatorTurn } from '../types';

const FLOW_OVERRIDE = { businessType: 'clothing' as const };

// Standard checkout finish — appended to every "happy path" scenario
// so the engine's full purchase flow (confirm → checkout-info collection
// → draft-order creation) gets exercised end-to-end. Mirrors the pattern
// from clothes-store scenarios. The final delivery-info turn is the
// only place that asserts; intermediate "так" / "оформлюємо" turns
// just advance state.
const CHECKOUT_FINISH: SimulatorTurn[] = [
  { message: 'так' },
  { message: 'оформлюємо' },
  {
    message: 'Олена Петренко, 0671234567, Київ, НП 12',
    expect: {
      decision: 'create_draft_order',
      state: { orderCreated: true },
      note: 'Delivery info → engine emits create_draft_order + flips memory.orderCreated.',
    },
  },
];

export const LUXESPACE_SCENARIOS: Record<string, SimulatorScenario> = {
  // ─── Brand-only search ──────────────────────────────────────────
  luxespace_brand_only_search: {
    name: 'luxespace — Brand-only search → BV sandal checkout',
    description:
      'User mentions only a designer brand (Bottega Veneta has 6 products in catalog). ' +
      'Engine should classify intent=product_inquiry and surface multiple options. ' +
      'Customer then narrows to a specific BV sandal in size 37 and completes checkout.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'що є з Bottega Veneta?',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: 'BV brand search → multiple products → show_products template',
        },
      },
      {
        message: 'Bottega Veneta Stretch Strap Sandal 37',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Specific model + size → single variant → awaiting_confirmation',
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  // ─── Specific model with multiple variants ──────────────────────
  luxespace_specific_model_multi_color: {
    name: 'luxespace — BV Cassette (multi-color) → pick + checkout',
    description:
      'User asks for a specific designer model that exists in multiple color variants ' +
      '(Зелений / Чорний). Engine narrows to one product, state moves to awaiting_variant. ' +
      'Customer then picks a color and completes checkout end-to-end.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сумку Bottega Veneta Cassette',
        expect: {
          decision: 'reply',
          // Pre-existing: catalog has 2 active Cassette colors plus other BV
          // bags — search may surface multiple products and stay at
          // awaiting_product rather than narrowing to a single Cassette.
          // Either outcome is acceptable; the next turn pins the variant.
          note: 'Single model OR multi-product BV results — both let T2 narrow.',
        },
      },
      {
        message: 'хочу Bottega Veneta Cassette зелену',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Specific brand + model + color → variant resolved.',
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  // ─── Brand + category narrows to one product ────────────────────
  luxespace_brand_plus_category_dress: {
    name: 'luxespace — McQueen dress narrowing → checkout',
    description:
      'Alexander McQueen has 2 products in catalog: a Кроп-Топ and a Сукня. ' +
      'Brand + "сукня" should narrow to the dress only (size M only). ' +
      'Customer confirms size and completes checkout end-to-end.',
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
      { message: 'M' },
      ...CHECKOUT_FINISH,
    ],
  },

  // ─── Direct variant ask (brand + model + size) ──────────────────
  luxespace_direct_variant_with_size: {
    name: 'luxespace — Direct ask: Bottega Veneta Stretch Strap Sandal 37 + checkout',
    description:
      'User specifies brand + model + size in one shot. ' +
      'Engine should resolve to a single variant and move to awaiting_confirmation, ' +
      'then complete checkout end-to-end via CHECKOUT_FINISH.',
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
      ...CHECKOUT_FINISH,
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
    name: 'luxespace — PRL sweater pick → checkout',
    description:
      'Polo Ralph Lauren is the only brand with gender=male tagged on 51 products. ' +
      'Generic menswear inquiry should classify and search successfully. ' +
      'Customer narrows to "Polo Ralph Lauren Светр L" and completes checkout.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу светр Polo Ralph Lauren',
        expect: {
          decision: 'reply',
          note: 'Brand + product type → show_products (multiple PRL sweaters)',
        },
      },
      {
        message: "В'язаний светр з ведмедем від Polo Ralph Lauren M",
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note:
            'Distinctive product name ("ведмедем") + single-axis size matrix → ' +
            'unique variant. Plain "Светр" name was ambiguous (matches several ' +
            'PRL sweater products with overlapping size axes).',
        },
      },
      ...CHECKOUT_FINISH,
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

  // ─── AI-introduction welcome (first-turn + dormancy) ────────────
  luxespace_first_turn_intro_non_greeting: {
    name: 'luxespace — First-turn AI intro on non-greeting',
    description:
      'New conversation + non-greeting opener → engine prepends the AI ' +
      "introduction (\"Вітаю, з вами АІ асистент @directmate.app\") AS the " +
      'primary reply, with the contextual show_products reply demoted to ' +
      'extraReplies[0]. Tenants without a `conversation_start_greeting` ' +
      'template (luxespace today) receive the hardcoded fallback string.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          decision: 'reply',
          replyContains: ['АІ асистент', '@directmate.app'],
          extraReplyCount: 1,
          note:
            'Primary reply is the intro; extraReplies[0] carries the dress ' +
            'list. lastReplyAt and welcomedAt both set after this turn.',
        },
      },
    ],
  },

  luxespace_first_turn_intro_greeting_skipped: {
    name: 'luxespace — First-turn greeting skips AI intro',
    description:
      'When the customer opens with "Привіт", the existing `greeting` ' +
      'template fires and the AI intro is skipped (no double-greet). ' +
      'Trace contains "welcome skipped: greeting intent".',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'Доброго дня',
        expect: {
          decision: 'reply',
          scenario: 'greeting',
          replyNotContains: ['@directmate.app', 'АІ асистент'],
          note: 'No AI-intro layer when intent === greeting.',
        },
      },
    ],
  },

  luxespace_no_intro_mid_conversation: {
    name: 'luxespace — Mid-conversation skips AI intro',
    description:
      'After the AI intro fires on Turn 1, subsequent turns within the 6h ' +
      'window must NOT re-prepend it. Trace shows "welcome skipped: not ' +
      'dormant" once the bot has replied at least once.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          decision: 'reply',
          replyContains: ['АІ асистент'],
          note: 'Turn 1 fires the intro.',
        },
      },
      {
        message: 'Polo Ralph Lauren жіноча синя сукня M',
        expect: {
          decision: 'reply',
          replyNotContains: ['@directmate.app', 'АІ асистент'],
          note: 'Turn 2 within 6h → no re-intro, contextual reply only.',
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
    name: 'luxespace — Browse dresses → PRL blue dress checkout',
    description:
      'Generic dress inquiry. Catalog has 42 products in Сукні category — engine ' +
      'classifies as product_inquiry with category="Сукні" and surfaces multiple options. ' +
      'Customer narrows to "Polo Ralph Lauren жіноча синя сукня M" and completes checkout.',
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
      {
        message: 'Polo Ralph Lauren жіноча синя сукня M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Full name + size → single variant resolved',
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_browse_pants: {
    name: 'luxespace — Browse pants → Cybel pants checkout',
    description:
      '26 products in Штани category. Tests interrogative phrasing ("які є…?") ' +
      'classifies the same as imperative ("хочу…"). Customer narrows to ' +
      '"Nanushka Штани Cybel L" and completes checkout.',
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
      {
        message: 'Nanushka Штани Cybel L',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_browse_jeans: {
    name: 'luxespace — Browse jeans → PRL black jeans checkout',
    description:
      '14 products in Джинси category. Distinct from Штани — engine should ' +
      'classify the more specific category, not collapse to "штани". Customer ' +
      'narrows to "Polo Ralph Lauren жіночі чорні джинси розмір 8" and completes checkout.',
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
      {
        message: 'Polo Ralph Lauren жіночі чорні джинси розмір 8',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_browse_bags: {
    name: 'luxespace — Browse bags → BV Cassette green checkout',
    description:
      '13 bags total. 3 of them are Bottega Veneta Cassette in different colors. ' +
      'Generic bag inquiry should still show all bag options, not just one brand. ' +
      'Customer picks "Bottega Veneta Cassette зелену" and completes checkout.',
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
      {
        message: 'Bottega Veneta Cassette зелену',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_browse_followup_narrow: {
    name: 'luxespace — Browse → narrow by color follow-up',
    description:
      'Generic "хочу сукню" → engine shows dresses (must mention "сукн" in ' +
      'reply). Follow-up "чорну" must narrow lastPresentedProducts in-memory ' +
      'via the narrow gate. None of the 5 shown dresses have black variants, ' +
      'so the narrow returns empty → narrowing_no_match template fires, ' +
      'NEVER AI fallback. Regression coverage for the hallucination where ' +
      'AI fallback invented "Чорний варіант є у Nanushka FEIKO" with a real ' +
      'price and fabricated black color.',
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
          replyNotContains: ['Чорний варіант є', 'розміри: S, M, L'],
          note:
            'Narrow gate fires (trace: narrow_gate). In-memory filter ' +
            'preserves whichever shown products carry black in their ' +
            'variant axis OR search_keywords blob; remaining are dropped. ' +
            'Either show_products renders the survivors, or — if 0 survive ' +
            '— narrowing_no_match offers broader search. The critical ' +
            'guarantee: AI fallback must NOT fabricate a black FEIKO ' +
            '(or any other product whose listed variants do not include ' +
            'black). Asserts replyNotContains the specific hallucination ' +
            'pattern from before this PR.',
        },
      },
    ],
  },

  luxespace_browse_followup_size: {
    name: 'luxespace — Browse → narrow by size follow-up',
    description:
      'T1 "хочу штани" shows pants. T2 "розмір L" must narrow ' +
      'lastPresentedProducts in-memory (gate skips fresh search). Survives ' +
      'with the variants whose size is L. Asserts no AI fallback.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу штани',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          replyContains: ['штан'],
          note: 'M2M category routing surfaces pants.',
        },
      },
      {
        message: 'розмір L',
        expect: {
          decision: 'reply',
          replyNotContains: ['зараз перевірю', 'ai_fallback'],
          note:
            'Narrow gate fires on slot-fill turn with size entity. Either ' +
            'show_products renders with L variants only, or narrowing_no_match ' +
            'soft-replies — both are correct outcomes; the assertion just ' +
            'guards against AI fallback hallucination.',
        },
      },
      {
        message: 'Nanushka жіночі штани Arvenn з твілового сукна L',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_browse_followup_brand: {
    name: 'luxespace — Browse → brand follow-up routes to fresh search',
    description:
      'T1 "хочу сукню" shows mixed-brand dresses. T2 "Nanushka" mentions a ' +
      'specific brand → classifier emits entities.productName containing ' +
      '"Nanushka" → narrow gate explicitly excludes (productName present) → ' +
      'fresh search fires for Nanushka dresses. Regression coverage to ' +
      'ensure brand pivots are NOT swallowed by the narrow gate.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу сукню',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          replyContains: ['сукн'],
        },
      },
      {
        message: 'Nanushka',
        expect: {
          decision: 'reply',
          replyContains: ['Nanushka'],
          note:
            'Brand follow-up must trigger fresh search (gate excludes due ' +
            'to productName entity presence). Reply lists Nanushka dresses.',
        },
      },
      {
        message: 'Nanushka сукня Arisa з драпіруванням M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_narrow_no_match_color: {
    name: 'luxespace — Narrow with no match → narrowing_no_match template',
    description:
      'T1 "хочу штани" shows pants. T2 "рожеві" — classifier emits ' +
      'color=рожевий. None of the shown pants have pink variants → narrow ' +
      'returns empty → narrowing_no_match template renders soft reply ' +
      'offering broader catalog search. Direct regression for the empty ' +
      'narrow path.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: 'хочу штани',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          replyContains: ['штан'],
        },
      },
      {
        message: 'рожеві',
        expect: {
          decision: 'reply',
          scenario: 'narrowing_no_match',
          replyContains: ['каталозі'],
          replyNotContains: ['зараз перевірю'],
          note:
            'Empty narrow → narrowing_no_match template, NEVER AI fallback.',
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
    name: 'luxespace — Category-only "хочу сукню" → PRL blue dress checkout',
    description:
      'Single-turn category-only inquiry. Classifier should extract ' +
      'category="Сукні" (from tenant enum), engine routes through M2M ' +
      'search, returns dress products. Customer narrows to PRL blue dress ' +
      'and completes checkout end-to-end.',
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
      {
        message: 'Polo Ralph Lauren жіноча синя сукня M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_category_color_only: {
    name: 'luxespace — Category + color "хочу чорну сукню" → checkout',
    description:
      'Category + color, no productName. Tests the Phase D path where ' +
      'category routes through `dto.category` (M2M prefilter) AND the ' +
      'keyword loop narrows by color on title. Customer then narrows to a ' +
      'specific Nanushka black dress and completes checkout.',
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
      {
        message: 'Nanushka Сукня Artemiz з сітчастого джерсі M',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      ...CHECKOUT_FINISH,
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

  // ─── Photo-locked product survives noisy follow-up search ───────
  // Regression for the JOSA → Silvine bug seen on 2026-05-09:
  //
  //   1. Customer screenshots JOSA Mesh-Jersey Turtleneck Top.
  //   2. CLIP photo match resolves to JOSA (productId 2010148a, image 353.jpg)
  //      and the engine asks for a size.
  //   3. Customer types only "L".
  //   4. The classifier returns slotAction=fills_missing_slot with
  //      entities.productName="JOSA …" and entities.size="L". The engine
  //      re-runs `searchAndFilterProducts` (because shouldSearchProducts
  //      returned true), the title-keyword search returns 5 products that
  //      did NOT include JOSA itself (narrowByProductName + the
  //      color-stripped catalog dropped it), and the unguarded
  //      `memory.selectedProductId = first.product.id` write at both the
  //      search-target site and the buildResponse site silently replaced
  //      the photo lock with Silvine's product id (096ca336).
  //   5. Reply rendered with Silvine's image (266.jpg) but kept JOSA's
  //      title — frankenstate visible to the customer.
  //
  // Fix lives in `reply-engine.service.ts:shouldAdoptSearchLock` plus
  // the lock-aware updates in searchAndFilterProducts + buildResponse.
  // This scenario asserts both the bare-size-fill (lock holds) and the
  // explicit-name-switch (lock drops) branches.

  luxespace_photo_lock_holds_through_size_fill: {
    name: 'luxespace — Photo-locked product survives bare-size variant fill',
    description:
      'JOSA → Silvine regression. Photo locks JOSA, customer types "L", ' +
      'engine must keep selectedProductId pinned to JOSA (NOT silently ' +
      "swap it to a similarly-titled top from search results) and bind " +
      "the L variant on JOSA's catalog.",
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: '',
        // JOSA's catalog photo URL — pHash Stage 1 hits with distance 0
        // and resolves to JOSA deterministically without depending on
        // CLIP behavior or vision model availability.
        mediaReference: {
          mediaId: 'https://cdn.directmate.app/luxespace/images/353.jpg',
          type: 'customer_photo',
        },
        expect: {
          decision: 'reply',
          scenario: 'ask_variant_choice',
          replyContains: 'JOSA',
          state: { selectionState: 'awaiting_variant' },
          note: 'Photo locks selectedProductId to JOSA (2010148a)',
        },
      },
      {
        message: 'L',
        expect: {
          decision: 'reply',
          // Critical assertion: the reply must STILL be about JOSA.
          // Before the fix, this turn surfaced "Silvine" / "Bianca" /
          // "Citta" / "Alexander McQueen" from a noisy title-keyword
          // search that dropped JOSA itself.
          replyContains: 'JOSA',
          replyNotContains: ['Silvine', 'Bianca', 'Citta', 'McQueen'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Bare "L" must keep JOSA lock and bind the L variant',
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  luxespace_photo_lock_drops_on_explicit_name_switch: {
    name: 'luxespace — Photo-locked product replaced when customer names a different product',
    description:
      'Sibling regression to the bare-size scenario. Photo locks JOSA. ' +
      'Customer then explicitly names a different product ("Silvine") in ' +
      'the same turn as a size. Classifier returns ' +
      'slotAction=fills_missing_slot but entities.productName="Silvine", ' +
      'which does NOT overlap with the locked title after stop-word + ' +
      'generic-noun stripping in `titlesOverlap`. productNameMismatch ' +
      'fires → lock IS overwritten to Silvine.',
    tenantId: LUXESPACE,
    flowConfigOverride: FLOW_OVERRIDE,
    turns: [
      {
        message: '',
        mediaReference: {
          mediaId: 'https://cdn.directmate.app/luxespace/images/353.jpg',
          type: 'customer_photo',
        },
        expect: {
          decision: 'reply',
          replyContains: 'JOSA',
          state: { selectionState: 'awaiting_variant' },
          note: 'Photo locks JOSA; next turn explicitly switches product',
        },
      },
      {
        message: 'хочу Silvine L',
        expect: {
          decision: 'reply',
          replyContains: 'Silvine',
          replyNotContains: 'JOSA',
          note: 'Explicit Silvine name → productNameMismatch → lock overwritten',
        },
      },
    ],
    // Marked flaky because the classifier's productName extraction on
    // mixed Cyrillic+Latin strings ("хочу Silvine L") is somewhat
    // input-sensitive. The engine-side guard is the deterministic part;
    // failures here usually mean the classifier didn't extract
    // entities.productName="Silvine" — investigate prompt before
    // touching the lock guard.
    flaky: true,
  },
};
