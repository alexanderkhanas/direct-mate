import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { localizeColor } from '../../../common/color-i18n';
import { effectivePrice } from '../../../common/pricing';
import { productRef } from './catalog-reader.service';
import { money } from './catalog-format';

const TTL_MS = 5 * 60 * 1000;
const MAX_COLORS_PER_LINE = 6;

export interface CatalogIndexRow {
  product_id: string;
  title: string;
  category: string | null;
  color: string | null;
  price: string;
  sale_price: string | null;
  currency: string;
  available: string;
}

/**
 * The compact catalog the agent keeps in its system prompt: one line per
 * product with its ref, title, price and the colours in stock, grouped by
 * category. A typical store (20–300 products) fits, which is why there is no
 * vector search yet (decisions doc, Decision 4).
 *
 * It is for orientation only. The prompt tells the model to quote prices,
 * sizes and stock from a tool called in the same turn, and the grounding
 * guard checks exactly that — so a cached index can't leak stale stock into a
 * reply. Sizes are left out for the same reason.
 */
export type CatalogPromptMode = 'list' | 'overview';

export interface CatalogIndex {
  text: string;
  /** Categories with product counts and price ranges, for `overview` mode: the same size at any catalog size. */
  overview: string;
  /** Every product title; the grounding guard treats names as names, not claims. */
  titles: string[];
}

@Injectable()
export class CatalogIndexService {
  private readonly cache = new Map<string, { index: CatalogIndex; expiresAt: number }>();

  constructor(private readonly dataSource: DataSource) {}

  async get(tenantId: string): Promise<CatalogIndex> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.index;

    const rows: CatalogIndexRow[] = await this.dataSource.query(
      `SELECT p.id AS product_id, p.title, p.category, v.color, v.price, v.sale_price, v.currency,
              (SELECT COALESCE(SUM(sb.available_qty - sb.reserved_qty - sb.pending_checkout_qty), 0)
                 FROM stock_balances sb WHERE sb.variant_id = v.id) AS available
         FROM products p
         JOIN product_variants v ON v.product_id = p.id AND v.active = true
        WHERE p.tenant_id = $1 AND p.status = 'active'
        ORDER BY p.category NULLS LAST, p.title, p.id`,
      [tenantId],
    );
    const index = {
      text: formatCatalogIndex(rows),
      overview: formatCatalogOverview(rows),
      titles: [...new Set(rows.map((r) => r.title))],
    };
    this.cache.set(tenantId, { index, expiresAt: Date.now() + TTL_MS });
    return index;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}

/** «Сорочки — 21 товар, 2900–4500 грн (3 немає в наявності)», one line per category. */
export function formatCatalogOverview(rows: CatalogIndexRow[]): string {
  const categories = new Map<string, { products: Map<string, boolean>; prices: number[]; currency: string }>();
  for (const r of rows) {
    const name = r.category?.trim() || 'Інше';
    if (!categories.has(name)) categories.set(name, { products: new Map(), prices: [], currency: r.currency });
    const c = categories.get(name)!;
    const inStock = Number(r.available) > 0;
    c.products.set(r.product_id, (c.products.get(r.product_id) ?? false) || inStock);
    if (inStock) c.prices.push(effectivePrice(Number(r.price), r.sale_price != null ? Number(r.sale_price) : null));
  }
  if (categories.size === 0) return '(the catalog is empty)';
  return [...categories.entries()]
    .map(([name, c]) => {
      const total = c.products.size;
      const sold = [...c.products.values()].filter((v) => !v).length;
      const min = Math.min(...c.prices);
      const max = Math.max(...c.prices);
      const price = c.prices.length === 0 ? '' : min === max ? `, ${money(min, c.currency)}` : `, ${money(min, c.currency)}–${money(max, c.currency)}`;
      return `- ${name}: ${total} ${productsWord(total)}${price}${sold > 0 ? ` (${sold} немає в наявності)` : ''}`;
    })
    .join('\n');
}

function productsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'товар';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'товари';
  return 'товарів';
}

export function formatCatalogIndex(rows: CatalogIndexRow[]): string {
  const products = new Map<
    string,
    { title: string; category: string; currency: string; variants: Array<{ color: string | null; price: number; available: number }> }
  >();
  for (const r of rows) {
    if (!products.has(r.product_id)) {
      products.set(r.product_id, {
        title: r.title,
        category: r.category?.trim() || 'Інше',
        currency: r.currency,
        variants: [],
      });
    }
    products.get(r.product_id)!.variants.push({
      color: r.color,
      price: effectivePrice(Number(r.price), r.sale_price != null ? Number(r.sale_price) : null),
      available: Number(r.available),
    });
  }
  if (products.size === 0) return '(the catalog is empty)';

  const byCategory = new Map<string, string[]>();
  for (const [id, p] of products) {
    const inStock = p.variants.filter((v) => v.available > 0);
    const priced = inStock.length > 0 ? inStock : p.variants;
    const min = Math.min(...priced.map((v) => v.price));
    const max = Math.max(...priced.map((v) => v.price));
    const parts = [productRef(id), p.title, min === max ? money(min, p.currency) : `від ${money(min, p.currency)}`];

    if (inStock.length === 0) {
      parts.push('немає в наявності');
    } else {
      const colors = [...new Set(inStock.map((v) => localizeColor(v.color)).filter(Boolean))];
      if (colors.length > 0) {
        const shown = colors.slice(0, MAX_COLORS_PER_LINE).join(', ');
        const more = colors.length - MAX_COLORS_PER_LINE;
        parts.push(more > 0 ? `${shown} та ще ${more}` : shown);
      }
    }
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(parts.join(' · '));
  }

  return [...byCategory.entries()]
    .map(([category, lines]) => `## ${category}\n${lines.join('\n')}`)
    .join('\n\n');
}
