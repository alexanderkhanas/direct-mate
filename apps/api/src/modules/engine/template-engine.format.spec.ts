/**
 * Deterministic coverage for `formatProductList` — the renderer behind
 * `{product_list}`.
 *
 * Worth pinning directly rather than through the simulator: it is a pure
 * function of (products, recommendedSize, style), it decides how much of a
 * customer's screen a reply occupies, and its branches (uniform vs ragged size
 * matrix, colour axis vs size-only catalog, shared vs per-product price) are
 * combinations the demo catalogs only cover by accident.
 *
 * The private is exercised through the prototype — it calls
 * `this.deduplicateByColor` and `this.detectVariantType`, so the prototype is
 * passed as `this` and no Nest context is booted.
 */
import { ProductSearchResult, TemplateEngineService } from './template-engine.service';
import { colorCountPhrase } from '../../common/color-i18n';

const render = (
  productData: ProductSearchResult[],
  recommendedSize?: string,
  style: 'detailed' | 'compact' = 'compact',
): string =>
  (TemplateEngineService.prototype as any).formatProductList.call(
    TemplateEngineService.prototype,
    productData,
    recommendedSize,
    style,
  );

let variantSeq = 0;
const variant = (
  color: string | null,
  size: string | null,
  price = 2900,
  effectiveAvailable = 1,
): ProductSearchResult['variants'][number] => ({
  id: `v${++variantSeq}`,
  color,
  size,
  price,
  currency: 'UAH',
  effectiveAvailable,
  imageUrl: null,
});

const product = (
  title: string,
  variants: ProductSearchResult['variants'],
): ProductSearchResult => ({
  product: { id: title, title, imageUrl: null, category: null, searchKeywords: null },
  variants,
});

/** colour × size matrix, every colour carrying every size */
const uniform = (
  title: string,
  colors: string[],
  sizes: string[],
  price = 2900,
): ProductSearchResult =>
  product(
    title,
    colors.flatMap((c) => sizes.map((s) => variant(c, s, price))),
  );

describe('colorCountPhrase', () => {
  // Three-way Slavic plural — the teens are the trap.
  it.each([
    [1, '1 колір'],
    [2, '2 кольори'],
    [4, '4 кольори'],
    [5, '5 кольорів'],
    [8, '8 кольорів'],
    [11, '11 кольорів'],
    [12, '12 кольорів'],
    [14, '14 кольорів'],
    [21, '21 колір'],
    [22, '22 кольори'],
    [25, '25 кольорів'],
  ])('%i → %s', (n, expected) => {
    expect(colorCountPhrase(n as number)).toBe(expected);
  });
});

