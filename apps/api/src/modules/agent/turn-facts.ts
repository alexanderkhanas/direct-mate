import { normSize } from './catalog/catalog-format';
import { HANDOFF_TOOL } from './tools';
import type { AgentHandoff, StagedEffect } from './agent.types';

/**
 * Both the fact ledger and the outbox are rebuilt from the turn's tool results
 * rather than collected by the tools as they run. They are pure functions of
 * the trace, so what was checked and what was sent can always be
 * reconstructed from it.
 */

export interface TurnFacts {
  prices: number[];
  sizes: string[];
  colors: string[];
  titles: string[];
  /** Percentages in any text a tool returned («100% льон»). */
  percents: number[];
  /** A tool returned a product with a crossed-out regular price, so «знижка»/«акція» about it is true. */
  onSale: boolean;
}

interface StepLike {
  toolResults: Array<{ toolName: string; output: unknown }>;
}

// The output keys tools use (`tools/product-shapes.ts`, `tools/order.tools.ts`).
// A value under one of these keys, anywhere in a result, is a fact.
const PRICE_KEYS = new Set(['price', 'maxPrice', 'regularPrice', 'lineTotal', 'total']);
const SIZE_KEYS = new Set(['size', 'sizesInStock', 'inStockSizes', 'outOfStockSizes', 'recommendedSize']);
const COLOR_KEYS = new Set(['color', 'colorsInStock']);
const TITLE_KEYS = new Set(['title']);
export const PERCENT = /(\d{1,3}(?:[.,]\d)?)\s?%/g;

/** Facts from any tool-shaped value: tool outputs, or the draft loaded at turn start. */
export function collectFacts(values: unknown[]): TurnFacts {
  const prices = new Set<number>();
  const sizes = new Set<string>();
  const colors = new Set<string>();
  const titles = new Set<string>();
  const percents = new Set<number>();
  let onSale = false;

  const walk = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      // Arrays inherit their key: sizesInStock: ['M', 'L'].
      for (const item of value) walk(item, key);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    } else if (key && typeof value === 'number' && PRICE_KEYS.has(key)) {
      prices.add(value);
      if (key === 'regularPrice') onSale = true;
    } else if (typeof value === 'string' && value.trim()) {
      for (const m of value.matchAll(PERCENT)) percents.add(Number(m[1].replace(',', '.')));
      if (!key) return;
      if (SIZE_KEYS.has(key)) sizes.add(normSize(value));
      else if (COLOR_KEYS.has(key)) colors.add(value);
      else if (TITLE_KEYS.has(key)) titles.add(value);
    }
  };
  for (const value of values) walk(value);

  return {
    prices: [...prices],
    sizes: [...sizes],
    colors: [...colors],
    titles: [...titles],
    percents: [...percents],
    onSale,
  };
}

export function collectTurnFacts(steps: StepLike[], extra: unknown[] = []): TurnFacts {
  const outputs = steps.flatMap((s) =>
    s.toolResults.filter((r) => r.toolName !== HANDOFF_TOOL).map((r) => r.output),
  );
  return collectFacts([...outputs, ...extra]);
}

/**
 * Side effects staged by tools, in call order, each once; plus the handoff if
 * the model asked for one.
 */
export function collectEffects(steps: StepLike[]): { effects: StagedEffect[]; handoff: AgentHandoff | null } {
  const effects: StagedEffect[] = [];
  const seen = new Set<string>();
  let handoff: AgentHandoff | null = null;

  for (const step of steps) {
    for (const result of step.toolResults) {
      const out = result.output as { ok?: boolean; staged?: StagedEffect; handoff?: AgentHandoff } | null;
      if (result.toolName === HANDOFF_TOOL && out?.handoff) {
        handoff = out.handoff;
      } else if (out?.ok && out.staged) {
        const key = JSON.stringify(out.staged);
        if (!seen.has(key)) {
          seen.add(key);
          effects.push(out.staged);
        }
      }
    }
  }
  return { effects, handoff };
}
