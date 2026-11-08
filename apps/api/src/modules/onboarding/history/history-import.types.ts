/**
 * The Instagram history import's state, kept in `tenant_onboarding.history_import`
 * (jsonb). Only what the analysis drew from the chats is kept; raw messages
 * never are. See docs/v2-agent/ig-conversation-history.md for the API limits
 * that shape the queue.
 */

export type HistoryImportStatus =
  /** The owner's consent is recorded, but no import has been asked for yet (or a pending one was called off). */
  | 'idle'
  /** Waiting its turn in the app-wide queue (or for `retryAfter`). */
  | 'queued'
  | 'running'
  | 'done'
  /** Waiting for Meta's hourly budget, which is the app's (code 4 or the 75 % stop); retried after `retryAfter`, no polling meanwhile. */
  | 'limited'
  | 'failed'
  /** Read, but too few replies by a person to learn from, even after the top-up. */
  | 'empty';

/** Which part of the store notes a fact belongs to; `hours` feeds the working hours. */
export type HistoryFactSection = 'delivery' | 'payment' | 'returns' | 'contacts' | 'hours';

export interface HistoryFact {
  section: HistoryFactSection;
  /** One plain Ukrainian statement, as a manager would put it. */
  text: string;
  /** How many conversations said it: a fact the shop repeats is more likely true today. */
  count: number;
}

export interface HistoryExample {
  customer: string;
  manager: string;
}

export interface HistoryImport {
  /** The owner agreed to have recent chats read (the Instagram step's switch). */
  consent: boolean;
  status: HistoryImportStatus;
  /** ISO time it joined the queue: the queue runs oldest first. */
  queuedAt?: string | null;
  /** ISO time of the worker's last sign of life (claimed, then refreshed between Graph calls); a `running` import silent for 10 minutes was cut off by a restart. */
  startedAt?: string | null;
  /** The run that holds it: the worker writes results only while this is still its run (and consent still holds). */
  runId?: string | null;
  /** ISO time; not before this (budget pause or the one top-up). */
  retryAfter?: string | null;
  /** The one top-up an hour later, for a store whose first pass found too few human replies, has been used. */
  toppedUp?: boolean;
  /** Runs that ended in an error (a network failure, a 5xx, the model, a restart); caps the retries. Budget pauses don't count. */
  attempts?: number;
  stats?: { conversations: number; messages: number; humanReplies: number };
  /** A paragraph for `brand_tone_prompt`, in Ukrainian. */
  tone?: string | null;
  /** Short chips: «на «ви»», «коротко», «з емодзі». */
  traits?: string[];
  examples?: HistoryExample[];
  facts?: HistoryFact[];
  /** The owner applied the tone and examples (the `tone` step counts as done). */
  applied?: boolean;
  analyzedAt?: string | null;
  error?: string | null;
}

/** GET /onboarding/history: the import's state (never raw messages) and whether Instagram is connected. */
export interface HistoryImportView {
  instagramConnected: boolean;
  import: HistoryImport | null;
}