describe('formatProductList — compact', () => {
  it('collapses a colour axis to a count and drops blank separators', () => {
    const out = render([
      uniform("В'язана шовкова футболка", ['Темно-синій', 'Бежевий'], ['L'], 3100),
      uniform('Reglan', ['Бежевий', 'Блакитний', 'Молочний', 'Темно-синій'], ['L'], 2900),
    ], 'L');

    expect(out).toBe(
      "1. В'язана шовкова футболка · 2 кольори — 3100 грн\n" +
        '2. Reglan · 4 кольори — 2900 грн',
    );
    expect(out).not.toContain('Відтінки:');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('names a single colour instead of saying "1 колір"', () => {
    const out = render([uniform('MOKKO', ['Мокко'], ['L'], 2500)], 'L');
    expect(out).toBe('1. MOKKO · Мокко — 2500 грн');
  });

  it('omits a single colour the TITLE already states', () => {
    // «Футболка базова біла · Білий — 1250 грн» reads the product's own name
    // back at the customer. The forms differ grammatically (title «біла»,
    // catalog «Білий»), so this only works via stemming.
    const out = render([uniform('Футболка базова біла', ['Білий'], ['L'], 1250)], 'L');
    expect(out).toBe('1. Футболка базова біла — 1250 грн');
  });

  it('still names a single colour the title does NOT state', () => {
    const out = render([uniform('Футболка базова', ['Білий'], ['L'], 1250)], 'L');
    expect(out).toBe('1. Футболка базова · Білий — 1250 грн');
  });

  it('keeps the COUNT when several colours exist, whatever the title says', () => {
    // A title can name at most one colour; the count is real information.
    const out = render([uniform('Сорочка біла', ['Білий', 'Чорний'], ['L'])], 'L');
    expect(out).toBe('1. Сорочка біла · 2 кольори — 2900 грн');
  });

  it('does not leave a dangling separator when the colour is dropped but sizes remain', () => {
    const out = render([uniform('Футболка базова біла', ['Білий'], ['S', 'M', 'L'], 1250)]);
    expect(out).toBe('1. Футболка базова біла · S, M, L — 1250 грн');
  });

  it('inlines the price for a ONE-product list instead of «Усі по …»', () => {
    // "Усі" (all of them) has nothing to range over with a single product.
    const out = render([uniform('MOKKO', ['Мокко'], ['L'], 2500)], 'L');
    expect(out).not.toContain('Усі по');
  });

  it('enumerates sizes on a size-only catalog — they are the only variant info', () => {
    const out = render([
      product('Футболка базова чорна', [
        variant(null, 'M'),
        variant(null, 'S'),
        variant(null, 'L'),
      ]),
    ]);
    // sortSizes puts them in wearing order, not insertion order.
    expect(out).toBe('1. Футболка базова чорна · S, M, L — 2900 грн');
  });

  it('shows colours AND sizes when every colour carries the same sizes', () => {
    const out = render([uniform('Сорочка', ['Чорний', 'Білий'], ['S', 'M', 'L'])]);
    expect(out).toBe('1. Сорочка · 2 кольори · S, M, L — 2900 грн');
  });

  it('omits sizes on a RAGGED matrix rather than over-claiming stock', () => {
    // Чорний has S+M, Білий only S. "S, M" would promise an M that does not
    // exist in Білий; the detailed renderer spells this out per colour, which
    // is the longest thing it emits.
    const out = render([
      product('Сорочка', [
        variant('Чорний', 'S'),
        variant('Чорний', 'M'),
        variant('Білий', 'S'),
      ]),
    ]);
    expect(out).toBe('1. Сорочка · 2 кольори — 2900 грн');
    expect(out).not.toContain(' M');
  });

  it('omits sizes when the list is scoped to the recommended size', () => {
    const out = render([uniform('Сорочка', ['Чорний', 'Білий'], ['L'])], 'L');
    expect(out).toBe('1. Сорочка · 2 кольори — 2900 грн');
  });

  it('keeps the size column when a size is in memory but the list is NOT scoped to it', () => {
    // `recommendedSize` alone is not evidence the list was filtered — the
    // search-path filter stands down whenever the customer named a product.
    const out = render([uniform('Сорочка', ['Чорний'], ['S', 'M', 'L'])], 'L');
    expect(out).toBe('1. Сорочка · Чорний · S, M, L — 2900 грн');
  });

  it('renders a price RANGE when one product spans prices', () => {
    const out = render([
      product('Сорочка льон', [
        variant('Чорний', 'L', 3300),
        variant('Бежевий', 'L', 3900),
      ]),
    ], 'L');
    expect(out).toBe('1. Сорочка льон · 2 кольори — від 3300 до 3900 грн');
  });

  it('moves the price to a shared trailing line when every product agrees', () => {
    const out = render([
      uniform('A', ['Чорний', 'Білий'], ['L'], 2900),
      uniform('B', ['Хакі'], ['L'], 2900),
    ], 'L');
    // No per-product price, so the line ends after the variant summary — the
    // em-dash belongs to the price and must not be left dangling.
    expect(out).toBe('1. A · 2 кольори\n2. B · Хакі\n\nУсі по 2900 грн.');
  });

  it('skips out-of-stock products and keeps numbering contiguous', () => {
    const out = render([
      uniform('A', ['Чорний'], ['L']),
      product('SOLD OUT', [variant('Білий', 'L', 2900, 0)]),
      uniform('C', ['Хакі'], ['L']),
    ], 'L');
    expect(out).toBe('1. A · Чорний\n2. C · Хакі\n\nУсі по 2900 грн.');
    expect(out).not.toContain('SOLD OUT');
  });

  it('never returns an empty string for a product with variants', () => {
    // `product_list` is a required variable — '' makes hasRequiredVariables
    // reject the template and drops the turn into AI fallback.
    const out = render([product('Без варіантів', [variant(null, null)])]);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toBe('1. Без варіантів — 2900 грн');
  });
});

describe('formatProductList — detailed (unchanged behaviour)', () => {
  it('still renders the multi-line block with blank separators', () => {
    const out = render(
      [
        uniform('A', ['Чорний', 'Білий'], ['S', 'M'], 2900),
        uniform('B', ['Хакі'], ['S', 'M'], 3100),
      ],
      undefined,
      'detailed',
    );
    expect(out).toContain('Відтінки:');
    expect(out).toContain('Розміри:');
    expect(out).toContain('\n\n');
  });
});
