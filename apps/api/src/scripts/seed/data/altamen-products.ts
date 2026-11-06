// Alta Men demo catalog loader — merged catalog: 128 products (56 multi-color
// groups + 72 singles), 1169 variants, scraped from altamen.com.ua
// (2026-07-31, see altamen/README.md for provenance and merge semantics).
//
// The site models one product per color; altamen-products-merged.json folds
// same-model color products into single products with color+size variants so
// the engine's variant flows (ask_variant_choice, ask_size_for_color, ...)
// work. Per-color SKU/URL/original-title mapping is preserved in the JSON's
// `colorSources` field (not needed for seeding, kept for traceability).
//
// Stock is a placeholder (5) — the site exposes per-size availability
// (rendered size = in stock) but not quantities.

import * as fs from 'fs';
import * as path from 'path';
import { ProductSpec } from './types';

interface AltamenMergedProduct {
  externalId: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  /** The site's own text (single-colour products). */
  originalDescription?: string;
  /** Multi-colour groups: one source page per colour. */
  colorSources?: Record<string, { sourceUrl: string }>;
  imageFile?: string;
  variants: Array<{
    color: string | null;
    size: string | null;
    price: number;
    stock: number;
    imageFile?: string;
  }>;
}

/**
 * Latin tokens that appear in the catalog under two spellings. Canonicalised so
 * one model doesn't present itself two ways — the customer types back what they
 * read, and `narrowByProductName` matches on it.
 */
const LATIN_CANONICAL: Record<string, string> = {
  santorini: 'Santorini',
  premium: 'Premium',
  prive: 'Prive',
};

/**
 * Clean a scraped product title for customer-facing display.
 *
 * Two problems, both from the source site:
 *
 * 1. It titles products «NAME - SKU». The scrape stripped the SKU and left the
 *    separator behind — 9 titles end in a bare ` -`, 7 in ` - 05.30.70.51`.
 *    The SKU is preserved in its own field, so nothing is lost by removing it
 *    here.
 * 2. 66 of 128 titles are ALL-CAPS, which reads as shouting inside a DM.
 *
 * Casing is **sentence case, derived from the catalog rather than chosen**:
 * every capitalized Cyrillic token across the 62 mixed-case titles is the first
 * word of its title, and «Трикотажний костюм тенор» keeps the model name
 * lowercase. So the store's own house style is sentence case and the ALL-CAPS
 * entries are the outliers — which is also why no proper-noun list is needed.
 *
 * Latin tokens keep their own casing (MOKKO, Reglan): they are brand and model
 * names, not Ukrainian words, and lowercasing them would be wrong. Mixed-case
 * titles pass through untouched — they already follow the house style, and
 * re-casing them could only do damage.
 */
