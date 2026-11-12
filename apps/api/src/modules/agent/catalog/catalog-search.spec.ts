import { matchSku, normalizeSku, queryStems, rankProducts, stem } from './catalog-search';

const row = (id: string, title: string, category: string | null = null) => ({
  id,
  title,
  category,
  search_keywords: null,
});

const CATALOG = [
  row('sea', 'Сорочка льон морська хвиля', 'Сорочки'),
  row('stripe', 'Сорочка льон у смужку', 'Сорочки'),
  row('base', 'Сорочка льон', 'Сорочки'),
  row('oxford', 'Сорочка оксфорд', 'Сорочки'),
  row('pants', 'Брюки льон', 'Брюки'),
];

describe('stem', () => {
  it('strips one case ending so inflected forms meet', () => {
    expect(stem('сорочку')).toBe(stem('Сорочка'));
    expect(stem('брюки')).toBe('брюк');
  });

  it('maps a material adjective to the noun titles use', () => {
    expect(stem('лляну')).toBe('льон');
    expect(stem('шкіряні')).toBe('шкір');
  });
});

describe('rankProducts', () => {
  it('finds the generic product first, ahead of its longer-named variants', () => {
    // Both words match the three linen shirts; one word matches the oxford
    // shirt and the linen trousers, which tie and fall back to title length.
    expect(rankProducts(CATALOG, 'лляну сорочку')).toEqual(['base', 'stripe', 'sea', 'pants', 'oxford']);
  });

  it('ignores filler words', () => {
    expect(queryStems('Хочу щось для роботи')).toEqual(['робот']);
  });

  it('narrows to a category when one is given, and lists it when the query names nothing', () => {
    expect(rankProducts(CATALOG, 'льон', 'Брюки')).toEqual(['pants']);
    expect(rankProducts(CATALOG, 'покажіть', 'Сорочки')).toEqual(['base', 'oxford', 'stripe', 'sea']);
  });

  it('returns nothing when no word matches, so the caller can fall back', () => {
    expect(rankProducts(CATALOG, 'кросівки')).toEqual([]);
  });
});

describe('matchSku', () => {
  const sku = (id: string, productSku: string | null, variants: string[] = [], model: string | null = null) => ({
    id,
    sku: productSku,
    model_name: model,
    variant_skus: variants,
  });
  const ROWS = [
    sku('adidas', '190', ['ADID-002-BILY-M', 'ADID-002-BILY-L']),
    sku('adidas-2', '191', ['ADID-003-CHOR-M']),
    sku('levis', '233', ['LEVI-015-TEMN-48']),
    sku('feiko', '2157', ['2907010003626'], 'FEIKO'),
    sku('linen', 'LV-2933'),
  ];

  it('finds a product, model or variant code ignoring case, spaces, dashes and an «арт.» label', () => {
    expect(matchSku(ROWS, 'lv 2933')).toEqual(['linen']);
    expect(matchSku(ROWS, 'Арт. LV2933')).toEqual(['linen']);
    expect(matchSku(ROWS, 'feiko')).toEqual(['feiko']);
    expect(matchSku(ROWS, '2907010003626')).toEqual(['feiko']);
    expect(matchSku(ROWS, 'adid-002-bily-l')).toEqual(['adidas']);
  });

  it("finds a variant coded article-colour-size by its article, but not a whole brand by its prefix", () => {
    expect(matchSku(ROWS, 'ADID-002')).toEqual(['adidas']);
    expect(matchSku(ROWS, 'adid 003')).toEqual(['adidas-2']);
    expect(matchSku(ROWS, 'ADID')).toEqual([]);
  });

  it('matches exactly, not a code that merely contains the number', () => {
    expect(matchSku(ROWS, '19')).toEqual([]);
    expect(matchSku(ROWS, '1900')).toEqual([]);
    expect(matchSku(ROWS, '190')).toEqual(['adidas']);
  });

  it('treats dots and slashes as separators, whole or as a prefix', () => {
    const rows = [sku('dotted', null, ['AB.12.RED', 'AB.12.BLUE']), sku('slashed', 'KL/204')];
    expect(matchSku(rows, 'AB.12')).toEqual(['dotted']);
    expect(matchSku(rows, 'ab 12')).toEqual(['dotted']);
    expect(matchSku(rows, 'ab.12.red')).toEqual(['dotted']);
    expect(matchSku(rows, 'KL-204')).toEqual(['slashed']);
    expect(normalizeSku('Арт. LV.2933.')).toBe('lv2933');
  });

  it('keeps a code that starts like a label', () => {
    expect(normalizeSku('ARTEMIS-01')).toBe('artemis01');
    expect(normalizeSku('Артикул: 2933')).toBe('2933');
    expect(normalizeSku('№ 2933')).toBe('2933');
  });
});
