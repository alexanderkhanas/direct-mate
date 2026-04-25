export type Role = 'user' | 'bot';

export interface Turn {
  role: Role;
  text: string;
  imageUrls?: string[];
  /** Extra delay (ms) prepended before this turn appears. */
  delayMs?: number;
  /** Bot turn renders the grey handoff banner instead of a speech bubble. */
  isHandoff?: boolean;
  /** Append a small italic gray hint under the bubble. Used for live-mode aggregation. */
  aggregatedHint?: boolean;
}

export interface Scenario {
  key: string;
  title: string;
  icon?: string;
  turns: Turn[];
}

export interface DisplayedTurn extends Turn {
  /** Stable React key; also used for fade-in animation trigger. */
  id: string;
}
