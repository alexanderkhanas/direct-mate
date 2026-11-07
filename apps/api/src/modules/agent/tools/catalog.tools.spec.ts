import { browseCategoryTool, getSizeHelpTool, MAX_CATEGORY_CARDS, searchProductsTool } from './catalog.tools';
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
});

describe('search_products', () => {
  it('reports how many matched in total, not just how many it shows', async () => {
    const tool = searchProductsTool(deps([PREMIUM, CHECK], [PREMIUM.id, CHECK.id]), SCOPE);
    const out = (await tool.execute!({ query: 'сорочка' } as never, CALL)) as Record<string, unknown>;
    expect(out).toMatchObject({ found: 15, shown: 2 });
    expect(out.note).toContain('15 products match');
  });
});
