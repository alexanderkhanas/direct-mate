// Simulator scenario types and shared tenant constants.

/**
 * What a turn must produce. The first group checks outcomes, which is what
 * matters with the v2 agent: its path through a turn isn't fixed, so asserting
 * a route would test the wrong thing.
 *
 * The legacy group further down was written for the classifier engine. Those
 * fields still work: `mapLegacyExpect` (modules/testing/scenario-assertions.ts)
 * turns each into its outcome equivalent where one exists, and reports the
 * route-only ones it had to drop, per turn.
 */
export interface SimulatorTurnExpect {
  // ─── Outcomes ───────────────────────────────────────────────────
  /** Whether the turn handed off to a manager. */
  handoff?: boolean;
  /** Whether this turn's message started a new conversation (an idle gap passed). */
  newConversation?: boolean;
  /** The handoff reason, e.g. 'complaint_or_return', 'health_or_safety'. */
  handoffReason?: string;
  /** Substring(s) some outgoing message must contain (case-insensitive). */
  replyContains?: string | string[];
  /** Substring(s) no outgoing message may contain (case-insensitive). */
  replyNotContains?: string | string[];
  /** The reply itself (not the welcome or handoff lines) is at most this long, e.g. a refusal rather than a poem. */
  replyMaxChars?: number;
  /**
   * Size(s) the reply must name as a word ("XXL" counts as "2XL"). A size is
   * one or two letters, so `replyContains: 'L'` would match almost anything.
   */
  replyMentionsSize?: string | string[];
  /** Colour(s) the reply must name, in any form: «Білий» matches «біла», «білу», "White". */
  replyMentionsColor?: string | string[];
  /** Exact number of images across the outgoing messages. */
  imageCount?: number;
  /** At least this many images. Use when the count depends on the catalog. */
  imageCountMin?: number;
  /** Substring some image URL must contain (e.g. a size chart file name). */
  imageContains?: string;
  /** Tool(s) the agent must have called this turn. */
  toolCalled?: string | string[];
  /** Tool(s) the agent must not have called this turn. */
  toolNotCalled?: string | string[];
  /** The conversation's order draft after the turn. */
  orderDraft?: {
    /** Number of items in it. */
    itemCount?: number;
    /** Items that must be in it, in any order. `variantIncludes`: "Чорний, L" — every part must match. */
    items?: Array<{ titleIncludes?: string; variantIncludes?: string }>;
    complete?: boolean;
    customer?: Partial<Record<'fullName' | 'phone' | 'city' | 'novaPoshtaBranch' | 'paymentMethod', string>>;
  };
  /** Whether the conversation has a placed order after the turn. */
  orderPlaced?: boolean;
  /** Whether payment details have been sent for the current draft. */
  paymentDetailsSent?: boolean;
  /**
   * The products the bot offered this turn — named in the reply (any
   * inflection) or shown in a photo — checked by kind, not by name: «plain,
   * dressy shirts», not «Сорочка льон Premium». Attribute lists are the
   * values each offered product may have; a product without the attribute
   * fails.
   */
  shortlist?: {
    min?: number;
    max?: number;
    category?: string;
    attributes?: Partial<Record<'formality' | 'pattern' | 'colour' | 'fabricLook' | 'collar' | 'fit', string[]>>;
  };
  /** Free-form note describing what this turn is testing */
  note?: string;

  // ─── Legacy (classifier engine) ─────────────────────────────────
  /** @deprecated Use `handoff` / `orderPlaced`. Mapped: 'handoff' → handoff, 'reply' → no handoff, 'create_draft_order' → orderPlaced. */
  decision?: 'reply' | 'handoff' | 'create_draft_order';
  /** @deprecated Route assertion; dropped (the agent has no template scenarios). */
  scenario?: string;
  /** @deprecated Dropped: the agent's message layout differs from the engine's bubbles. */
  extraReplyCount?: number;
  /** @deprecated Mapped to `imageContains`. */
  extraReplyImageContains?: string;
  /**
   * @deprecated Engine memory. Mapped where an outcome exists — orderCreated →
   * orderPlaced, cartLength / cartHasVariant → orderDraft, recommendedSize →
   * replyMentionsSize — and dropped otherwise.
   */
  state?: {
    selectionState?: 'awaiting_product' | 'awaiting_variant' | 'awaiting_confirmation' | 'cart_item_added' | 'confirmed' | null;
    selectedProductId?: string | null;
    selectedVariantName?: string | null;
    selectedColor?: string;
    selectedSize?: string;
    variantStep?: 'color' | 'size' | null;
    cartLength?: number;
    cartHasVariant?: string;
    lastAction?: string;
    awaitingField?: string;
    preQualifyCollected?: boolean;
    recommendedSize?: string;
    recommendedSkinType?: string;
    shouldOfferSizeHelp?: boolean;
    awaitingPreQualifyAnswer?: boolean;
    orderCreated?: boolean;
  };
}

