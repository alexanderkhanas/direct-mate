// Simulator scenario types and shared tenant constants.

export interface SimulatorTurnExpect {
  /** Expected ReplyEngineOutput.decision */
  decision?: 'reply' | 'handoff' | 'create_draft_order';
  /** Expected templateScenario value (e.g. 'confirm_selection') */
  scenario?: string;
  /** Substring(s) the main reply text MUST contain */
  replyContains?: string | string[];
  /** Substring(s) the main reply text MUST NOT contain */
  replyNotContains?: string | string[];
  /** Expected number of image URLs attached */
  imageCount?: number;
  /** Expected number of follow-up replies (extraReplies array length). */
  extraReplyCount?: number;
  /** Substring that at least one extraReplies[*].imageUrls entry must contain. */
  extraReplyImageContains?: string;
  /** Partial state assertions (all listed keys must match exactly) */
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
  /** Free-form note describing what this turn is testing */
  note?: string;
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
}

// Real tenant IDs from the database. Demo tenants use slugs (resolved at
// boot) so the same scenario file works across env-specific UUIDs.
export const PILOT_STORE = 'df1ab482-b328-4e8d-9d8c-40f8a426cf66';
export const CLOTHES_STORE = 'f42abe74-54af-468f-8912-39f1c19106af';
export const DEMO_WOMEN_CLOTHES_SLUG = 'demo-women-clothes';
export const DEMO_COSMETICS_SLUG = 'demo-cosmetics';
