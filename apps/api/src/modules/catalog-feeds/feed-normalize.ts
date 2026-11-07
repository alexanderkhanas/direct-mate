import { findColorWords } from '../../common/color-i18n';
import { findSizes } from '../agent/catalog/catalog-format';
import type { ImportProductInput } from '../catalog/catalog.service';

export type FeedFormat = 'gmc' | 'yml' | 'sheet';

/** Shown to the owner in the preview and after each sync; the admin turns codes into words. */
export type FeedWarningCode =
  | 'no_group_id' // variants grouped by title because the feed has no group id
  | 'no_sizes' // products with no size on any variant
  | 'no_photos'
  | 'skipped_no_price' // items without a usable price or title, left out
  | 'duplicate_ids' // the same item id twice; the later one kept
  | 'duplicate_barcodes' // a barcode on more than one variant; dropped from all of them
  | 'no_article' // sheet rows without «Артикул»: renaming a product re-creates it
  | 'over_limit' // more products than the plan allows; the rest left out
  | 'partial_feed'; // far fewer products than last time; nothing archived this run

export interface FeedWarning {
  code: FeedWarningCode;
  count: number;
  /** A few titles or ids, so the owner can find them. */
  examples?: string[];
}

export interface ParsedFeed {
  format: FeedFormat;
  products: ImportProductInput[];
  warnings: FeedWarning[];
  /** Items or rows read, before grouping. */
  itemCount: number;
}

/** Every id a feed writes is prefixed, so archiving and stock zeroing stay inside the feed's own products. */
export const FEED_ID_PREFIX = 'feed:';

/** Collects warnings while parsing. */
export class WarningLog {
  private readonly byCode = new Map<FeedWarningCode, { count: number; examples: string[] }>();

  add(code: FeedWarningCode, example?: string, count = 1): void {
    const entry = this.byCode.get(code) ?? { count: 0, examples: [] };
    entry.count += count;
    if (example && entry.examples.length < 5 && !entry.examples.includes(example)) entry.examples.push(example);
    this.byCode.set(code, entry);
  }

  list(): FeedWarning[] {
    return [...this.byCode.entries()].map(([code, e]) => ({
      code,
      count: e.count,
      ...(e.examples.length > 0 && { examples: e.examples }),
    }));
  }
}

/** «1299.00 UAH», «1 299,50 грн», «1299» → amount and currency. */
export function parsePrice(raw: unknown): { amount: number; currency: string | null } | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const currency = text.match(/\b([A-Z]{3})\b/)?.[1] ?? (/грн|₴/i.test(text) ? 'UAH' : null);
  const digits = text.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  // «1.299,50» / «1,299.50» / «1299,50»: the last separator with 1–2 digits after it is the decimal one.
  const decimal = digits.match(/[.,](\d{1,2})$/);
  const whole = (decimal ? digits.slice(0, -decimal[0].length) : digits).replace(/[.,]/g, '');
  const amount = Number(`${whole}${decimal ? `.${decimal[1]}` : ''}`);
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–' };

/** Feed descriptions are often HTML; the catalog stores plain text. */
export function plainText(raw: unknown, max = 5000): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .replace(/<(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text ? text.slice(0, max) : null;
}

/** A colour named in the title, for feeds that don't send one. */
export function colorFromTitle(title: string): string | null {
  const word = findColorWords(title)[0]?.color;
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : null;
}

/** A size named in the title («… L», «… 48»), for feeds that don't send one. */
export function sizeFromTitle(title: string): string | null {
  const sizes = findSizes(title);
  if (sizes.length > 0) return sizes[sizes.length - 1];
  return title.match(/(?:^|\s)(\d{2})$/)?.[1] ?? null;
}

/** The product's name from its variants' titles: the words they share, or the first title without colour and size. */
export function groupTitle(titles: string[]): string {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return withoutVariantWords(clean[0]);
  const split = clean.map((t) => t.split(/\s+/));
  const shared: string[] = [];
  for (let i = 0; i < split[0].length; i++) {
    const word = split[0][i];
    if (split.every((words) => words[i]?.toLowerCase() === word.toLowerCase())) shared.push(word);
    else break;
  }
  const prefix = shared.join(' ').replace(/[\s,–—-]+$/, '');
  return prefix.length >= 3 ? prefix : withoutVariantWords(clean[0]);
}

function withoutVariantWords(title: string): string {
  const size = sizeFromTitle(title);
  let out = size ? title.replace(new RegExp(`[\\s,(/-]*${size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)?\\s*$`), '') : title;
  const color = findColorWords(out).pop()?.word;
  if (color) out = out.replace(new RegExp(`[\\s,(/-]*${color}\\)?\\s*$`, 'i'), '');
  return out.trim() || title.trim();
}

/** Prefix ids, drop barcodes shared by several variants, stop at the plan's product limit. */
export function finishProducts(
  products: ImportProductInput[],
  warnings: WarningLog,
  opts: { maxProducts: number | null },
): ImportProductInput[] {
  const barcodeCount = new Map<string, number>();
  for (const p of products) {
    for (const v of p.variants) if (v.barcode) barcodeCount.set(v.barcode, (barcodeCount.get(v.barcode) ?? 0) + 1);
  }
  let out = products.map((p) => ({
    ...p,
    externalProductId: `${FEED_ID_PREFIX}${p.externalProductId}`,
    variants: p.variants.map((v) => {
      const shared = v.barcode && (barcodeCount.get(v.barcode) ?? 0) > 1;
      if (shared) warnings.add('duplicate_barcodes', p.title);
      return {
        ...v,
        externalVariantId: `${FEED_ID_PREFIX}${v.externalVariantId}`,
        barcode: shared ? null : (v.barcode ?? null),
      };
    }),
  }));
  for (const p of out) {
    if (p.variants.length > 0 && !p.variants.some((v) => v.size)) warnings.add('no_sizes', p.title);
    if ((p.images ?? []).length === 0) warnings.add('no_photos', p.title);
  }
  if (opts.maxProducts !== null && out.length > opts.maxProducts) {
    warnings.add('over_limit', undefined, out.length - opts.maxProducts);
    out = out.slice(0, opts.maxProducts);
  }
  return out;
}

/** Images with the colour they show; one URL keeps the first colour it was seen with, or none if colours disagree. */
export function mergeImages(images: Array<{ url: string; color: string | null }>): ImportProductInput['images'] {
  const byUrl = new Map<string, { url: string; color: string | null; mixed: boolean }>();
  for (const img of images) {
    const url = img.url.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const seen = byUrl.get(url);
    if (!seen) byUrl.set(url, { url, color: img.color, mixed: false });
    else if (seen.color !== img.color) seen.mixed = true;
  }
  return [...byUrl.values()].map((img, i) => ({
    url: img.url,
    ...(img.color && !img.mixed && { color: img.color }),
    sortOrder: i,
  }));
}