export interface SimulatorTurn {
  /**
   * Inbound message text. Pass a string for a single message, or an array
   * to simulate multiple messages that Instagram's 5-second debounce would
   * combine into one engine call (joined with '\n', matching production).
   */
  message: string | string[];
  mediaReference?: { mediaId: string; type: string };
  /**
   * If true and mediaReference.type === 'customer_photo', the simulator
   * resolves mediaReference.mediaId at runtime to the most recent linked
   * Instagram media_url for the scenario's tenant. Use this to exercise
   * the positive-match branch of matchCustomerPhoto (same image on both
   * sides → vision is near-certain to match).
   */
  resolveMediaFromLinkedProduct?: boolean;
  /**
   * A photo the customer sends before this turn's text: a file under
   * `apps/api/test-assets/` or a URL. It is its own message, as on Instagram,
   * stored the way an inbound photo is, so the agent sees it on this turn and
   * the later ones.
   */
  image?: string;
  /**
   * Move the clock forward this many hours before the turn: every earlier
   * message, the conversation and its order draft are shifted back in time.
   * Tests conversation boundaries ("the customer comes back the next day")
   * without waiting.
   */
  advanceHours?: number;
  expect?: SimulatorTurnExpect;
}

export interface SimulatorScenario {
  name: string;
  description: string;
  /**
   * Real tenant UUID, OR a slug string the runner resolves to a UUID at
   * boot. Slug form lets vertical scenario suites (e.g. cosmetics) avoid
   * hardcoding env-specific UUIDs.
   */
  tenantId: string;
  turns: SimulatorTurn[];
  /**
   * Shallow-merged onto store_configs.flow_config for the scenario's tenant
   * before the scenario runs; restored after (in try/finally) so failed
   * assertions still revert the override.
   */
  flowConfigOverride?: Record<string, unknown>;
  /**
   * Best-effort scenario — failures are reported separately in the `--all`
   * summary and do NOT cause non-zero exit. Use for tests of LLM-extraction
   * robustness on natural Ukrainian phrasing where the canonical few-shot
   * examples don't directly cover the input. Engine-flow-correctness
   * scenarios stay un-flaky and gate the suite normally.
   */
  flaky?: boolean;
  /**
   * A known open bug this scenario guards. Its failure is reported but doesn't
   * fail the run; if it starts passing, the run says so, so the marker can be
   * removed. Replaces the old "RED — bug guard" naming convention.
   */
  expectedFailure?: string;
}

// Real tenant IDs from the database. Demo tenants use slugs (resolved at
// boot) so the same scenario file works across env-specific UUIDs.
export const PILOT_STORE = 'df1ab482-b328-4e8d-9d8c-40f8a426cf66';
export const CLOTHES_STORE = 'f42abe74-54af-468f-8912-39f1c19106af';
// luxespace — luxury multi-brand reseller (Bottega Veneta, Polo Ralph
// Lauren, Nanushka, Alexander McQueen, …). Catalog imported from
// Torgsoft via FTP. Slug-based (not UUID) so the same scenario file
// works across envs — dev luxe-space and prod luxe-space have
// different UUIDs. `SimulatorService.resolveTenantId` accepts both.
export const LUXESPACE = 'luxe-space';
// showcase-women-clothes — non-demo (is_demo=false) clothing tenant
// created via `seed:showcase:prod:women-clothes` for live sales-demo
// use, with a custom 10-product catalog inserted via SQL. Slug-based
// to dodge env-specific UUIDs; only seeded on prod today.
export const SHOWCASE_WOMEN_CLOTHES = 'showcase-women-clothes';
export const DEMO_WOMEN_CLOTHES_SLUG = 'demo-women-clothes';
export const DEMO_COSMETICS_SLUG = 'demo-cosmetics';
// demo-altamen — is_demo=true men's clothing tenant seeded from the scraped
// altamen.com.ua catalog (seed:demo:altamen). Merged multi-color products
// (color+size variants, per-variant prices — «Сорочка льон» mixes 3300/3900).
export const DEMO_ALTAMEN_SLUG = 'demo-altamen';
// men-demo-store — is_demo=true clothing tenant. Originally prod-only; it
// has since been copied to local (catalog, variants, size charts,
// templates and media), so these scenarios run in BOTH environments. It is
// not reproducible from this repo's seed builders, so a reseed will not
// recreate it — copy it from prod again if a local DB is rebuilt.
//
// Catalog: 4 size-only products (Джинси МОМ світлі, Сорочка з льону,
// Футболка базова чорна, Шорти джинсові світлі), no colour axis, all
// variants in stock, NO descriptions. Only the T-shirt has XL.
// `flow_config` is `{}`, so `resolveSizeHelpMode` yields 'chart'; 3
// size_charts rows are authored (Верх / Низ / Сукні, category-scoped, no
// brands). Templates include the full checkout set.
//
// Cleanest tenant we have — used as the measuring instrument for
// classifier A/B tests. Same slug-based indirection as LUXESPACE.
export const MEN_DEMO_STORE = 'men-demo-store';
