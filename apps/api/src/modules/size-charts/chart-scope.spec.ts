import { chartCovers, chartLevel, pickChart, type ChartScope } from './chart-scope';

const chart = (name: string, brands: string[], categories: string[], opts: { isDefault?: boolean; day?: number } = {}) => ({
  name,
  brands,
  categories,
  isDefault: opts.isDefault ?? false,
  createdAt: new Date(2026, 10, opts.day ?? 1),
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
