import { tool } from 'ai';
import { z } from 'zod';
import { colorsMatch, findColorWords } from '../../../common/color-i18n';
import { sortSizes } from '../../../common/format';
import { recommendSize } from '../../size-charts/recommend-size';
import { formatRange, matchSize, type GivenMeasurements } from '../../size-charts/chart-match';
import type { SizeChartTable } from '../../size-charts/size-chart-table';
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

/** Measurements the customer gave, as get_size_help takes them: cm, weight in kg. */
const measurementsInput = z.object({
  chest: z.number().min(40).max(200).optional().describe('Chest or bust girth.'),
  waist: z.number().min(30).max(200).optional().describe('Waist girth.'),
  hips: z.number().min(40).max(200).optional().describe('Hip girth.'),
  height: z.number().min(50).max(230).optional(),
  weight: z.number().min(3).max(250).optional().describe('Body weight in kg.'),
  inseam: z.number().min(20).max(130).optional().describe('Inside leg length.'),
  foot: z.number().min(8).max(40).optional().describe('Foot length.'),
});

export function getSizeHelpTool(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  return tool({
    description:
      "Which size fits, from the product's size chart. Call it with the product when the customer asks which " +
      'size fits or gives measurements. Without measurements it lists the ones to ask for (the chart decides: ' +
      'chest, waist, hips… or height and weight). Call it again with the numbers the customer gave and recommend ' +
      'the size it returns. It also says whether that size is in stock and whether a size chart picture can be sent.',
    inputSchema: z.object({
      productRef: z.string().optional(),
      measurements: measurementsInput
        .optional()
        .describe("The customer's measurements in cm (weight in kg), only the ones they gave."),
      heightCm: z.number().int().min(80).max(230).optional(),
      weightKg: z.number().int().min(20).max(250).optional(),
    }),
    execute: async ({ productRef, measurements, heightCm, weightKg }) => {
      let product: AgentProduct | undefined;
      if (productRef) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, productRef);
        if ('error' in resolved) return { error: resolved.error };
        [product] = await deps.catalog.loadProducts(scope.tenantId, [resolved.id]);
      }

      const chart = settings.sizeChart;
      const inStockSizes = product
        ? sortSizes([...new Set(product.variants.filter((v) => v.available > 0 && v.size).map((v) => v.size!))])
        : undefined;
      // The product's own chart: the most specific one covering it. Only a checked one gives the size (a
      // broader checked chart never stands in for it); any chart can be sent as a picture.
      const picked = await deps.sizeCharts.resolveForContext(scope.tenantId, product ? { productId: product.id } : {});
      const sizeChartImage = !!picked?.sendImage;

      if (picked?.status === 'ready' && picked.table?.measurements.some((m) => m.key !== 'other')) {
        const given: GivenMeasurements = {
          ...(heightCm ? { height: heightCm } : {}),
          ...(weightKg ? { weight: weightKg } : {}),
          ...measurements,
        };
        return { source: 'chart' as const, ...chartAnswer(picked.name, picked.table, given, product, inStockSizes, sizeChartImage) };
      }
      // For the trace: why the product's chart gave no size.
      const unread =
        picked && picked.status !== 'ready'
          ? {
              chartReason: `The size chart «${picked.name}» for this product is ${
                picked.status === 'draft' ? 'read but not checked by the store yet' : 'a picture only, not read yet'
              }, so it gives no size.`,
            }
          : {};

      if (!product && !chart && (await deps.sizeCharts.listForTenant(scope.tenantId)).some((c) => c.status === 'ready')) {
        return {
          source: 'none' as const,
          available: false,
          sizeChartImage,
          note: "This store's size charts depend on the product: ask which item the customer means, then call get_size_help with its productRef.",
        };
      }

      // Ranges in S–3XL say nothing about trousers in 48–58 or jeans in 30–38,
      // and letter-to-number conversions differ between brands. The answer is
      // the size the customer wears in this product's own system.
      if (chart && product && !product.variants.some((v) => Object.keys(chart).some((s) => sameSize(s, v.size)))) {
        return {
          source: 'ranges' as const,
          ...unread,
          available: false,
          ...(inStockSizes && { inStockSizes }),
          sizeChartImage,
          note:
            "The store's height and weight ranges don't cover this product's sizes, so there is no recommendation. " +
            "Don't ask for height and weight and don't convert a letter size into these. Ask which of the sizes in " +
            'stock the customer usually wears' +
            (sizeChartImage ? ', and offer the size chart if they are not sure' : '') +
            '. If they still can\'t tell, hand off with what they told you.',
        };
      }

      const recommended = chart && (heightCm || weightKg) ? recommendSize({ heightCm, weightKg }, chart) : null;
      if (!chart && !sizeChartImage) {
        return {
          source: 'none' as const,
          ...unread,
          available: false,
          note: 'This store has no size ranges or size chart. Do not guess a size; hand off if the customer needs one.',
        };
      }
      return {
        source: chart ? ('ranges' as const) : ('none' as const),
        ...unread,
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
        sizeChartImage,
        ...(!recommended && chart && !(heightCm || weightKg) && {
          note: 'Ask for height and weight to recommend a size.',
        }),
      };
    },
  });
}

