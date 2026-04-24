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
  /** Partial state assertions (all listed keys must match exactly) */
  state?: {
    selectionState?: 'awaiting_product' | 'awaiting_variant' | 'awaiting_confirmation' | 'cart_item_added' | 'confirmed' | null;
    selectedProductId?: string | null;
    selectedVariantName?: string | null;
    cartLength?: number;
    cartHasVariant?: string;
    lastAction?: string;
    awaitingField?: string;
    preQualifyCollected?: boolean;
    recommendedSize?: string;
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
  tenantId: string;
  turns: SimulatorTurn[];
}

// Real tenant IDs from the database.
export const PILOT_STORE = 'df1ab482-b328-4e8d-9d8c-40f8a426cf66';
export const CLOTHES_STORE = 'f42abe74-54af-468f-8912-39f1c19106af';
