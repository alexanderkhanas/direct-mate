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
}

/** A product as a scope sees it: its brand and every category it is in. */
export interface ProductScope {
  brand: string | null;
  /** `products.category` and the `product_categories` names, as stored. */
  categories: string[];
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
 * a level. Null when none covers it.
 */
export function pickChart<T extends ChartScope>(charts: T[], product: ProductScope): T | null {
  let best: T | null = null;
  for (const chart of charts) {
    if (!chartCovers(chart, product)) continue;
    if (
      !best ||
      chartLevel(chart) > chartLevel(best) ||
      (chartLevel(chart) === chartLevel(best) && chart.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = chart;
    }
  }
  return best;
}
