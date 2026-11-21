import { tool } from 'ai';
import { z } from 'zod';

/**
 * The only reasons the model may hand off for. Not being sure isn't one: what the tools and store notes don't answer,
 * the agent says it doesn't know and offers a manager, and hands off only when the customer wants that.
 */
export const MODEL_HANDOFF_REASONS = [
  'customer_asked_for_human',
  'lost_context',
  'payment_check',
  'complaint_or_return',
  'order_change',
] as const;

/** What the model is told right after it hands off: the agent gets one more step to write the reply (agent.service). */
export const AFTER_HANDOFF_NOTE =
  'Handoff recorded. Now write your reply to the customer: answer what you can from the tools (a size, a product, ' +
  'stock) and say what the manager will check. Don\'t write that a manager will reply: that line is added automatically.';

export function handoffTool() {
  return tool({
    description:
      'Pass the conversation to a human manager. Only when: the customer asks for a person, or says yes after you ' +
      'offered to check with a manager (customer_asked_for_human); you can\'t follow the conversation even after ' +
      'asking once what they mean (lost_context); a payment receipt or transfer to check (payment_check); a return, ' +
      'exchange, complaint, or a damaged or wrong item (complaint_or_return); a change to an order already placed ' +
      '(order_change). Never for anything else: when the tools and store notes don\'t answer something, say so and ' +
      'offer to check with a manager instead. After this call you write your reply to the customer.',
    inputSchema: z.object({
      reason: z.enum(MODEL_HANDOFF_REASONS),
      summaryForManager: z
        .string()
        .min(1)
        .max(500)
        .describe('One or two sentences in Ukrainian for the manager: what the customer wants, which products and sizes.'),
    }),
    execute: async ({ reason, summaryForManager }) => ({ ok: true, handoff: { reason, summaryForManager }, note: AFTER_HANDOFF_NOTE }),
  });
}
