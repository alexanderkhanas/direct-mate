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
  imageFile?: string;
  variants: Array<{
    color: string | null;
    size: string | null;
    price: number;
    stock: number;
    imageFile?: string;
  }>;
}

export function getAltamenProducts(): ProductSpec[] {
  const jsonPath = path.join(__dirname, 'altamen', 'altamen-products-merged.json');
  const raw: AltamenMergedProduct[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  return raw.map((p) => {
    // Emit each color's imageFile on its FIRST variant only — seedProductMedia
    // inserts one color-tagged media row per variant override, and repeating
    // the file on every size of the color would duplicate rows.
    const seenColors = new Set<string>();
    return {
      externalId: p.externalId,
      title: p.title.trim(),
      brand: p.brand,
      category: p.category,
      description: p.description,
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
