import { stem } from '../agent/catalog/catalog-search';
import type { ProductAttributes } from '../catalog/attributes/product-attributes';

/** A product the bot offered in a turn: named in the reply or shown in a photo. */
export interface ShortlistItem {
  ref: string;
  title: string;
  category: string | null;
  attributes: ProductAttributes;
  via: 'named' | 'photo' | 'named+photo';
}

const WORD = /[\p{L}\d'’ʼ]+/gu;

function stems(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).map(stem);
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Two stems name the same word. The stemmer leaves short words alone («біла»
 * vs «білу»), so a shared prefix of all but the last letter counts too.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return commonPrefix(a, b) >= Math.max(3, Math.min(a.length, b.length) - 1);
}

/**
 * Which `titles` the reply names, in any inflection and word order: «білу
 * сорочку льон Premium» names «Сорочка льон Premium». Longer titles match
 * first and use up their words, so the same words don't also count as the
 * shorter «Сорочка льон».
 */
export function titlesMentioned(reply: string, titles: string[]): string[] {
  const tokens = stems(reply);
  const used = tokens.map(() => false);
  const found: string[] = [];

  for (const title of [...new Set(titles)].sort((a, b) => b.length - a.length)) {
    const need = stems(title);
    if (need.length === 0) continue;
    const span = need.length + 2;
    for (let start = 0; start < tokens.length; start++) {
      if (used[start] || !need.some((w) => sameWord(w, tokens[start]))) continue;
      const remaining = [...need];
      const picked: number[] = [];
      for (let i = start; i < Math.min(tokens.length, start + span) && remaining.length > 0; i++) {
        const k = remaining.findIndex((w) => !used[i] && sameWord(w, tokens[i]));
        if (k >= 0) {
          picked.push(i);
          remaining.splice(k, 1);
        }
      }
      if (remaining.length === 0) {
        for (const i of picked) used[i] = true;
        found.push(title);
        break;
      }
    }
  }
  return found;
}

/** `ref` → `title` for every product a tool returned this turn, wherever it sits in the output. */
export function productsInToolOutputs(outputs: unknown[]): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      if (typeof o.ref === 'string' && typeof o.title === 'string') found.set(o.ref, o.title);
      Object.values(o).forEach(walk);
    }
  };
  outputs.forEach(walk);
  return found;
}
