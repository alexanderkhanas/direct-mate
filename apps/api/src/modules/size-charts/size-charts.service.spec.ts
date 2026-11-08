import { BadRequestException } from '@nestjs/common';
import { SizeChartsService } from './size-charts.service';
import type { SizeChart } from './size-chart.entity';
import type { SizeChartTable } from './size-chart-table';

const TABLE: SizeChartTable = {
  measurements: [{ key: 'chest', label: 'Обхват грудей', unit: 'cm' }],
  rows: [
    { size: 'S', values: { chest: { min: 84, max: 88 } } },
    { size: 'M', values: { chest: { min: 88, max: 92 } } },
  ],
  uncertain: [{ size: 'M', key: 'chest' }],
};

const NEW_IMAGE = 'uploads/0b6f6c1e-5a8e-4a7e-9d43-1f2c3b4a5d6e.png';

let day = 0;
const chart = (name: string, brands: string[], categories: string[], extra: Partial<SizeChart> = {}): SizeChart =>
  ({
    id: name,
    tenantId: 't1',
    name,
    imagePath: `uploads/${name}.png`,
    brands,
    categories,
    isDefault: false,
    table: null,
    status: 'image',
    sendImage: true,
    createdAt: new Date(2026, 10, ++day),
    updatedAt: new Date(),
    ...extra,
  }) as SizeChart;

/**
 * Products as the scope query returns them: `category` is the legacy column,
 * `linked` the product_categories names.
 */
const PRODUCTS = [
  { id: 'p1', brand: 'Lliana', category: 'Сукні', linked: null },
  { id: 'p2', brand: 'Lliana', category: null, linked: ['Сорочки'] },
  { id: 'p3', brand: 'Lliana', category: 'Одяг', linked: ['Штани'] },
  { id: 'p4', brand: 'Linen Lab', category: 'Сукні', linked: ['сукні'] },
  { id: 'p5', brand: 'Monte', category: 'Топи', linked: null },
  { id: 'p6', brand: null, category: null, linked: null },
];

function setup(charts: SizeChart[]) {
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM products p') && sql.includes('array_agg')) {
      return params.length > 1 ? PRODUCTS.filter((p) => p.id === params[1]) : PRODUCTS;
    }
    return [];
  });
  const repo = {
    find: jest.fn(async ({ where }: { where: { status?: string } }) =>
      charts.filter((c) => !where.status || c.status === where.status),
    ),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => charts.find((c) => c.id === where.id) ?? null),
  };
  const save = jest.fn(async (entity: SizeChart) => entity);
  const dataSource = {
    query,
    transaction: async (fn: (m: unknown) => unknown) => fn({ getRepository: () => ({ save, update: jest.fn() }) }),
  };
  const config = { get: () => 'https://api.example' };
  return { service: new SizeChartsService(repo as never, dataSource as never, config as never), save };
}

