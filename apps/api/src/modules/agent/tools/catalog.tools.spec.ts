import { browseCategoryTool, getSizeHelpTool, MAX_CATEGORY_CARDS, searchProductsTool, sendSizeChartTool } from './catalog.tools';
import { DRESS_TABLE, TROUSERS_TABLE } from '../../size-charts/__fixtures__/tables';
import type { SizeChart } from '../../size-charts/size-chart.entity';
import type { AgentProduct } from '../catalog/catalog-reader.service';
import type { AgentStoreSettings } from '../store-settings.service';
import type { AgentToolDeps, ToolScope } from './tool-deps';

const SCOPE: ToolScope = { tenantId: 't1', conversationId: 'c1', customerId: 'u1' };
const CALL = { toolCallId: 'call-1', messages: [] } as never;

const product = (
  ref: string,
  title: string,
  attributes: AgentProduct['attributes'],
  variants: Array<[color: string, size: string, available: number]>,
  price = 3300,
): AgentProduct => ({
  id: `${ref}-0000-0000-0000-000000000000`,
  ref,
  title,
  category: 'Сорочки',
  brand: null,
  material: null,
  gender: null,
  season: null,
  modelName: null,
  description: null,
  imageUrl: null,
  attributes,
  variants: variants.map(([color, size, available], i) => ({
    id: `${ref}-v${i}`,
    color,
    size,
    price,
    regularPrice: null,
    currency: 'UAH',
    available,
    imageUrl: null,
  })),
});

const PREMIUM = product('aaaaaaaa', 'Сорочка льон Premium', { formality: 'святкова', pattern: 'однотонний' }, [
  ['Білий', 'L', 2],
  ['Хакі', 'M', 1],
], 4500);
const CHECK = product('bbbbbbbb', 'Сорочка в клітинку', { formality: 'повсякденна', pattern: 'клітинка' }, [['Синій', 'L', 3]], 3100);
const SOLD_OUT = product('cccccccc', 'Сорочка оранж', { formality: 'смарт-кежуал' }, [['Оранжевий', 'M', 0]]);

function deps(category: AgentProduct[], searchIds: string[] = []): AgentToolDeps {
  return {
    catalog: {
      listCategories: async () => [
        { name: 'Сорочки', products: category.length },
        { name: 'Брюки', products: 4 },
      ],
      loadCategory: async () => category,
      loadProducts: async (_t: string, ids: string[]) => category.filter((p) => ids.includes(p.id)),
    },
    search: { search: async () => ({ ids: searchIds, total: searchIds.length + 13 }) },
  } as unknown as AgentToolDeps;
}

const browse = (d: AgentToolDeps, input: Record<string, unknown>) =>
  browseCategoryTool(d, SCOPE).execute!(input as never, CALL) as unknown as Promise<Record<string, unknown>>;

describe('browse_category', () => {
  it('lists every in-stock product with price, colours and look, and counts the rest', async () => {
    const out = await browse(deps([PREMIUM, CHECK, SOLD_OUT]), { category: 'сорочки' });
    expect(out).toMatchObject({ category: 'Сорочки', total: 2, outOfStock: 1 });
    expect(out.products).toEqual([
      { ref: 'aaaaaaaa', title: 'Сорочка льон Premium', price: 4500, colorsInStock: ['Білий', 'Хакі'], look: 'святкова, однотонний' },
      { ref: 'bbbbbbbb', title: 'Сорочка в клітинку', price: 3100, colorsInStock: ['Синій'], look: 'повсякденна, клітинка' },
    ]);
  });

  it('filters by look, colour, size and price', async () => {
    const d = deps([PREMIUM, CHECK]);
    expect(((await browse(d, { category: 'Сорочки', formality: 'святкова' })).products as unknown[]).length).toBe(1);
    expect(((await browse(d, { category: 'Сорочки', color: 'біла', size: 'L' })).products as unknown[]).length).toBe(1);
    expect(((await browse(d, { category: 'Сорочки', maxPrice: 3500 })).products as Array<{ ref: string }>)[0].ref).toBe(
      'bbbbbbbb',
    );
  });

  it('names the categories when asked for one that does not exist', async () => {
    expect(await browse(deps([PREMIUM]), { category: 'Худі' })).toEqual({
      error: 'No category "Худі". Categories: Сорочки, Брюки.',
    });
  });

  it('asks for a filter instead of listing a huge category', async () => {
    const many = Array.from({ length: MAX_CATEGORY_CARDS + 1 }, (_, i) =>
      product(`${String(i).padStart(8, '0')}`, `Сорочка ${i}`, { formality: i % 2 ? 'святкова' : 'повсякденна' }, [
        ['Білий', 'L', 1],
      ]),
    );
    const out = await browse(deps(many), { category: 'Сорочки' });
    expect(out.products).toBeUndefined();
    expect(out.byFormality).toEqual({ святкова: 30, повсякденна: 31 });
  });
});

