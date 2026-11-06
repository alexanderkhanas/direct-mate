import { colorsMatch, localizeColor } from '../../../common/color-i18n';
import { sortSizes } from '../../../common/format';
import { describeLook } from '../../catalog/attributes/product-attributes';
import { AgentProduct, AgentVariant } from '../catalog/catalog-reader.service';
import { normSize, sameSize } from '../catalog/catalog-format';

// What the read tools return to the model. Property names matter: the fact
// ledger (`turn-facts.ts`) collects prices, sizes, colours and titles from
// these keys, and the grounding guard accepts only what it collected.

export interface ColorStock {
  /** Display name, or null for a product without a colour axis. */
  color: string | null;
  inStock: boolean;
  inStockSizes: string[];
  outOfStockSizes: string[];
}

export interface ProductSummary {
  ref: string;
  title: string;
  category: string | null;
  currency: string;
  price: number;
  maxPrice?: number;
  regularPrice?: number;
  inStock: boolean;
  colorsInStock: string[];
  sizesInStock: string[];
}

/**
 * One product in a category listing: enough to choose from, nothing more. No
 * sizes — the model looks those up with get_product before quoting them.
 */
export interface CategoryCard {
  ref: string;
  title: string;
  price: number;
  maxPrice?: number;
  regularPrice?: number;
  colorsInStock: string[];
  /** «святкова, однотонний, фактурна, кент, прямий»; absent until read from the photo. */
  look?: string;
}

export interface ProductDetails extends ProductSummary {
  look?: string;
  brand?: string;
  material?: string;
  gender?: string;
  season?: string;
  model?: string;
  description?: string;
  stock: ColorStock[];
  /** Only when prices differ between variants. */
  variantPrices?: Array<{ color: string | null; size: string | null; price: number; regularPrice?: number }>;
}

const MAX_DESCRIPTION_CHARS = 500;

function inStock(v: AgentVariant): boolean {
  return v.available > 0;
}

function distinct<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((v): v is T => v != null && v !== ''))];
}

function pricing(product: AgentProduct) {
  const available = product.variants.filter(inStock);
  const priced = available.length > 0 ? available : product.variants;
  const prices = priced.map((v) => v.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cheapest = priced.find((v) => v.price === min);
  return {
    price: min,
    maxPrice: max !== min ? max : undefined,
    regularPrice: cheapest?.regularPrice ?? undefined,
    uniform: max === min,
  };
}

export function summarizeProduct(product: AgentProduct): ProductSummary {
  const available = product.variants.filter(inStock);
  const p = pricing(product);
  return {
    ref: product.ref,
    title: product.title,
    category: product.category,
    currency: product.variants[0]?.currency ?? 'UAH',
    price: p.price,
    ...(p.maxPrice !== undefined && { maxPrice: p.maxPrice }),
    ...(p.regularPrice !== undefined && { regularPrice: p.regularPrice }),
    inStock: available.length > 0,
    colorsInStock: distinct(available.map((v) => localizeColor(v.color))),
    sizesInStock: sortSizes(distinct(available.map((v) => v.size))),
  };
}

/** How a product looks; names the colour only when the variants carry none. */
function lookOf(product: AgentProduct, colorsInStock: string[]): string | undefined {
  return describeLook(product.attributes, { withColour: colorsInStock.length === 0 });
}

export function categoryCard(product: AgentProduct): CategoryCard {
  const s = summarizeProduct(product);
  const look = lookOf(product, s.colorsInStock);
  return {
    ref: s.ref,
    title: s.title,
    price: s.price,
    ...(s.maxPrice !== undefined && { maxPrice: s.maxPrice }),
    ...(s.regularPrice !== undefined && { regularPrice: s.regularPrice }),
    colorsInStock: s.colorsInStock,
    ...(look && { look }),
  };
}

export function describeProduct(product: AgentProduct): ProductDetails {
  const summary = summarizeProduct(product);
  const p = pricing(product);
  const look = lookOf(product, summary.colorsInStock);

  const groups = new Map<string, AgentVariant[]>();
  for (const v of product.variants) {
    const key = localizeColor(v.color);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }
  const stock: ColorStock[] = [...groups.entries()].map(([color, variants]) => ({
    color: color || null,
    inStock: variants.some(inStock),
    inStockSizes: sortSizes(distinct(variants.filter(inStock).map((v) => v.size))),
    outOfStockSizes: sortSizes(distinct(variants.filter((v) => !inStock(v)).map((v) => v.size))),
  }));

  const description = product.description?.trim();
  return {
    ...summary,
    ...(look && { look }),
    ...(product.brand && { brand: product.brand }),
    ...(product.material && { material: product.material }),
    ...(product.gender && { gender: product.gender }),
    ...(product.season && { season: product.season }),
    ...(product.modelName && { model: product.modelName }),
    ...(description && {
      description:
        description.length > MAX_DESCRIPTION_CHARS
          ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…`
          : description,
    }),
    stock,
    ...(!p.uniform && {
      variantPrices: product.variants.map((v) => ({
        color: localizeColor(v.color) || null,
        size: v.size,
        price: v.price,
        ...(v.regularPrice != null && { regularPrice: v.regularPrice }),
      })),
    }),
  };
}

/** Whether a product has the requested colour and/or size in stock. */
export function hasInStock(product: AgentProduct, color?: string, size?: string): boolean {
  return product.variants.some(
    (v) =>
      inStock(v) &&
      (!color || !v.color || colorsMatch(v.color, color)) &&
      (!size || sameSize(v.size, size)),
  );
}

export type VariantPick = { variant: AgentVariant } | { error: string };

/**
 * The one variant a customer means by product + colour + size. Asks for the
 * missing axis rather than guessing — the old engine's worst bugs came from
 * picking a variant the customer never chose.
 */
export function pickVariant(product: AgentProduct, color?: string, size?: string): VariantPick {
  let candidates = product.variants;
  const colors = distinct(product.variants.map((v) => localizeColor(v.color)));

  // A product without a colour axis carries its colour in the title.
  if (colors.length > 0) {
    if (color) {
      candidates = candidates.filter((v) => colorsMatch(v.color, color));
      if (candidates.length === 0) {
        return { error: `${product.title} has no colour "${color}". Colours: ${colors.join(', ')}.` };
      }
    } else if (colors.length > 1) {
      return { error: `Which colour of ${product.title}? Colours: ${colors.join(', ')}.` };
    }
  }

  const sizes = sortSizes(distinct(candidates.map((v) => v.size)));
  if (size) {
    candidates = candidates.filter((v) => sameSize(v.size, size));
    if (candidates.length === 0) {
      return {
        error: `${product.title}${color ? ` (${color})` : ''} has no size ${normSize(size)}. Sizes: ${sizes.join(', ')}.`,
      };
    }
  } else if (sizes.length > 1) {
    return { error: `Which size of ${product.title}? Sizes: ${sizes.join(', ')}.` };
  }

  if (candidates.length > 1) {
    return { error: `More than one variant of ${product.title} matches; name the colour and size.` };
  }
  return { variant: candidates[0] };
}
