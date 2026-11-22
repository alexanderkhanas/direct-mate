import { queryStems } from './catalog/catalog-search';
import type { AgentStepRecord } from './agent.types';

export interface ProductMention {
  ref: string;
  title: string;
}

/** A reply rarely discusses more; past this the note stops helping. */
const MAX_PRODUCTS = 8;
const REF = /^[0-9a-f]{8}/;

/**
 * The products a reply was about, with their refs, saved with the bot's
 * message so later turns can resolve «давайте звичайну» from the history.
 * History keeps only text, so without this the model could only find the
 * ref again in the full catalog list or with another search.
 *
 * A product counts when the turn looked it up (get_product), showed its
 * photos (show_products) or added it to the order, or when a search or
 * category listing returned it and the reply names it.
 */
export function productsInReply(steps: AgentStepRecord[], reply: string | null): ProductMention[] {
  const titles = new Map<string, string>();
  for (const step of steps) {
    for (const result of step.toolResults) collectTitles(result.output, titles);
  }

  const picked: string[] = [];
  const pick = (raw: unknown) => {
    const ref = typeof raw === 'string' ? raw.trim().toLowerCase().match(REF)?.[0] : undefined;
    if (ref && titles.has(ref) && !picked.includes(ref)) picked.push(ref);
  };
  for (const step of steps) {
    for (const call of step.toolCalls) {
      const input = (call.input ?? {}) as Record<string, any>;
      if (call.toolName === 'get_product') pick(input.productRef);
      if (call.toolName === 'show_products') {
        (input.items ?? []).forEach((item: { productRef?: unknown }) => pick(item?.productRef));
        (input.productRefs ?? []).forEach(pick); // traces from before per-product colours
      }
      if (call.toolName === 'update_order_draft') pick(input.addItem?.productRef);
    }
  }

  if (reply) {
    const said = new Set(queryStems(reply));
    for (const [ref, title] of titles) {
      const stems = queryStems(title);
      if (stems.length > 0 && stems.every((s) => said.has(s))) pick(ref);
    }
  }
  return picked.slice(0, MAX_PRODUCTS).map((ref) => ({ ref, title: titles.get(ref)! }));
}

/** Every `{ref|productRef, title}` pair anywhere in a tool's output. */
function collectTitles(value: unknown, into: Map<string, string>): void {
  if (Array.isArray(value)) {
    value.forEach((v) => collectTitles(v, into));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  const ref = typeof obj.ref === 'string' ? obj.ref : typeof obj.productRef === 'string' ? obj.productRef : null;
  const match = ref?.toLowerCase().match(REF)?.[0];
  if (match && typeof obj.title === 'string' && !into.has(match)) into.set(match, obj.title);
  for (const v of Object.values(obj)) collectTitles(v, into);
}
