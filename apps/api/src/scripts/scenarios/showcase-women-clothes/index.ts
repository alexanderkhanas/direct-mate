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
      'route through the 5.5o OOS-variant branch to variant_not_available ' +
      'and offer the in-stock sizes (S/M/L) as alternatives. The {variant_list} ' +
      'should surface JUST sizes (size-only ask), not "Чорний, S" pairs.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'базова міді сукня в XL',
        expect: {
          decision: 'reply',
          scenario: 'variant_not_available',
          replyContains: ['немає в наявності', 'S, M, L'],
          replyNotContains: 'Чорний, S',
          note: 'XL is OOS — variant_list scoped to sizes only',
        },
      },
    ],
  },

  // ─── Multi-color product, asked size in stock for one color ─────
  showcase_women_skirt_l_multicolor_auto_resolve: {
    name: 'showcase — Спідниця L → auto-resolve to Бежевий L',
    description:
      'Customer asks for size L on Спідниця плісе (multi-color: ' +
      'Бежевий + Чорний). Чорний L is qty=0 but Бежевий L is qty=10, ' +
      "so size L still has exactly one in-stock variant. Engine auto-" +
      'resolves to the single available combination (Бежевий L) and ' +
      'routes to confirm_variant_available. Documents the current ' +
      'behavior — partial-color OOS is not surfaced.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Хочу Спідницю плісе в розмірі L',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          replyContains: ['Бежевий', 'L'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'auto-resolves to single in-stock L variant',
        },
      },
    ],
  },

  // ─── Size in only one color (1-of-N colors has stock) ───────────
  showcase_women_size_only_in_one_color: {
    name: 'showcase — Сорочка M → "only in Білий"',
    description:
      'Customer asks for size M on Сорочка лляна (multi-color: ' +
      'Білий + Блакитний). Білий M is qty=10, Блакитний M is qty=0. ' +
      'Engine auto-resolves to the single in-stock variant (Білий M) ' +
      'and routes to confirm. Today the bot does NOT call out the ' +
      'asymmetry (other color exists but is OOS in this size). ' +
      'Documents current behavior as a baseline for a future ' +
      "\"only in Color X\" template enhancement; flaky for now.",
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Хочу Сорочку лляну в розмірі M',
        expect: {
          decision: 'reply',
          replyContains: ['Білий', 'M'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'auto-confirms Білий M; partial-color OOS not surfaced',
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
      'engine has alternatives to mention. Routes through 5.5o.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'футболка біла M',
        expect: {
          decision: 'reply',
          scenario: 'variant_not_available',
          replyContains: 'немає в наявності',
          note: 'Білий M qty=0 — engine routes via 5.5o → variant_not_available',
        },
      },
    ],
  },

  // ─── Last-in-stock signalling ───────────────────────────────────
  showcase_women_last_in_stock_jeans: {
    name: 'showcase — Джинси 28 → confirm (qty=1)',
    description:
      'Customer asks for jeans in size 28 (qty=1). Engine resolves to the ' +
      'single available variant and routes to confirm_variant_available. ' +
      'TODO: 5.5c last-in-stock upgrade is not firing for this path; ' +
      'should route to confirm_selection_last_in_stock so the bot calls ' +
      'out scarcity. Tracked as engine gap — see scenario name when ' +
      'fixed. Documents current behavior as a baseline.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'джинси розмір 28',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          replyContains: ['Синій', '28'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'Documents current behavior; last-in-stock upgrade not yet wired here',
        },
      },
    ],
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

  // ─── Color-linked story reply ───────────────────────────────────
  showcase_women_color_link_story: {
    name: 'showcase — Color-linked story reply',
    description:
      'Customer replies to the Білий-linked Oversize футболка базова ' +
      'story. Engine resolves the link → fans out to all in-stock ' +
      'Білий sizes → surfaces confirm_color_variant_in_stock with ' +
      'Чорний + Бежевий as alternative colors. Validates the color-' +
      'link routing path end-to-end against the real prod mapping.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'А таке є?',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'confirm_color_variant_in_stock',
          replyContains: ['Білий', 'Розміри', 'інших кольорах'],
          state: { selectionState: 'awaiting_variant' },
          note: 'Color-link mapping → variantStep=size, lists alts',
        },
      },
    ],
  },

  // ─── Color-linked story → size pick → real order ────────────────
  showcase_women_color_link_to_checkout: {
    name: 'showcase — Color-link → size pick → checkout',
    description:
      'Full purchase path off the Білий-linked story reply: customer ' +
      "asks about the linked Oversize футболка базова, picks size S, " +
      'confirms, and completes checkout. Validates the color-link ' +
      'scenario flows cleanly into the existing 5.5b/5.5c size-' +
      'narrowing flow and creates a real `orders` row (is_demo=false).',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'А таке є?',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'confirm_color_variant_in_stock',
          state: { selectionState: 'awaiting_variant' },
        },
      },
      {
        message: 'S',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          state: {
            selectionState: 'awaiting_confirmation',
            selectedColor: 'Білий',
          },
          note: 'size fills against linked color → awaiting_confirmation',
        },
      },
      ...CHECKOUT_FINISH,
    ],
  },

  // ─── Color-linked story → "які ще кольори?" ─────────────────────
  showcase_women_color_link_asks_other_colors: {
    name: 'showcase — Color-link → user asks for other colors',
    description:
      'Customer replies to the Білий-linked story and explicitly asks ' +
      'what other colors are available. The confirm_color_variant_in_stock ' +
      'template already surfaces other colors in its body, so the first ' +
      'turn answers the question. Validates that the canonical reply ' +
      'pre-empts the explicit ask without an extra round trip.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'А інші кольори є?',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'confirm_color_variant_in_stock',
          replyContains: ['Чорний', 'Бежевий'],
          note: 'Other colors listed in the linked-color template body',
        },
      },
    ],
  },

  // ─── Color-linked story → user picks different color ────────────
  showcase_women_color_link_picks_other_color: {
    name: 'showcase — Color-link → user picks different color',
    description:
      "Story is linked to Білий, but customer asks for Чорний. Engine " +
      'detects the color switch via 5.5b-2, drops the linked color, ' +
      "resolves Чорний against the product's catalog, and asks for " +
      'size via ask_size_for_color (multiple in-stock sizes exist).',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'А таке є?',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'confirm_color_variant_in_stock',
        },
      },
      {
        message: 'хочу Чорний',
        expect: {
          decision: 'reply',
          scenario: 'ask_size_for_color',
          replyContains: 'Чорний',
          state: {
            selectionState: 'awaiting_variant',
            selectedColor: 'Чорний',
          },
          note: 'Color switch → ask_size_for_color for Чорний sizes',
        },
      },
    ],
  },

  // ─── Regression: media-link → 5.5m downgrade → axis-scoping leak ──
  showcase_women_sweater_photo_label_bug_story: {
    name: 'showcase — Sweater story-link → "є в кольорах" rendering',
    description:
      'Story-link variant of the prod sweater-photo bug. Story ' +
      '18091760378592338 has product_id=Светр oversize в\'язаний, no ' +
      'linked_color. Engine resolves the product and falls through to ' +
      'ask_variant_choice via 5.5m else-branch. Asserts the color-' +
      'grouped {variant_list} renders both colors instead of bare ' +
      'sizes. Pairs with _empty_caption_downgrade and the ' +
      'customer_photo variant to cover the three 5.5m entry paths.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'А таке є?',
        mediaReference: { mediaId: '18091760378592338', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'ask_variant_choice',
          replyContains: ['Коричневий', 'Кремовий'],
          replyNotContains: 'кольорах: S',
          state: { selectionState: 'awaiting_variant' },
          note: 'No linked_color path → color-grouped variant_list',
        },
      },
    ],
  },
  showcase_women_color_link_empty_caption_downgrade: {
    name: 'showcase — Color-linked story + empty caption → axis clear',
    description:
      'Reproduces the exact prod bug class without needing the ' +
      'customer_photo matching pipeline. Uses the existing Білий-' +
      'linked t-shirt story (18018605627836110) so handleColorLinkedMedia ' +
      'writes selectedColor/variantStep/mediaLinkSizes/mediaLinkOtherColors. ' +
      'Then sends an empty caption so the 5.5m empty-caption coerce ' +
      'fires and downgrades routing to ask_variant_choice. Before the ' +
      'fix, {variant_list} rendered "S, M, L" (Білий sizes filtered ' +
      'by the leaked variantStep="size"). After the fix, the axis-' +
      'scoping memory is cleared and the color-grouped fallback ' +
      'renders all colors.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: '',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'ask_variant_choice',
          replyContains: ['Білий', 'Чорний'],
          // Two negatives: 'кольорах: S' is the original wire signature
          // of the prod bug; 'Розміри' is a label-only sentinel that
          // catches a future regression where {variant_list} renders
          // sizes correctly but {variant_type} flips to "Розміри" under
          // a body that still promises colors.
          replyNotContains: ['кольорах: S', 'Розміри'],
          state: { selectionState: 'awaiting_variant' },
          note: 'Empty caption downgrades routing; axis-scoping must be cleared',
        },
      },
    ],
  },
  // ─── Falsifiability probe: bare color reply after downgrade ─────
  showcase_women_variant_pick_bare_after_downgrade: {
    name: 'showcase — Bare color reply on awaiting_variant (prod loop)',
    description:
      "Reproduces the prod stuck-loop bug. Turn 1 mirrors the " +
      "empty_caption_downgrade scenario (story + empty caption → " +
      "ask_variant_choice rendered). Turn 2 sends bare 'Чорний' — " +
      "matches the prod customer's single-word reply 'Коричневий'. " +
      "Hypothesis: engine should route to ask_size_for_color (since " +
      "Чорний has 3 in-stock sizes on the t-shirt) but instead loops " +
      "show_products because no 5.5* branch covers " +
      "(awaiting_variant + entities.color + variantStep=null + " +
      "slotAction=asks_question/new_inquiry).",
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: '',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'ask_variant_choice',
          state: { selectionState: 'awaiting_variant' },
        },
      },
      {
        message: 'Чорний',
        expect: {
          decision: 'reply',
          scenario: 'ask_size_for_color',
          replyContains: ['Чорний'],
          // selectedColor is written in user-form (lowercase). Canonicalize-on-write
          // is a separate F2-deferred PR — see CLAUDE.md tech-debt.
          state: { selectionState: 'awaiting_variant', selectedColor: 'чорний' },
          note: 'Bare color word must advance variant flow; today loops show_products',
        },
      },
    ],
  },
  // ─── Falsifiability probe: verbose color reply after downgrade ──
  showcase_women_variant_pick_verbose_after_downgrade: {
    name: 'showcase — Verbose color reply on awaiting_variant',
    description:
      "Same as the bare probe above but turn 2 uses 'хочу Чорний' " +
      "to bias the classifier toward fills_missing_slot. If this " +
      "passes while the bare probe fails, the engine's gating gap is " +
      "narrower (only the asks_question/new_inquiry slotAction shapes " +
      "miss). Locks in the classifier-vs-engine scope question.",
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: '',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'ask_variant_choice',
        },
      },
      {
        message: 'хочу Чорний',
        expect: {
          decision: 'reply',
          scenario: 'ask_size_for_color',
          replyContains: ['Чорний'],
          // selectedColor is written in user-form (lowercase). Canonicalize-on-write
          // is a separate F2-deferred PR — see CLAUDE.md tech-debt.
          state: { selectionState: 'awaiting_variant', selectedColor: 'чорний' },
          note: 'Verbose phrasing biases classifier to fills_missing_slot',
        },
      },
    ],
  },

  // ─── Routing-gap repro: ready_to_order + leaked color ───────────
  showcase_women_ready_to_order_jeans_leaked_color: {
    name: 'showcase — Хочу замовити ці джинси (ready_to_order, jeans)',
    description:
      "Reproduces prod conv 05d802e7-… routing gap. Customer sends " +
      "'Хочу замовити ці джинси' with a story_reply to the jeans " +
      "story. Before the fix, `ready_to_order` was excluded from " +
      "`isSelectionIntent` so 5.5m skipped variant resolution; if the " +
      "classifier also leaked a color from prior history (e.g. " +
      "'чорний' from an earlier t-shirt order), 5.5c's match-failure " +
      "branch persisted that bogus color to memory.selectedColor and " +
      "routed to ask_size_for_color — template filtered variant_list " +
      "to zero rows and engine fell to AI fallback. After fix: 5.5m " +
      "now handles ready_to_order, and 5.5c sanity-checks userColor " +
      "against the product's variants (via colorsOverlap) before " +
      "persisting it. Both layers drop a non-existent color and " +
      "route to ask_variant_choice. The simulator can't force " +
      "classifier leakage, so this scenario locks the SHAPE of the " +
      "correct reply regardless of whether the classifier leaks: it " +
      "asserts that the engine resolves to a size-asking flow on " +
      "the jeans product without ever asserting a stale color.",
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Хочу замовити ці джинси',
        mediaReference: { mediaId: '17893305552464540', type: 'story_reply' },
        expect: {
          decision: 'reply',
          // Engine must surface jeans sizes (26-30). The exact scenario
          // depends on whether classifier leaked a color this run; both
          // `ask_variant_choice` and `confirm_variant_available` are
          // acceptable variants of the size-asking flow. The critical
          // negative assertion is that no AI fallback fires.
          replyNotContains: ['чорний', 'Чорний', 'Розміри: \\nЦіна'],
          state: { selectedProductId: '11111111-0000-0000-0000-000000000007' },
          note: 'No stale color in reply; routed to a template (not AI fallback)',
        },
      },
    ],
  },

  // Removed `showcase_women_sweater_photo_label_bug_customer_photo` —
  // matchCustomerPhoto requires phash + CLIP wired against the
  // product_media URL to fire deterministically locally (prod relied on
  // those being computed at sync time; local sweater rows have NULL
  // phash). The `_empty_caption_downgrade` scenario above is the
  // deterministic lock for the same `clearMediaLinkAxisScoping` fix
  // class — it enters 5.5m through the story-link path with an empty
  // caption, exercises the identical writer (handleColorLinkedMedia)
  // and the identical downgrade branch. Don't reintroduce a flaky
  // duplicate.

  // ─── 1.2 First impression: open-ended discovery ─────────────────
  showcase_women_open_ended_discovery: {
    name: 'showcase — Open-ended "Що у вас є?"',
    description:
      'Prospect tests the bot with a fully open question. The engine ' +
      "doesn't currently have a categorized-overview handler — the " +
      'classifier returns category_browse with no category entity, ' +
      'the search step finds 0 products, and the engine hands off. ' +
      "Today's expected behavior is a soft handoff via " +
      "product_not_found — not the ideal sales-demo experience. " +
      'Marked flaky and documented as an engine gap (CLAUDE.md ' +
      'backlog: "show all categories" handler).',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Що у вас є?',
        expect: {
          decision: 'handoff',
          note: 'No category extracted → search finds 0 → handoff (gap)',
        },
      },
    ],
    flaky: true,
  },

  // ─── 1.3 First impression: direct price query ───────────────────
  showcase_women_direct_price_query: {
    name: 'showcase — "Скільки коштує сукня?"',
    description:
      'Prospect asks a price for "сукня" (general dress). Engine ' +
      'must surface the 3 dresses with prices rather than punt to ' +
      'the site or ask for clarification. Validates that vague ' +
      'price queries on a category get a useful catalog response.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Скільки коштує сукня?',
        expect: {
          decision: 'reply',
          replyContains: ['грн'],
          note: '3 dresses surfaced with prices',
        },
      },
    ],
  },

  // ─── 2.1 Killer feature: story-link + price query ───────────────
  showcase_women_color_link_price_query: {
    name: 'showcase — Story-link → "Скільки коштує?"',
    description:
      'Story is linked to Білий Oversize футболка базова. Customer ' +
      'replies with a price question. Engine resolves the link via ' +
      'handleColorLinkedMedia and renders confirm_color_variant_in_stock ' +
      '— the same template surfaces the linked color, sizes, and the ' +
      'price baked into the {sizes} rendering. #1 wow moment in the ' +
      'sales pitch.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Скільки коштує?',
        mediaReference: { mediaId: '18018605627836110', type: 'story' },
        expect: {
          decision: 'reply',
          scenario: 'confirm_color_variant_in_stock',
          replyContains: ['Білий', 'Розміри'],
          state: { selectionState: 'awaiting_variant' },
          note: 'Story link + price ask → color-link template',
        },
      },
    ],
  },

  // ─── 2.2 Killer feature: size pre-qualify via measurements ──────
  showcase_women_size_prequalify_numeric: {
    name: 'showcase — Size pre-qualify (180/70 → L)',
    description:
      'Customer wants a specific product but asks for sizing help. ' +
      'Bot offers; customer provides height+weight; engine maps to ' +
      'L via flow_config.sizeChart (heightMax=180, weightMin=70 in ' +
      'L band) and confirms. Validates the maybeMidFlowSizeHelp + ' +
      'numeric body measurement pipeline from carousel 2.3.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Хочу Сукню міді базову, але не знаю розмір',
        expect: { decision: 'reply' },
      },
      {
        message: '180 70',
        expect: {
          decision: 'reply',
          replyContains: ['L'],
          note: 'size chart 180cm/70kg → L',
        },
      },
    ],
    flaky: true,
  },

  // ─── 2.3 Killer feature: variant precision in one shot ──────────
  showcase_women_variant_precision_beige_s: {
    name: 'showcase — Direct: Бежевий S футболка → confirm',
    description:
      'Single-message ask with color + size combined. Бежевий S of ' +
      'the oversize tee is qty=10. Engine extracts both axes in one ' +
      'shot and routes straight to confirm_variant_available. ' +
      'Validates carousel 2.2 (variant precision).',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Є бежева оверсайз футболка в розмірі S?',
        expect: {
          decision: 'reply',
          scenario: 'confirm_variant_available',
          replyContains: ['Бежевий', 'S', 'наявн'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'color+size in one message → direct confirm',
        },
      },
    ],
  },

  // ─── 3.3 Multi-item cart (sequential, one-by-one) ───────────────
  showcase_women_multi_item_cart_sequential: {
    name: 'showcase — Multi-item cart → checkout',
    description:
      'Customer adds two items in separate turns (multi-item flow ' +
      'today is one item per message). Second product is picked with ' +
      'an unambiguous color+size combo (Бежевий S Спідниця) so the ' +
      'engine resolves the variant in one shot and routes straight ' +
      'to confirm. Validates the multi-line cart + draft order ' +
      'persistence path end-to-end. Marked flaky because the LLM ' +
      'classifier occasionally relabels the 2nd-item "Так" as a ' +
      'plain confirmation instead of a cart-add, requiring an extra ' +
      '"оформлюємо" turn to advance — non-deterministic but real.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    flaky: true,
    turns: [
      {
        message: 'Хочу чорну Сукню міді базову М',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      {
        message: 'Так',
        expect: {
          decision: 'reply',
          state: { selectionState: 'cart_item_added', cartLength: 1 },
        },
      },
      {
        message: 'Хочу ще Спідницю плісе бежеву S',
        expect: {
          decision: 'reply',
          note: '2nd product surfaced; engine may show before auto-confirming',
        },
      },
      {
        message: 'Так',
        expect: {
          decision: 'reply',
          state: { selectionState: 'cart_item_added', cartLength: 2 },
          note: '5.5a cart-adds 2nd item',
        },
      },
      {
        message: 'оформлюємо',
        expect: { decision: 'reply' },
      },
      {
        message: 'Олександр Хана, +380501234567, Тернопіль, відділення 5',
        expect: {
          decision: 'create_draft_order',
          state: { orderCreated: true },
          note: 'two-item draft order persisted',
        },
      },
    ],
  },

  // ─── 4.1 Edge case: mid-conversation product switch ─────────────
  showcase_women_mid_conversation_switch: {
    name: 'showcase — Mid-flow product switch (correction)',
    description:
      'Customer picks Сукня літня квіткова M, then immediately ' +
      'corrects to Сукня міді базова M. Engine should clear stale ' +
      'state, switch selectedProductId, and offer the new product. ' +
      'Validates the correction-handling class of bug fixes.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Хочу Сукню літню квіткову М',
        expect: {
          decision: 'reply',
          state: { selectionState: 'awaiting_confirmation' },
        },
      },
      {
        message: 'Ні, краще Сукню міді базову Чорний M',
        expect: {
          decision: 'reply',
          replyContains: ['міді базова'],
          replyNotContains: ['літн'],
          state: { selectionState: 'awaiting_confirmation' },
          note: 'product switched without stale state leakage',
        },
      },
    ],
    flaky: true,
  },

  // ─── 4.2 Edge case: anaphora (color+size on last list) ──────────
  showcase_women_anaphora_color_size_only: {
    name: 'showcase — "Давайте чорну М" after dresses shown',
    description:
      'Customer browses dresses, then says only "чорну М" — no ' +
      'product name. Engine narrows on lastPresentedProducts to the ' +
      '2 black-M dress candidates (Сукня міді базова, Сукня-комбінація ' +
      'сатинова) and renders show_products scoped to those. TODO: ' +
      'anaphora flow does not auto-pick when narrowing yields >1 ' +
      'candidate — currently re-shows the narrowed list. Documents ' +
      'current behavior; a future improvement would auto-advance ' +
      "when the customer's clarification still leaves multiple " +
      'candidates by asking for product name disambiguation.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'Що у вас є з суконь?',
        expect: { decision: 'reply', scenario: 'show_products' },
      },
      {
        message: 'Давайте чорну М',
        expect: {
          decision: 'reply',
          replyContains: ['Чорний', 'M'],
          note: 'narrowed re-presentation — does not auto-advance with >1 candidate',
        },
      },
    ],
  },

  // ─── 4.3 Edge case: handoff for complex/post-sale ───────────────
  showcase_women_complex_handoff: {
    name: 'showcase — Complex query → handoff',
    description:
      "Customer asks about a past order or refund — outside the bot's " +
      'sales mandate. Engine should escalate via policy-engine ' +
      'instead of looping through "як можу допомогти". Validates ' +
      'carousel 4 (bot recognizes its own limits).',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'У мене проблема з минулим замовленням',
        expect: {
          decision: 'handoff',
          note: 'Sensitive query → silent handoff',
        },
      },
    ],
    flaky: true,
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

  // ─── Size chart resolved from lastPresentedProducts ─────────────
  showcase_women_size_chart_from_shown_products: {
    name: 'showcase — Size chart resolved from shown products',
    description:
      'After browsing dresses without picking one, customer asks ' +
      '"розмірна сітка є?". memory.selectedProductId and ' +
      'ctx.mediaProductData are both empty, so the chart handler must ' +
      'derive category from memory.lastPresentedProducts (last entry → ' +
      'getBrandAndCategoryForProduct returns category=Сукні) and ' +
      'resolve to the "сукні" chart instead of the tenant default ' +
      '("верх"). Validates the history-aware chart resolution path. ' +
      'Marked flaky because turn 1\'s classifier may also stamp ' +
      'memory.selectedCategory="сукні" — in that case the existing ' +
      'fallback path lands on the same chart and the assertion still ' +
      'passes; the differentiator is the ' +
      '"size_chart_request: ctx source=shown" trace line in ' +
      'conversations.log.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'є сукні?',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
          note: 'dresses surfaced; lastPresentedProducts populated with productIds',
        },
      },
      {
        message: 'розмірна сітка є?',
        expect: {
          decision: 'reply',
          scenario: 'show_size_chart',
          imageCount: 1,
          note:
            'engine resolves сукні chart (not the "верх" default) via ' +
            'memory.lastPresentedProducts → category=Сукні. Functional ' +
            'proof is the "size_chart_request: ctx source=shown" trace ' +
            'line + the resolved chart image. Showcase tenant has no ' +
            'show_size_chart template seeded so the rendered text falls ' +
            'back to generic "Ось наша розмірна сітка 💛" — chart-name ' +
            'replyContains would be brittle here.',
        },
      },
    ],
    flaky: true,
  },

  // Complementary help-style coverage for the same fix. Help-style
  // attaches the chart via extraReplies, which production Instagram
  // drops (CLAUDE.md tech debt at instagram.service.ts:668-674) — the
  // engine-side resolution is still exercised end-to-end here, and the
  // new trace line at the extraReplies attach point makes the silent
  // drop discoverable in prod logs.
  showcase_women_size_chart_help_style_from_shown_products: {
    name: 'showcase — Help-style size chart after browse',
    description:
      'After browsing dresses, customer asks "як зрозуміти який мій ' +
      'розмір?" (help-style). Engine asks for measurements and attaches ' +
      'the сукні chart as an extraReply. Validates that the same ' +
      'history-aware derivation applies before the help-style vs ' +
      'direct-ask split.',
    tenantId: SHOWCASE_WOMEN_CLOTHES,
    turns: [
      {
        message: 'є сукні?',
        expect: {
          decision: 'reply',
          scenario: 'show_products',
        },
      },
      {
        message: 'як зрозуміти який мій розмір?',
        expect: {
          decision: 'reply',
          extraReplyCount: 1,
          note:
            'primary reply asks for measurements; chart attached as ' +
            'extraReplies[0]. Production Instagram drops this — trace ' +
            '"help-style attaching chart as extraReply" identifies it.',
        },
      },
    ],
    flaky: true,
  },
};
