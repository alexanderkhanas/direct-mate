import { sameSize } from '../agent/catalog/catalog-format';
import { lowerTrim } from './normalize';

/**
 * Which products a size chart is for. A chart's scope is two lists, brands
 * and categories: an empty list means «all», so both empty is the whole
 * store. An `isDefault` chart (from before scopes) is whole-store too.
 *
 * Charts are few per store, so they are loaded and matched here in code
 * rather than in SQL: the counts on the admin screens and the agent's pick
 * then follow one rule.
 */

/** The parts of a chart a scope needs. Brands and categories are stored lower-case and trimmed. */
export interface ChartScope {
  brands: string[];
  categories: string[];
  isDefault: boolean;
  createdAt: Date;
  /** The chart read into a table (draft or ready); null for a picture only. */
  table?: { rows: Array<{ size: string }> } | null;
}

/** A product as a scope sees it: its brand and every category it is in. */
export interface ProductScope {
  brand: string | null;
  /** `products.category` and the `product_categories` names, as stored. */
  categories: string[];
  /** The sizes it is sold in, in stock or not. Missing or empty: unknown. */
  sizes?: string[];
}

/** How specific a chart is: brand + category 3, brand 2, category 1, whole store 0. */
export function chartLevel(chart: ChartScope): number {
  if (chart.isDefault) return 0;
  return (chart.brands.length > 0 ? 2 : 0) + (chart.categories.length > 0 ? 1 : 0);
}

/** Whether a chart's scope includes this product (case and spaces don't matter). */
export function chartCovers(chart: ChartScope, product: ProductScope): boolean {
  if (chart.isDefault) return true;
  const brand = product.brand ? lowerTrim(product.brand) : null;
  if (chart.brands.length > 0 && !(brand && chart.brands.includes(brand))) return false;
  if (chart.categories.length > 0 && !product.categories.some((c) => chart.categories.includes(lowerTrim(c)))) {
    return false;
  }
  return true;
}

/**
 * The chart for a product: the most specific one that covers it (brand +
 * category, then brand, then category, then whole store), the newest within
 * a level. A chart whose table has none of the product's sizes is skipped
 * for the next one that has them: «Брюки» in 42–58 and jeans 30–38 beside a
 * clothes chart in S–3XL that covers trousers too, for trousers sold in S–XL.
 * When no covering chart has them, the most specific one still answers (it
 * says the size systems differ). Null when none covers it.
 */
export function pickChart<T extends ChartScope>(charts: T[], product: ProductScope): T | null {
  const covering = charts
    .filter((chart) => chartCovers(chart, product))
    .sort((a, b) => chartLevel(b) - chartLevel(a) || b.createdAt.getTime() - a.createdAt.getTime());
  return covering.find((chart) => !otherSizeSystem(chart, product)) ?? covering[0] ?? null;
}

/** The chart's table names none of the sizes the product is sold in. A picture only, or unknown sizes: not known, so no. */
function otherSizeSystem(chart: ChartScope, product: ProductScope): boolean {
  const rows = chart.table?.rows ?? [];
  const sizes = product.sizes ?? [];
  if (rows.length === 0 || sizes.length === 0) return false;
  return !rows.some((row) => sizes.some((size) => sameSize(row.size, size)));
}
