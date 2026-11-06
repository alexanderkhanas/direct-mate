import { tool } from 'ai';
import { z } from 'zod';
import { colorsMatch, findColorWords } from '../../../common/color-i18n';
import { sortSizes } from '../../../common/format';
import { recommendSize } from '../../size-charts/recommend-size';
import { ATTRIBUTE_VALUES, ListedAttribute } from '../../catalog/attributes/product-attributes';
import { findSizes, normSize, sameSize } from '../catalog/catalog-format';
import type { AgentProduct } from '../catalog/catalog-reader.service';
import { categoryCard, describeProduct, hasInStock, summarizeProduct } from './product-shapes';
import type { StagedEffect } from '../agent.types';
import type { AgentToolDeps, ToolScope } from './tool-deps';
import type { AgentStoreSettings } from '../store-settings.service';

const MAX_IMAGES = 4;
/** Search results shown to the model. */
const SEARCH_SHOWN = 8;
/** Matches checked against a colour or size filter before showing SEARCH_SHOWN. */
const SEARCH_FILTER_POOL = 25;
/** Above this, browse_category asks for a filter instead of listing. */
export const MAX_CATEGORY_CARDS = 60;

export function searchProductsTool(deps: AgentToolDeps, scope: ToolScope) {
  return tool({
    description:
      "Find products by name or by specific words: a model the customer named, a material, a kind of item. " +
      'Returns the best 8 matches with price and the colours and sizes in stock now, and how many matched in ' +
      'total. Put a colour or size in color/size, not in query: they keep only products that have it in ' +
      'stock. For advice, an occasion or a style, use browse_category instead.',
    inputSchema: z.object({
      query: z.string().min(1).describe("Search words in Ukrainian, e.g. 'сорочка льон', 'кросівки шкіряні'."),
      category: z.string().optional().describe('A category exactly as written in the catalog headings.'),
      color: z.string().optional().describe('Colour the customer asked for, as they said it.'),
      size: z.string().optional().describe('Size the customer asked for, e.g. M, XL, 42.'),
    }),
    execute: async ({ query, category, color: givenColor, size: givenSize }) => {
      // Models often fold the colour or size into the query («сорочка льон
      // чорна»). They are filters on stock, not words to find in a title.
      const color = givenColor ?? findColorWords(query)[0]?.word;
      const size = givenSize ?? findSizes(query)[0];
      let text = query;
      for (const { word } of findColorWords(query)) text = text.replace(new RegExp(word, 'iu'), ' ');
      for (const s of findSizes(query)) text = text.replace(s, ' ');

      const { ids, total } = await deps.search.search(scope.tenantId, { text: text.trim() || query, category });
      const filtering = !!(color || size);
      const products = await deps.catalog.loadProducts(scope.tenantId, ids.slice(0, filtering ? SEARCH_FILTER_POOL : SEARCH_SHOWN));
      const matching = filtering ? products.filter((p) => hasInStock(p, color, size)) : products;
      const shown = matching.slice(0, SEARCH_SHOWN);

      const notes: string[] = [];
      if (filtering && matching.length < products.length) {
        notes.push(
          `Of the ${products.length} best matches, ${products.length - matching.length} don't have ` +
            `${[color, size].filter(Boolean).join(' / ')} in stock.`,
        );
      }
      if (total > shown.length) {
        notes.push(`${total} products match the words; these are the best ${shown.length}. To see a whole category, use browse_category.`);
      }
      return {
        query,
        found: total,
        shown: shown.length,
        results: shown.map(summarizeProduct),
        ...(notes.length > 0 && { note: notes.join(' ') }),
      };
    },
  });
}