describe('SizeChartsService', () => {
  describe('resolveForContext', () => {
    const charts = [
      chart('whole', [], [], { status: 'ready', table: TABLE }),
      chart('trousers', [], ['штани'], { status: 'ready', table: TABLE }),
      chart('lliana', ['lliana'], [], { status: 'draft', table: TABLE }),
      chart('lliana dresses', ['lliana'], ['сукні']),
    ];

    it('picks by product, with categories from both sources', async () => {
      const { service } = setup(charts);
      expect((await service.resolveForContext('t1', { productId: 'p1' }))?.name).toBe('lliana dresses');
      expect((await service.resolveForContext('t1', { productId: 'p2' }))?.name).toBe('lliana');
      expect((await service.resolveForContext('t1', { productId: 'p6' }))?.name).toBe('whole');
      // p3's legacy category is «Одяг»; its linked one is «Штани».
      expect((await setup([charts[0], charts[1]]).service.resolveForContext('t1', { productId: 'p3' }))?.name).toBe('trousers');
    });

    it("returns the product's own chart even when it isn't ready: a broader ready chart never stands in", async () => {
      const { service } = setup(charts);
      expect(await service.resolveForContext('t1', { productId: 'p1' })).toMatchObject({ name: 'lliana dresses', status: 'image' });
    });

    it('without a product, only a whole-store chart applies', async () => {
      const { service } = setup(charts);
      expect((await service.resolveForContext('t1', {}))?.name).toBe('whole');
      expect(await setup(charts.slice(1)).service.resolveForContext('t1', {})).toBeNull();
    });

    it("returns null for a product that isn't the store's", async () => {
      const { service } = setup(charts);
      expect(await service.resolveForContext('t1', { productId: 'elsewhere' })).toBeNull();
    });
  });

  it('counts the products a scope covers, out of all active ones', async () => {
    const { service } = setup([]);
    expect(await service.matchCount('t1', { brands: [], categories: [] })).toEqual({ count: 6, total: 6 });
    expect(await service.matchCount('t1', { brands: ['LLIANA'], categories: [] })).toEqual({ count: 3, total: 6 });
    expect(await service.matchCount('t1', { brands: [], categories: ['Сукні', 'штани'] })).toEqual({ count: 3, total: 6 });
    expect(await service.matchCount('t1', { brands: ['Lliana'], categories: ['Сукні', 'Сорочки'] })).toEqual({ count: 2, total: 6 });
  });

  it("counts a product as covered only when its own chart is ready, naming what is missing entirely", async () => {
    const { service } = setup([
      chart('whole', [], [], { status: 'ready', table: TABLE }),
      chart('lliana tops', ['lliana'], ['сукні', 'сорочки'], { status: 'ready', table: TABLE }),
      chart('monte draft', ['monte'], [], { status: 'draft', table: TABLE }),
      chart('linen picture', ['linen lab'], []),
    ]);
    expect(await service.coverage('t1')).toEqual({
      total: 6,
      // p1, p2 by «lliana tops»; p3 and p6 by «whole». Linen Lab and Monte have charts of their own, not ready.
      covered: 4,
      uncovered: 2,
      uncoveredBrands: ['Linen Lab', 'Monte'],
      // «Сукні» isn't listed: p1 has a ready chart.
      uncoveredCategories: ['Топи'],
    });
  });

  it('counts for each chart the products it is the chart for', async () => {
    const { service } = setup([chart('dresses', [], ['сукні']), chart('whole', [], [])]);
    const list = await service.listWithCounts('t1');
    expect(list.map((c) => [c.name, c.productCount])).toEqual([
      ['dresses', 2],
      ['whole', 4],
    ]);
  });

  describe('update', () => {
    it('saves a checked table as ready and clears the uncertain marks', async () => {
      const draft = chart('d', [], [], { status: 'draft', table: TABLE });
      const { service } = setup([draft]);
      const saved = await service.update('t1', 'd', { table: TABLE, status: 'ready', sendImage: false });
      expect(saved).toMatchObject({ status: 'ready', sendImage: false });
      expect(saved.table?.uncertain).toEqual([]);
    });

    it('refuses an invalid table, and ready without a table', async () => {
      const { service } = setup([chart('img', [], [])]);
      await expect(
        service.update('t1', 'img', { table: { ...TABLE, rows: [{ size: 'S', values: { chest: { min: 9, max: 1 } } }] } }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update('t1', 'img', { status: 'ready' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks the table again when a ready chart gets a new one', async () => {
      const { service } = setup([chart('r1', [], [], { status: 'ready', table: TABLE })]);
      const empty = { ...TABLE, rows: [...TABLE.rows, { size: 'L', values: {} }] };
      await expect(service.update('t1', 'r1', { table: empty })).rejects.toBeInstanceOf(BadRequestException);
      const saved = await service.update('t1', 'r1', { table: TABLE });
      expect(saved).toMatchObject({ status: 'ready' });
      expect(saved.table?.uncertain).toEqual([]);
    });

    it('puts a read chart back to image-only when its picture is replaced', async () => {
      const ready = chart('r', [], [], { status: 'ready', table: TABLE });
      const { service } = setup([ready]);
      const saved = await service.update('t1', 'r', { imagePath: NEW_IMAGE });
      expect(saved).toMatchObject({ status: 'image', table: null, imagePath: NEW_IMAGE });
    });

    it('takes only an uploaded image or an https URL as the picture', async () => {
      const { service } = setup([chart('p', [], [])]);
      for (const imagePath of ['../.env', 'uploads/../.env', 'uploads/chart.png', 'http://example.com/c.png', 'file:///etc/passwd']) {
        await expect(service.update('t1', 'p', { imagePath })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.create('t1', { name: 'x', imagePath })).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await service.update('t1', 'p', { imagePath: 'https://cdn.example.com/chart.webp' })).toMatchObject({ status: 'image' });
    });

    it('turns an image-only chart into a draft when a table is saved without a status', async () => {
      const { service } = setup([chart('img2', [], [])]);
      expect(await service.update('t1', 'img2', { table: TABLE })).toMatchObject({ status: 'draft' });
    });
  });
});
