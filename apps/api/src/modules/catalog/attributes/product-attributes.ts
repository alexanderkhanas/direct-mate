import { createHash } from 'crypto';

/**
 * Visual attributes per product: what an item looks like, read from its main
 * photo (plus title and description) by a vision model and editable in admin.
 * The agent's category listing shows them, so "a shirt for a wedding" is
 * judged from the product's look instead of from words in its title.
 *
 * There are deliberately no occasion tags (wedding, office, beach): the model
 * maps an occasion to these attributes itself, and a store never has to keep
 * an occasion list up to date.
 *
 * Values are the Ukrainian words the agent and the admin show. Colour is free
 * text; every other attribute is one of a fixed list, so the listing stays
 * comparable across products.
 */
export const ATTRIBUTE_VALUES = {
  formality: ['повсякденна', 'смарт-кежуал', 'святкова'],
  pattern: ['однотонний', 'смужка', 'клітинка', 'принт', 'меланж'],
  fabricLook: ['гладка', 'фактурна', 'трикотажна', 'джинсова', 'блискуча', 'ворсиста', 'шкіряна'],
  collar: ['кент', 'button-down', 'стійка', 'поло', 'кругла горловина', 'V-горловина', 'капюшон', 'лацкани'],
  fit: ['приталений', 'прямий', 'вільний', 'оверсайз'],
} as const;

export type ListedAttribute = keyof typeof ATTRIBUTE_VALUES;
export type AttributeKey = ListedAttribute | 'colour';

/** Display order, everywhere. */
export const ATTRIBUTE_KEYS: AttributeKey[] = ['formality', 'pattern', 'colour', 'fabricLook', 'collar', 'fit'];

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  formality: 'Стиль',
  pattern: 'Візерунок',
  colour: 'Колір',
  fabricLook: 'Фактура',
  collar: 'Комір',
  fit: 'Посадка',
};

export type ProductAttributes = Partial<Record<AttributeKey, string>>;
export type AttributeSource = 'ai' | 'manual';

/** `products.attributes_meta`. */
export interface AttributesMeta {
  /** Per attribute: `manual` values are never overwritten by extraction. */
  sources?: Partial<Record<AttributeKey, AttributeSource>>;
  /** Hash of what the last successful extraction read; see `attributesInputHash`. */
  inputHash?: string;
  model?: string;
  extractedAt?: string;
  /** Last attempt, successful or not; failed products are retried after a backoff. */
  attemptedAt?: string;
  error?: string;
}

const MAX_COLOUR_CHARS = 40;

export function isAttributeKey(key: string): key is AttributeKey {
  return (ATTRIBUTE_KEYS as string[]).includes(key);
}

/** A value an attribute accepts, normalised; null when it doesn't accept it. */
export function normalizeAttributeValue(key: AttributeKey, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (key === 'colour') {
    return trimmed.length > MAX_COLOUR_CHARS ? null : trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
  }
  const allowed = ATTRIBUTE_VALUES[key] as readonly string[];
  return allowed.find((v) => v.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

/**
 * Admin edits: `{ formality: 'святкова', collar: null }`. A value sets the
 * attribute, null clears it; either way the attribute becomes `manual`, so a
 * cleared value isn't refilled by the next extraction.
 */
export function parseAttributePatch(
  body: unknown,
): { patch: Partial<Record<AttributeKey, string | null>> } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Expected an object of attributes.' };
  const patch: Partial<Record<AttributeKey, string | null>> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isAttributeKey(key)) return { error: `Unknown attribute "${key}".` };
    if (value === null) {
      patch[key] = null;
      continue;
    }
    const normalized = normalizeAttributeValue(key, value);
    if (normalized === null) {
      const allowed = key === 'colour' ? `text up to ${MAX_COLOUR_CHARS} characters` : ATTRIBUTE_VALUES[key].join(', ');
      return { error: `"${String(value)}" is not a valid ${key}. Allowed: ${allowed}.` };
    }
    patch[key] = normalized;
  }
  return { patch };
}

export function applyManualPatch(
  attributes: ProductAttributes,
  meta: AttributesMeta | null,
  patch: Partial<Record<AttributeKey, string | null>>,
): { attributes: ProductAttributes; meta: AttributesMeta } {
  const next: ProductAttributes = { ...attributes };
  const sources = { ...(meta?.sources ?? {}) };
  for (const key of Object.keys(patch) as AttributeKey[]) {
    const value = patch[key];
    if (value) next[key] = value;
    else delete next[key];
    sources[key] = 'manual';
  }
  return { attributes: next, meta: { ...(meta ?? {}), sources } };
}

/**
 * Merges a fresh extraction into the stored attributes. Manual values stay
 * unless `overwriteManual` (admin's "read again from the photo"); everything
 * else takes the extracted value, and an attribute the model left empty is
 * removed.
 */
export function mergeExtracted(
  attributes: ProductAttributes,
  meta: AttributesMeta | null,
  extracted: Partial<Record<AttributeKey, string | null>>,
  opts: { overwriteManual?: boolean } = {},
): { attributes: ProductAttributes; sources: Partial<Record<AttributeKey, AttributeSource>> } {
  const next: ProductAttributes = { ...attributes };
  const sources = { ...(meta?.sources ?? {}) };
  for (const key of ATTRIBUTE_KEYS) {
    if (sources[key] === 'manual' && !opts.overwriteManual) continue;
    const value = normalizeAttributeValue(key, extracted[key]);
    if (value) next[key] = value;
    else delete next[key];
    sources[key] = 'ai';
  }
  return { attributes: next, sources };
}

/**
 * What an extraction reads, hashed: a product whose title, category,
 * description or main photo changed is read again. Mirrors
 * `md5(concat_ws('|', title, category, description, image_url))` in SQL —
 * concat_ws skips NULLs, so this does too.
 */
export function attributesInputHash(input: {
  title: string;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
}): string {
  const parts = [input.title, input.category, input.description, input.imageUrl].filter(
    (v): v is string => v !== null && v !== undefined,
  );
  return createHash('md5').update(parts.join('|'), 'utf8').digest('hex');
}

/**
 * The look of a product in one line for the agent: «святкова, однотонний,
 * фактурна, кент, прямий». Colour only when the variants carry none — they're
 * the authority on colour when they have it.
 */
export function describeLook(attributes: ProductAttributes | null | undefined, opts: { withColour?: boolean } = {}): string | undefined {
  if (!attributes) return undefined;
  const parts = ATTRIBUTE_KEYS.filter((k) => k !== 'colour' || opts.withColour)
    .map((k) => attributes[k])
    .filter((v): v is string => !!v);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