function countBy(products: AgentProduct[], key: ListedAttribute): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of products) {
    const value = p.attributes[key] ?? 'не вказано';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export function browseCategoryTool(deps: AgentToolDeps, scope: ToolScope) {
  return tool({
    description:
      'List every in-stock product in one category with its price, colours in stock and look ' +
      '(formality, pattern, fabric, collar, fit). Use it for advice and open requests: "what do you ' +
      'recommend", an occasion (a wedding, the office, the sea), a style or a budget. Read the whole list and ' +
      'choose the 2–3 products that fit best. Sizes are not listed: call get_product before stating sizes or ' +
      'whether a size is in stock. The filters are optional; use them when the customer was specific.',
    inputSchema: z.object({
      category: z.string().describe('A category exactly as written in the catalog headings.'),
      formality: z.enum(ATTRIBUTE_VALUES.formality).optional(),
      pattern: z.enum(ATTRIBUTE_VALUES.pattern).optional(),
      fabricLook: z.enum(ATTRIBUTE_VALUES.fabricLook).optional(),
      collar: z.enum(ATTRIBUTE_VALUES.collar).optional(),
      fit: z.enum(ATTRIBUTE_VALUES.fit).optional(),
      color: z.string().optional().describe('Only products with this colour in stock.'),
      size: z.string().optional().describe('Only products with this size in stock.'),
      maxPrice: z.number().positive().optional().describe('Only products at or under this price.'),
    }),
    execute: async ({ category, color, size, maxPrice, ...look }) => {
      const categories = await deps.catalog.listCategories(scope.tenantId);
      const match = categories.find((c) => c.name.toLowerCase() === category.trim().toLowerCase());
      if (!match) {
        return { error: `No category "${category}". Categories: ${categories.map((c) => c.name).join(', ')}.` };
      }

      const all = await deps.catalog.loadCategory(scope.tenantId, match.name);
      const inStock = all.filter((p) => hasInStock(p));
      const wanted = (Object.entries(look) as Array<[ListedAttribute, string | undefined]>).filter(
        (e): e is [ListedAttribute, string] => !!e[1],
      );
      const products = inStock.filter(
        (p) =>
          wanted.every(([key, value]) => p.attributes[key] === value) &&
          (!(color || size) || hasInStock(p, color, size)) &&
          (maxPrice === undefined || summarizeProduct(p).price <= maxPrice),
      );
      const outOfStock = all.length - inStock.length;

      if (products.length > MAX_CATEGORY_CARDS) {
        return {
          category: match.name,
          total: products.length,
          note: `Too many to list. Call browse_category again with a filter that fits the request; these are the counts.`,
          byFormality: countBy(products, 'formality'),
          byPattern: countBy(products, 'pattern'),
          byFit: countBy(products, 'fit'),
        };
      }
      const withoutLook = products.filter((p) => !Object.keys(p.attributes).length).length;
      const notes = [
        products.length === 0 && inStock.length > 0 && 'Nothing in stock matches these filters; try fewer.',
        withoutLook > 0 &&
          `${withoutLook} product(s) have no look yet: judge them by the title, or call get_product for the description.`,
      ].filter(Boolean);
      return {
        category: match.name,
        currency: products[0]?.variants[0]?.currency ?? 'UAH',
        total: products.length,
        ...(outOfStock > 0 && { outOfStock }),
        products: products.map(categoryCard),
        ...(notes.length > 0 && { note: notes.join(' ') }),
      };
    },
  });
}

export function getProductTool(deps: AgentToolDeps, scope: ToolScope) {
  return tool({
    description:
      'Full details for one product: description, look, material, every colour with its sizes in and out of ' +
      'stock, and the price. Call it before you state a price, colour, size or availability, including for ' +
      'a product already discussed earlier, because stock changes.',
    inputSchema: z.object({
      productRef: z.string().describe('Ref from the catalog list or a search result.'),
    }),
    execute: async ({ productRef }) => {
      const resolved = await deps.catalog.resolveProductRef(scope.tenantId, productRef);
      if ('error' in resolved) return { error: resolved.error };
      const [product] = await deps.catalog.loadProducts(scope.tenantId, [resolved.id]);
      if (!product) return { error: 'This product has no active variants.' };
      return describeProduct(product);
    },
  });
}

export function getSizeHelpTool(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  return tool({
    description:
      "Recommend a size from the customer's height and weight using this store's size ranges, and say " +
      'whether a size chart image exists. Call it when the customer gives their height or weight or asks ' +
      'which size fits. Pass productRef when a product is being discussed: the answer then says whether the ' +
      'recommended size is in stock for it.',
    inputSchema: z.object({
      productRef: z.string().optional(),
      heightCm: z.number().int().min(80).max(230).optional(),
      weightKg: z.number().int().min(20).max(250).optional(),
    }),
    execute: async ({ productRef, heightCm, weightKg }) => {
      let product: AgentProduct | undefined;
      if (productRef) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, productRef);
        if ('error' in resolved) return { error: resolved.error };
        [product] = await deps.catalog.loadProducts(scope.tenantId, [resolved.id]);
      }

      const chart = settings.sizeChart;
      const recommended = chart && (heightCm || weightKg) ? recommendSize({ heightCm, weightKg }, chart) : null;
      const inStockSizes = product
        ? sortSizes([...new Set(product.variants.filter((v) => v.available > 0 && v.size).map((v) => v.size!))])
        : undefined;
      const chartImage = await deps.sizeCharts.resolveForContext(scope.tenantId, {
        brand: product?.brand,
        category: product?.category,
      });

      if (!chart && !chartImage) {
        return {
          available: false,
          note: 'This store has no size ranges or size chart. Do not guess a size; hand off if the customer needs one.',
        };
      }
      return {
        available: true,
        recommendedSize: recommended,
        ...(recommended && inStockSizes && {
          recommendedInStock: inStockSizes.some((s) => sameSize(s, recommended)),
        }),
        ...(inStockSizes && { inStockSizes }),
        ...(chart && {
          sizeRanges: Object.entries(chart).map(([size, r]) => ({
            size: normSize(size),
            heightCm: `${r.heightMin}–${r.heightMax}`,
            weightKg: `${r.weightMin}–${r.weightMax}`,
          })),
        }),
        sizeChartImage: !!chartImage,
        ...(!recommended && chart && !(heightCm || weightKg) && {
          note: 'Ask for height and weight to recommend a size.',
        }),
      };
    },
  });
}

