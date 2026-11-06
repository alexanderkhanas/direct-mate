import { queryStems, rankProducts, stem } from './catalog-search';

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
