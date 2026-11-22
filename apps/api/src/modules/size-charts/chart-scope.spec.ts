import { chartCovers, chartLevel, pickChart, type ChartScope } from './chart-scope';

const chart = (
  name: string,
  brands: string[],
  categories: string[],
  opts: { isDefault?: boolean; day?: number; sizes?: string[] } = {},
): ChartScope & { name: string } => ({
  name,
  brands,
  categories,
  isDefault: opts.isDefault ?? false,
  createdAt: new Date(2026, 10, opts.day ?? 1),
  table: opts.sizes ? { rows: opts.sizes.map((size) => ({ size })) } : null,
});

const LLIANA_DRESS = { brand: 'Lliana', categories: ['Сукні'] };

describe('size chart scope', () => {
  it('ranks brand + category over brand over category over the whole store', () => {
    expect(chartLevel(chart('a', ['lliana'], ['сукні']))).toBe(3);
    expect(chartLevel(chart('b', ['lliana'], []))).toBe(2);
    expect(chartLevel(chart('c', [], ['сукні']))).toBe(1);
    expect(chartLevel(chart('d', [], []))).toBe(0);
    expect(chartLevel(chart('e', ['lliana'], ['сукні'], { isDefault: true }))).toBe(0);
  });

  it('picks the most specific chart covering the product, level by level', () => {
    const whole = chart('whole', [], []);
    const dresses = chart('dresses', [], ['сукні']);
    const brand = chart('brand', ['lliana'], []);
    const exact = chart('exact', ['lliana'], ['сукні', 'сорочки']);
    const otherBrand = chart('other brand', ['monte'], ['сукні']);

    expect(pickChart([whole, dresses, brand, exact, otherBrand], LLIANA_DRESS)?.name).toBe('exact');
    expect(pickChart([whole, dresses, brand, otherBrand], LLIANA_DRESS)?.name).toBe('brand');
    expect(pickChart([whole, dresses, otherBrand], LLIANA_DRESS)?.name).toBe('dresses');
    expect(pickChart([whole, otherBrand], LLIANA_DRESS)?.name).toBe('whole');
    expect(pickChart([otherBrand], LLIANA_DRESS)).toBeNull();
  });

  it('takes the newest chart within a level', () => {
    const older = chart('older', [], ['сукні'], { day: 1 });
    const newer = chart('newer', [], ['сукні'], { day: 5 });
    expect(pickChart([older, newer], LLIANA_DRESS)?.name).toBe('newer');
    expect(pickChart([newer, older], LLIANA_DRESS)?.name).toBe('newer');
  });

  it("skips a chart whose table has none of the product's sizes for the next one that has them", () => {
    // Claude saved clothes in S–3XL covering trousers too, then «Брюки» in 42–58 and jeans 30–38.
    const clothes = chart('clothes', [], ['брюки', 'сорочки'], { day: 1, sizes: ['S', 'M', 'L', 'XL', '2XL', 'XXL'] });
    const trousers = chart('trousers', [], ['брюки'], { day: 2, sizes: ['42', '44', '46', '48', '30', '32'] });
    const charts = [clothes, trousers];

    expect(pickChart(charts, { brand: null, categories: ['Брюки'], sizes: ['S', 'M', 'L', 'XL', '2XL'] })?.name).toBe('clothes');
    expect(pickChart(charts, { brand: null, categories: ['Брюки'], sizes: ['48', '50'] })?.name).toBe('trousers');
    expect(pickChart(charts, { brand: null, categories: ['Брюки'], sizes: ['30', '32'] })?.name).toBe('trousers');
    // Sizes unknown: the most specific, newest chart, as before.
    expect(pickChart(charts, { brand: null, categories: ['Брюки'] })?.name).toBe('trousers');
    // No chart has them: the most specific one answers, and says the sizes differ.
    expect(pickChart(charts, { brand: null, categories: ['Брюки'], sizes: ['W30L32'] })?.name).toBe('trousers');
  });

  it("never skips a picture-only chart: its sizes aren't known", () => {
    const picture = chart('mango', ['lliana'], [], { day: 1 });
    const whole = chart('whole', [], [], { day: 2, sizes: ['S', 'M'] });
    expect(pickChart([picture, whole], { ...LLIANA_DRESS, sizes: ['S', 'M'] })?.name).toBe('mango');
  });

  it('matches any of the product categories, from either source, ignoring case and spaces', () => {
    const trousers = chart('trousers', [], ['штани']);
    // `products.category` says «Одяг», the linked categories say « Штани ».
    expect(chartCovers(trousers, { brand: null, categories: ['Одяг', ' Штани '] })).toBe(true);
    expect(chartCovers(trousers, { brand: null, categories: ['Сукні'] })).toBe(false);
    expect(chartCovers(chart('brand', ['lliana'], []), { brand: '  LLIANA ', categories: [] })).toBe(true);
  });

  it('covers every product with a whole-store or default chart, and none with a scoped one when the product has no brand', () => {
    const noInfo = { brand: null, categories: [] };
    expect(chartCovers(chart('whole', [], []), noInfo)).toBe(true);
    expect(chartCovers(chart('default', ['monte'], [], { isDefault: true }), noInfo)).toBe(true);
    expect(chartCovers(chart('brand', ['lliana'], []), noInfo)).toBe(false);
    expect(pickChart<ChartScope>([chart('brand', ['lliana'], [])], noInfo)).toBeNull();
  });
});