export function sendSizeChartTool(deps: AgentToolDeps, scope: ToolScope) {
  return tool({
    description:
      'Send the size chart image with your reply. Use it when the customer asks for a size chart or wants ' +
      'to check measurements themselves. Pass productRef when a product is being discussed so the right ' +
      'chart is chosen.',
    inputSchema: z.object({ productRef: z.string().optional() }),
    execute: async ({ productRef }) => {
      let context: { brand?: string | null; category?: string | null } = {};
      if (productRef) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, productRef);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        context = await deps.sizeCharts.getBrandAndCategoryForProduct(scope.tenantId, resolved.id);
      }
      const chart = await deps.sizeCharts.resolveForContext(scope.tenantId, context);
      if (!chart) return { ok: false, error: 'This store has no size chart image.' };
      const staged: StagedEffect = {
        type: 'send_size_chart',
        imageUrl: deps.sizeCharts.publicUrl(chart.imagePath),
        name: chart.name,
      };
      return { ok: true, staged, note: 'The size chart image is sent with your reply.' };
    },
  });
}

export function showProductsTool(deps: AgentToolDeps, scope: ToolScope) {
  return tool({
    description:
      'Send product photos with your reply, up to 4. Use it when the customer wants to see an item or when ' +
      'you suggest specific products. Pass color to show that colour where a photo of it exists.',
    inputSchema: z.object({
      productRefs: z.array(z.string()).min(1).max(MAX_IMAGES),
      color: z.string().optional(),
    }),
    execute: async ({ productRefs, color }) => {
      const ids: string[] = [];
      const errors: string[] = [];
      for (const ref of productRefs) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, ref);
        if ('error' in resolved) errors.push(resolved.error);
        else ids.push(resolved.id);
      }
      const products = await deps.catalog.loadProducts(scope.tenantId, ids);
      const images = products
        .map((p) => {
          const colored = color ? p.variants.find((v) => v.imageUrl && colorsMatch(v.color, color)) : undefined;
          const url = colored?.imageUrl ?? p.imageUrl;
          return url ? { productId: p.id, url } : null;
        })
        .filter((i): i is { productId: string; url: string } => i !== null)
        .slice(0, MAX_IMAGES);

      if (images.length === 0) {
        return { ok: false, error: errors[0] ?? 'These products have no photos.' };
      }
      const staged: StagedEffect = { type: 'show_products', images };
      return {
        ok: true,
        staged,
        note: `${images.length} photo(s) are sent with your reply.`,
        ...(errors.length > 0 && { skipped: errors }),
      };
    },
  });
}
