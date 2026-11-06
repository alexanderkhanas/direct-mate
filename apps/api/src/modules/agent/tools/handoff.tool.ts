import { tool } from 'ai';
import { z } from 'zod';

export const MODEL_HANDOFF_REASONS = [
  'customer_asked_for_human',
  'complaint_or_return',
  'order_change',
  'payment_check',
  'health_or_safety',
  'not_in_store_notes',
  'unsure',
  'other',
] as const;

/** Ends the turn (the agent stops on this call). */
export function handoffTool() {
  return tool({
    description:
      'Pass the conversation to a human manager. Use it when: the customer asks for a person; complaints, ' +
      'returns, exchanges, damaged or wrong items; changes to an order already placed; a payment receipt to ' +
      'check (payment_check); health, allergy or ' +
      "safety questions; anything the store notes and tools can't answer; or when you are unsure. It ends " +
      'your turn. Write your reply with it: answer everything you can from the tools (a size, a price, stock) ' +
      'and say what the manager will check. A line telling the customer a manager will reply is added ' +
      "automatically, so don't write that yourself.",
    inputSchema: z.object({
      reason: z.enum(MODEL_HANDOFF_REASONS),
      summaryForManager: z
        .string()
        .min(1)
        .max(500)
        .describe('One or two sentences in Ukrainian for the manager: what the customer wants, which products and sizes.'),
    }),
    execute: async ({ reason, summaryForManager }) => ({ ok: true, handoff: { reason, summaryForManager } }),
  });
}
