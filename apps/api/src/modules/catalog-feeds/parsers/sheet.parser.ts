import type { ImportProductInput } from '../../catalog/catalog.service';
import { mergeImages, parsePrice, plainText, WarningLog, type ParsedFeed } from '../feed-normalize';
import { FeedError } from '../feed-fetcher';

/**
 * The Google Sheet template for shops without a website: one row per size
 * and colour, rows with the same «Товар» are one product. Read from the
 * sheet's CSV export. Headers are matched loosely (Ukrainian or English, any
 * case), so an owner who renames «Ціна» to «ціна, грн» still gets a catalog.
 */
const COLUMNS = {
  article: /^(артикул|sku|код|id)/i,
  title: /^(товар|назва|title|name)/i,
  category: /^(категорі|category)/i,
  color: /^(колір|color|цвет)/i,
  size: /^(розмір|size|размер)/i,
  salePrice: /^(ціна зі знижкою|ціна зі знижк|акційна ціна|sale)/i,
  price: /^(ціна|price|цена)/i,
  stock: /^(наявн|кількіст|залишок|stock|qty|quantity)/i,
  photos: /^(фото|photo|image|зображ)/i,
  description: /^(опис|description)/i,
} as const;

type Column = keyof typeof COLUMNS;

export function parseSheet(csv: string, warnings = new WarningLog()): Omit<ParsedFeed, 'format'> {
  const rows = parseCsv(csv).filter((r) => r.some((cell) => cell.trim()));
  if (rows.length < 2) return { products: [], warnings: warnings.list(), itemCount: 0 };

  const index = headerIndex(rows[0]);
  if (index.title === undefined || index.price === undefined) {
    // A coded error, so the admin can show how the sheet should look instead of a generic failure.
    throw new FeedError('unknown_format', 'The sheet needs at least the «Товар» and «Ціна» columns');
  }
  const cell = (row: string[], col: Column) => (index[col] !== undefined ? (row[index[col]!] ?? '').trim() : '');

  const groups = new Map<string, { title: string; article: string | null; rows: string[][] }>();
  let missingArticle = 0;
  for (const row of rows.slice(1)) {
    const title = cell(row, 'title');
    if (!title || !parsePrice(cell(row, 'price'))) {
      warnings.add('skipped_no_price', title || undefined);
      continue;
    }
    const article = cell(row, 'article') || null;
    if (!article) missingArticle++;
    const key = (article ?? title).toLowerCase();
    if (!groups.has(key)) groups.set(key, { title, article, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  if (missingArticle > 0) warnings.add('no_article', undefined, missingArticle);

  const products: ImportProductInput[] = [];
  for (const group of groups.values()) {
    const productId = group.article ?? slug(group.title);
    const images: Array<{ url: string; color: string | null }> = [];
    const variantIds = new Set<string>();
    const variants: ImportProductInput['variants'] = [];
    for (const row of group.rows) {
      const color = cell(row, 'color') || null;
      const size = cell(row, 'size') || null;
      const variantId = [productId, color ?? '', size ?? ''].join(':').toLowerCase();
      if (variantIds.has(variantId)) {
        warnings.add('duplicate_ids', `${group.title} ${color ?? ''} ${size ?? ''}`.trim());
        continue;
      }
      variantIds.add(variantId);
      const price = parsePrice(cell(row, 'price'))!;
      const sale = parsePrice(cell(row, 'salePrice'));
      for (const url of cell(row, 'photos').split(/[\s,;]+/).filter(Boolean)) images.push({ url, color });
      variants.push({
        externalVariantId: variantId,
        sku: group.article ?? undefined,
        size,
        color,
        price: price.amount,
        salePrice: sale && sale.amount < price.amount ? sale.amount : null,
        currency: price.currency ?? 'UAH',
        inventoryQty: stock(cell(row, 'stock')),
      });
    }
    const first = group.rows[0];
    const category = cell(first, 'category');
    products.push({
      externalProductId: productId,
      title: group.title,
      description: plainText(cell(first, 'description')),
      categories: category ? [category] : [],
      images: mergeImages(images),
      variants,
    });
  }
  return { products, warnings: warnings.list(), itemCount: rows.length - 1 };
}

/** «5» → 5; «так», «є», «+» or empty → in stock (1); «ні», «немає», «0» → 0. */
function stock(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (!value) return 1;
  const n = Number(value.replace(',', '.'));
  if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  return /^(ні|нема|немає|no|false|-|відсутн)/.test(value) ? 0 : 1;
}

function headerIndex(header: string[]): Partial<Record<Column, number>> {
  const index: Partial<Record<Column, number>> = {};
  header.forEach((name, i) => {
    const h = name.trim();
    // «Ціна зі знижкою» must not be read as «Ціна»: check the longer patterns first.
    for (const col of Object.keys(COLUMNS) as Column[]) {
      if (index[col] === undefined && COLUMNS[col].test(h)) {
        if (col === 'price' && COLUMNS.salePrice.test(h)) continue;
        index[col] = i;
        break;
      }
    }
  });
  return index;
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