/**
 * get_size_help from a chart the owner checked: without the chart's
 * measurements, what to ask and the chart itself; with them, the size
 * (`chart-match.ts`), whether it's in stock, and what to say about a split
 * or a measurement outside the size.
 */
function chartAnswer(
  name: string,
  table: SizeChartTable,
  given: GivenMeasurements,
  product: AgentProduct | undefined,
  inStockSizes: string[] | undefined,
  sizeChartImage: boolean,
) {
  const stock = inStockSizes ? { inStockSizes } : {};
  const askFor = table.measurements
    .filter((m) => m.key !== 'other')
    .map((m) => ({ measurement: m.key, label: m.label, unit: m.unit }));
  const labels = (keys: string[]) =>
    keys.map((k) => table.measurements.find((m) => m.key === k)?.label ?? k).join(', ');

  // A chart in 42–58 scoped onto a product sold in S–XL can't name its size.
  const productSizes = product?.variants.map((v) => v.size).filter((s): s is string => !!s) ?? [];
  if (productSizes.length > 0 && !productSizes.some((s) => table.rows.some((r) => sameSize(r.size, s)))) {
    return {
      available: false,
      ...stock,
      sizeChartImage,
      note:
        "This product's size chart is in a different size system, so there is no recommendation. Ask which of the " +
        'sizes in stock the customer usually wears' +
        (sizeChartImage ? ', and offer the size chart if they are not sure' : '') +
        ". If they still can't tell, hand off with what they told you.",
    };
  }

  const match = matchSize(table, given);
  if (match.kind === 'none') {
    const unused = Object.keys(given).filter((k) => !askFor.some((a) => a.measurement === k));
    return {
      available: true,
      chart: { name, askFor },
      sizes: table.rows.map((r) => ({
        size: r.size,
        ...Object.fromEntries(
          table.measurements.flatMap((m) => {
            const range = r.values[m.key];
            return range ? [[m.key, formatRange(range)]] : [];
          }),
        ),
      })),
      ...stock,
      sizeChartImage,
      note:
        (unused.length > 0 ? `This chart doesn't use ${unused.join(' or ')}. ` : '') +
        `Ask the customer for exactly these measurements, in cm (weight in kg): ${labels(askFor.map((a) => a.measurement))}. ` +
        'Then call get_size_help again with them.',
    };
  }
  if (match.kind === 'out_of_range') {
    return {
      available: true,
      chart: { name },
      recommendedSize: null,
      ...stock,
      sizeChartImage,
      note: "These measurements are outside this product's size chart. Don't name a size: say so kindly and offer to ask a manager.",
    };
  }

  const size = match.size;
  const inStock = inStockSizes?.some((s) => sameSize(s, size));
  const missing = askFor.map((a) => a.measurement).filter((k) => !match.matchedOn.includes(k));
  const notes = [
    match.between && `The measurements are between ${match.between[0]} and ${match.between[1]}: offer both, or ${size} for a looser fit.`,
    ...match.outside.map((o) => `${labels([o.key])} ${o.value} is outside ${size} (${formatRange(o.range)}).`),
    missing.length > 0 && `Based on ${labels(match.matchedOn)} only; ${labels(missing)} would make it surer.`,
    inStock === false && `${size} is out of stock for this product.`,
  ].filter(Boolean);
  return {
    available: true,
    chart: { name },
    recommendedSize: size,
    ...(match.between && { between: match.between }),
    ...(inStock !== undefined && { recommendedInStock: inStock }),
    ...stock,
    sizeChartImage,
    ...(notes.length > 0 && { note: notes.join(' ') }),
  };
}

export function sendSizeChartTool(deps: AgentToolDeps, scope: ToolScope) {
  return tool({
    description:
      'Send the size chart image with your reply. Use it when the customer asks for a size chart or wants ' +
      'to check measurements themselves. Pass productRef when a product is being discussed so the right ' +
      'chart is chosen.',
    inputSchema: z.object({ productRef: z.string().optional() }),
    execute: async ({ productRef }) => {
      let context: { productId?: string } = {};
      if (productRef) {
        const resolved = await deps.catalog.resolveProductRef(scope.tenantId, productRef);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        context = { productId: resolved.id };
      }
      const chart = await deps.sizeCharts.resolveForContext(scope.tenantId, context);
      if (!chart) return { ok: false, error: 'This store has no size chart image.' };
      if (!chart.sendImage) {
        return { ok: false, note: "This store doesn't send its size chart as a picture. Don't say you're sending one." };
      }
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