export function normalizeProductTitle(
  raw: string,
  opts: { keepTrailingCode?: boolean } = {},
): string {
  // Trailing SKU remnant, then any leftover separator. Bounded to a token that
  // looks like a code (digits/dots, or the site's alphanumeric SKUs) so a title
  // legitimately ending in a word — «Сорочка-футболка» — is never truncated.
  //
  // `keepTrailingCode` is for the collision case: two products whose titles
  // differ ONLY by that code. Dropping it there would merge two real products
  // into one display name — see `getAltamenProducts`.
  let title = raw;
  if (!opts.keepTrailingCode) {
    title = title.replace(/\s*[-–]\s*[0-9][\w.]*\s*$/u, '');
  }
  title = title
    .replace(/\s*[-–]\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();

  const isAllCaps = title === title.toUpperCase() && /\p{Lu}/u.test(title);
  if (!isAllCaps) return title;

  let seenFirstCyrillic = false;
  title = title
    .split(' ')
    .map((token) => {
      // Latin token — a brand or model name, not a Ukrainian word.
      if (/^[A-Za-z][A-Za-z0-9&.-]*$/u.test(token)) {
        return LATIN_CANONICAL[token.toLowerCase()] ?? token;
      }
      const lower = token.toLowerCase();
      if (seenFirstCyrillic) return lower;
      seenFirstCyrillic = true;
      // `toUpperCase()` on the first letter, not a naive charAt — the catalog
      // uses both ʼ (U+02BC) and ' inside words («ВʼЯЗАНЕ»), and a leading
      // quote/paren would otherwise swallow the capital.
      return lower.replace(/\p{Ll}/u, (c) => c.toUpperCase());
    })
    .join(' ');

  return title;
}

/**
 * Alta Men's own description for each product, as on their site. The merged
 * JSON's `description` is a July rewrite (photo analysis) made when most of
 * the site's text looked generic; the demo now uses the store's own words —
 * what an OpenCart sync would deliver — and visual attributes read from the
 * photos fill in what generic text doesn't say.
 *
 * A multi-colour product has one source page per colour, sometimes with
 * different text. The most specific one wins: the text shared by the fewest
 * products (a per-category blurb is shared by up to 9).
 */
function originalDescriptions(raw: AltamenMergedProduct[]): Map<string, string> {
  const enrichedPath = path.join(__dirname, 'altamen', 'altamen-products-enriched.json');
  const enriched: Array<{ sourceUrl: string; originalDescription?: string }> = JSON.parse(
    fs.readFileSync(enrichedPath, 'utf-8'),
  );
  const byUrl = new Map(enriched.map((e) => [e.sourceUrl, e.originalDescription?.trim() ?? '']));

  const candidates = new Map<string, string[]>();
  for (const p of raw) {
    const texts = p.colorSources
      ? Object.values(p.colorSources).map((s) => byUrl.get(s.sourceUrl) ?? '')
      : [p.originalDescription?.trim() ?? ''];
    candidates.set(p.externalId, [...new Set(texts.filter(Boolean))]);
  }
  const sharedBy = new Map<string, number>();
  for (const texts of candidates.values()) for (const t of texts) sharedBy.set(t, (sharedBy.get(t) ?? 0) + 1);

  const chosen = new Map<string, string>();
  for (const [id, texts] of candidates) {
    const best = [...texts].sort((a, b) => sharedBy.get(a)! - sharedBy.get(b)!)[0];
    if (best) chosen.set(id, best);
  }
  return chosen;
}

export function getAltamenProducts(): ProductSpec[] {
  const jsonPath = path.join(__dirname, 'altamen', 'altamen-products-merged.json');
  const raw: AltamenMergedProduct[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const originals = originalDescriptions(raw);

  // Title collisions. «СОРОЧКА ЛЬОН У БЛАКИТНУ СМУЖКУ -» and
  // «СОРОЧКА ЛЬОН У БЛАКИТНУ СМУЖКУ - 1022404» are two different colourways
  // (Білий у блакитну смужку / Блакитний у білу смужку) that the merge step
  // kept separate — stripping the code makes them the same string. Two products
  // sharing a display title is worse than an ugly one: the customer can't tell
  // them apart, `narrowByProductName` can't either, and `titlesEqual` would
  // pair one product's name with the other's price. Keep the code on the
  // entries that need it, so only the colliding title carries the noise.
  const counts = new Map<string, number>();
  for (const p of raw) {
    const t = normalizeProductTitle(p.title).toLowerCase();
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const titleFor = (p: AltamenMergedProduct): string => {
    const plain = normalizeProductTitle(p.title);
    if ((counts.get(plain.toLowerCase()) ?? 0) <= 1) return plain;
    return normalizeProductTitle(p.title, { keepTrailingCode: true });
  };

  return raw.map((p) => {
    // Emit each color's imageFile on its FIRST variant only — seedProductMedia
    // inserts one color-tagged media row per variant override, and repeating
    // the file on every size of the color would duplicate rows.
    const seenColors = new Set<string>();
    return {
      externalId: p.externalId,
      title: titleFor(p),
      brand: p.brand,
      category: p.category,
      description: originals.get(p.externalId) ?? p.description,
      imageFile: p.imageFile,
      variants: p.variants.map((v) => {
        const key = v.color ?? '';
        const first = !seenColors.has(key);
        seenColors.add(key);
        return {
          color: v.color,
          size: v.size,
          price: v.price,
          stock: v.stock,
          imageFile: first ? v.imageFile : undefined,
        };
      }),
    };
  });
}
