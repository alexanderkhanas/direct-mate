/**
 * Contract between the v2 agent and its caller (the turn runner, Phase 3).
 * The agent decides and writes; the caller sends, records and commits.
 */

/** One entry of the conversation as the agent sees it, oldest first. */
export type AgentHistoryEntry =
  /** `images`: our copies of photos sent with this message, given to the model as images. */
  | { role: 'customer'; text: string; images?: string[] }
  | { role: 'bot'; text: string }
  /** A human manager's message in the same thread. */
  | { role: 'manager'; text: string }
  /** Context for the model, never shown to the customer: gap markers, an earlier conversation, a resolved photo. */
  | { role: 'note'; text: string };

export interface AgentTurnInput {
  tenantId: string;
  conversationId: string;
  customerId: string;
  /** Ends with the customer's new message(s). */
  history: AgentHistoryEntry[];
  /** Per-turn facts from the caller, e.g. "a welcome line is prepended to this reply". */
  notes?: string[];
  /** Model for this turn only (simulator `--model`); beats the store's override. */
  modelOverride?: string;
  now?: Date;
}

/**
 * Something a tool asked to happen alongside the reply. Tools only validate
 * and stage; the caller carries these out (live), skips them (demo) or records
 * them (dry run), after the reply passes the guards.
 */
export type StagedEffect =
  | { type: 'show_products'; images: Array<{ productId: string; url: string }> }
  | { type: 'send_size_chart'; imageUrl: string; name: string }
  | { type: 'place_order'; checkoutSessionId: string }
  | { type: 'send_payment_details'; checkoutSessionId: string; text: string };

export type HandoffReason =
  | 'customer_asked_for_human'
  | 'complaint_or_return'
  | 'order_change'
  | 'payment_check'
  | 'health_or_safety'
  | 'not_in_store_notes'
  | 'unsure'
  | 'other'
  // Set by the agent itself, not by the model:
  | 'ungrounded_reply'
  | 'step_limit'
  | 'empty_reply'
  | 'agent_error';

export interface AgentHandoff {
  reason: HandoffReason;
  summaryForManager: string | null;
}

export interface GroundingViolation {
  /**
   * `order`: the reply says the order is placed when it isn't.
   * `draft`: the reply says details were saved or an item added, but no draft update succeeded.
   * `promise`: a discount, promo code, gift, "free" or percentage the store notes and tools don't back.
   * `leak`: the reply quotes the system prompt.
   * `unsafe`: OpenAI moderation flagged the reply.
   */
  kind: 'price' | 'size' | 'color' | 'order' | 'draft' | 'promise' | 'leak' | 'unsafe';
  value: string;
}

export interface StyleViolation {
  rule: string;
  match: string;
  fix: string;
}

export interface AttemptReport {
  text: string;
  grounding: GroundingViolation[];
  style: StyleViolation[];
}

export interface AgentStepRecord {
  attempt: number;
  text: string;
  finishReason: string;
  toolCalls: Array<{ toolName: string; input: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
}

export interface AgentUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface AgentTurnResult {
  /**
   * Text to send. Null when there is nothing safe to say; with a handoff the
   * caller then sends only the store's announce line.
   */
  reply: string | null;
  effects: StagedEffect[];
  handoff: AgentHandoff | null;
  /** One report per attempt; a second attempt means the first failed a guard. */
  attempts: AttemptReport[];
  steps: AgentStepRecord[];
  model: string;
  usage: AgentUsage;
  /** Customer photos in the model's context; `rejected`: the provider refused them and the turn ran without. */
  images?: { inContext: number; unavailable: number; rejected: boolean };
  durationMs: number;
  error?: string;
}