describe('get_size_help', () => {
  const RANGES = {
    M: { heightMin: 170, heightMax: 180, weightMin: 65, weightMax: 80 },
    L: { heightMin: 175, heightMax: 185, weightMin: 75, weightMax: 90 },
  };
  const LINEN_TROUSERS = product('dddddddd', 'Брюки льон', {}, [
    ['Темно-синій', '48', 2],
    ['Темно-синій', '50', 1],
    ['Бежевий', '52', 3],
    ['Бежевий', '54', 0],
  ]);
  const sizeHelp = (p: AgentProduct, input: Record<string, unknown>) => {
    const d = {
      ...deps([p]),
      sizeCharts: { resolveForContext: async () => null },
    } as unknown as AgentToolDeps;
    (d.catalog as unknown as Record<string, unknown>).resolveProductRef = async () => ({ id: p.id });
    const settings = { sizeChart: RANGES } as unknown as AgentStoreSettings;
    return getSizeHelpTool(d, SCOPE, settings).execute!({ productRef: p.ref, ...input } as never, CALL) as unknown as Promise<
      Record<string, unknown>
    >;
  };

  it('recommends from the ranges for a product in letter sizes', async () => {
    expect(await sizeHelp(PREMIUM, { heightCm: 182, weightKg: 85 })).toMatchObject({
      available: true,
      recommendedSize: 'L',
      recommendedInStock: true,
    });
  });

  it("asks for the customer's own size, not their measurements, when the ranges don't cover the product", async () => {
    for (const input of [{}, { heightCm: 180, weightKg: 75 }]) {
      const out = await sizeHelp(LINEN_TROUSERS, input);
      expect(out).toMatchObject({ available: false, inStockSizes: ['48', '50', '52'], sizeChartImage: false });
      expect(out.recommendedSize).toBeUndefined();
      expect(out.sizeRanges).toBeUndefined();
      expect(out.note).toContain("Don't ask for height and weight");
    }
  });

  describe('with a checked size chart', () => {
    const DRESS = product('eeeeeeee', 'Сукня льон', {}, [
      ['Білий', 'S', 2],
      ['Білий', 'M', 0],
      ['Білий', 'L', 1],
    ]);

    /** The product's own chart (what resolveForContext picks), ready unless the test says otherwise. */
    function chartHelp(p: AgentProduct, input: Record<string, unknown>, chart: Partial<SizeChart>, opts: { ranges?: boolean } = {}) {
      const picked = { name: 'Сукні', status: 'ready', sendImage: true, ...chart } as SizeChart;
      const d = {
        ...deps([p]),
        sizeCharts: {
          resolveForContext: async () => picked,
          listForTenant: async () => [picked],
        },
      } as unknown as AgentToolDeps;
      (d.catalog as unknown as Record<string, unknown>).resolveProductRef = async () => ({ id: p.id });
      const settings = { sizeChart: opts.ranges ? RANGES : null } as unknown as AgentStoreSettings;
      return getSizeHelpTool(d, SCOPE, settings).execute!({ productRef: p.ref, ...input } as never, CALL) as unknown as Promise<
        Record<string, unknown>
      >;
    }

    it("asks for the chart's own measurements, not height and weight", async () => {
      const out = await chartHelp(DRESS, {}, { table: DRESS_TABLE }, { ranges: true });
      expect(out).toMatchObject({
        available: true,
        chart: {
          name: 'Сукні',
          askFor: [
            { measurement: 'chest', label: 'Обхват грудей', unit: 'cm' },
            { measurement: 'waist', label: 'Обхват талії', unit: 'cm' },
            { measurement: 'hips', label: 'Обхват стегон', unit: 'cm' },
          ],
        },
        inStockSizes: ['S', 'L'],
        sizeChartImage: true,
      });
      expect((out.sizes as unknown[])[1]).toEqual({ size: 'S', chest: '84–88', waist: '66–70', hips: '90–94' });
      expect(out.note).toContain('Обхват грудей, Обхват талії, Обхват стегон');
      expect(out.sizeRanges).toBeUndefined();

      const withHeight = await chartHelp(DRESS, { heightCm: 168, weightKg: 58 }, { table: DRESS_TABLE });
      expect(withHeight.recommendedSize).toBeUndefined();
      expect(withHeight.note).toContain("This chart doesn't use height or weight");
    });

    it('recommends a letter size from the measurements and says whether it is in stock', async () => {
      expect(await chartHelp(DRESS, { measurements: { chest: 86, waist: 68, hips: 92 } }, { table: DRESS_TABLE })).toEqual({
        source: 'chart',
        available: true,
        chart: { name: 'Сукні' },
        recommendedSize: 'S',
        recommendedInStock: true,
        inStockSizes: ['S', 'L'],
        sizeChartImage: true,
      });
      const outOfStock = await chartHelp(DRESS, { measurements: { chest: 90, waist: 72, hips: 96 } }, { table: DRESS_TABLE });
      expect(outOfStock).toMatchObject({ recommendedSize: 'M', recommendedInStock: false });
      expect(outOfStock.note).toContain('M is out of stock');
    });

    it('recommends a number size for trousers in 48–58', async () => {
      const out = await chartHelp(LINEN_TROUSERS, { measurements: { waist: 91, hips: 107 } }, { name: 'Брюки', table: TROUSERS_TABLE }, { ranges: true });
      expect(out).toMatchObject({ available: true, recommendedSize: '52', recommendedInStock: true });
      expect(out.sizeRanges).toBeUndefined();
    });

    it('offers both sizes on a tie, recommending the larger', async () => {
      const out = await chartHelp(DRESS, { measurements: { chest: 88 } }, { table: DRESS_TABLE });
      expect(out).toMatchObject({ recommendedSize: 'M', between: ['S', 'M'], recommendedInStock: false });
      expect(out.note).toContain('offer both, or M for a looser fit');
      expect(out.note).toContain('Based on Обхват грудей only');
    });

    it("doesn't name a size beyond the chart", async () => {
      const out = await chartHelp(DRESS, { measurements: { chest: 125, waist: 110, hips: 130 } }, { table: DRESS_TABLE });
      expect(out).toMatchObject({ available: true, recommendedSize: null });
      expect(out.note).toContain("Don't name a size");
    });

    it("gives no recommendation when the chart's sizes aren't the product's", async () => {
      const out = await chartHelp(LINEN_TROUSERS, { measurements: { chest: 86 } }, { table: DRESS_TABLE });
      expect(out).toMatchObject({ available: false, inStockSizes: ['48', '50', '52'] });
      expect(out.recommendedSize).toBeUndefined();
    });

    it('falls back to the ranges while the chart is only a draft, and reports a picture the store won’t send', async () => {
      const out = await chartHelp(PREMIUM, { heightCm: 182, weightKg: 85 }, { status: 'draft', table: DRESS_TABLE, sendImage: false }, { ranges: true });
      expect(out).toMatchObject({ source: 'ranges', available: true, recommendedSize: 'L', sizeChartImage: false });
      expect(out.chartReason).toContain('not checked by the store yet');
      expect(out.chart).toBeUndefined();
    });

    it("never recommends from another chart when the product's own is a picture only", async () => {
      // A Mango dress whose chart is an image: the size comes from the store's ranges, and the Mango picture can be sent.
      const out = await chartHelp(PREMIUM, { heightCm: 182, weightKg: 85 }, { name: 'Mango dresses', status: 'image', table: null }, { ranges: true });
      expect(out).toMatchObject({ source: 'ranges', recommendedSize: 'L', sizeChartImage: true });
      expect(out.chartReason).toContain('«Mango dresses» for this product is a picture only');

      const noRanges = await chartHelp(PREMIUM, { measurements: { chest: 90 } }, { name: 'Mango dresses', status: 'image', table: null });
      expect(noRanges).toMatchObject({ source: 'none', recommendedSize: null, sizeChartImage: true });
    });
  });
});

