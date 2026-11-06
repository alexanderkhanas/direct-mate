import { browseCategoryTool, MAX_CATEGORY_CARDS, searchProductsTool } from './catalog.tools';
import type { AgentProduct } from '../catalog/catalog-reader.service';
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

describe('search_products', () => {
  it('reports how many matched in total, not just how many it shows', async () => {
    const tool = searchProductsTool(deps([PREMIUM, CHECK], [PREMIUM.id, CHECK.id]), SCOPE);
    const out = (await tool.execute!({ query: 'сорочка' } as never, CALL)) as Record<string, unknown>;
    expect(out).toMatchObject({ found: 15, shown: 2 });
    expect(out.note).toContain('15 products match');
  });
});
