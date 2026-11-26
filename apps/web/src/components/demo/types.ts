import type { ReactNode } from 'react';

export type Role = 'user' | 'bot';

/**
 * Optional Instagram reply context attached to a user turn — renders an
 * inline story/post preview above the bubble, matching how real Instagram
 * DMs show "You replied to their story/post" with a small visual preview.
 * Only meaningful on user turns; bot turns ignore it.
 */
export interface InstagramContext {
  type: 'story' | 'post';
  mediaUrl: string;
}

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
  /**
   * If set on a user turn, renders an Instagram story/post preview above
   * the message bubble (right-aligned, matches real Instagram DM layout).
   */
  instagramContext?: InstagramContext;
}

export interface Scenario {
  key: string;
  title: string;
  /** Lucide icon node rendered in the chip. Cross-platform consistent vs emoji. */
  icon?: ReactNode;
  turns: Turn[];
}

export interface DisplayedTurn extends Turn {
  /** Stable React key; also used for fade-in animation trigger. */
  id: string;
}