describe('send_size_chart', () => {
  const send = (chart: Partial<SizeChart> | null) => {
    const d = {
      ...deps([PREMIUM]),
      sizeCharts: {
        resolveForContext: async () => (chart ? ({ name: 'Сорочки', imagePath: 'uploads/c.png', ...chart } as SizeChart) : null),
        publicUrl: (p: string) => `https://api.example/${p}`,
      },
    } as unknown as AgentToolDeps;
    (d.catalog as unknown as Record<string, unknown>).resolveProductRef = async () => ({ id: PREMIUM.id });
    return sendSizeChartTool(d, SCOPE).execute!({ productRef: PREMIUM.ref } as never, CALL) as unknown as Promise<Record<string, unknown>>;
  };

  it('stages the picture of the chart for the product', async () => {
    expect(await send({ sendImage: true })).toMatchObject({
      ok: true,
      staged: { type: 'send_size_chart', imageUrl: 'https://api.example/uploads/c.png', name: 'Сорочки' },
    });
  });

  it("refuses when the store doesn't send the chart's picture", async () => {
    const out = await send({ sendImage: false });
    expect(out.ok).toBe(false);
    expect(out.staged).toBeUndefined();
    expect(out.note).toContain("Don't say you're sending one");
    expect((await send(null)).ok).toBe(false);
  });
});

describe('search_products', () => {
  it('reports how many matched in total, not just how many it shows', async () => {
    const tool = searchProductsTool(deps([PREMIUM, CHECK], [PREMIUM.id, CHECK.id]), SCOPE);
    const out = (await tool.execute!({ query: 'сорочка' } as never, CALL)) as Record<string, unknown>;
    expect(out).toMatchObject({ found: 15, shown: 2 });
    expect(out.note).toContain('15 products match');
  });
});
