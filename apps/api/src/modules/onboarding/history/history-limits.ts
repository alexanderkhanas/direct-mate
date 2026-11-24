import { z } from 'zod';

/** Conversations with a reply from the shop that the import reads, unless the store sets its own. */
export const DEFAULT_CONVERSATIONS = 30;
/** The latest messages read from each conversation, unless the store sets its own. */
export const DEFAULT_MESSAGES_PER_CONVERSATION = 30;
/**
 * Ceilings on a store's own numbers. Meta's message-read budget is shared by
 * every store on the app, so one store can't be allowed to spend hours of it.
 */
export const MAX_CONVERSATIONS = 100;
export const MAX_MESSAGES_PER_CONVERSATION = 300;

export interface HistoryLimits {
  conversations: number;
  messagesPerConversation: number;
}

const count = (max: number) =>
  z
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, max))
    .optional()
    .catch(undefined);

const limitsSchema = z
  .object({
    conversations: count(MAX_CONVERSATIONS),
    messagesPerConversation: count(MAX_MESSAGES_PER_CONVERSATION),
  })
  .catch({});

/**
 * How much of a store's Instagram history the import reads:
 * `store_configs.flow_config.historyImport`, e.g. `{ "messagesPerConversation": 100 }`.
 * A missing or malformed number falls back to the default; one past the
 * ceiling is held at the ceiling.
 */
export function historyLimits(raw: unknown): HistoryLimits {
  const parsed = limitsSchema.parse(raw ?? {});
  return {
    conversations: parsed.conversations ?? DEFAULT_CONVERSATIONS,
    messagesPerConversation: parsed.messagesPerConversation ?? DEFAULT_MESSAGES_PER_CONVERSATION,
  };
}
