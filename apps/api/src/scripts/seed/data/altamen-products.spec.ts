/**
 * `normalizeProductTitle` — cleaning scraped altamen.com.ua titles for display.
 *
 * Pinned directly because the transform is lossy in one direction (an
 * over-eager SKU regex silently truncates a product name) and because the
 * casing rule is derived from the catalog's own house style rather than chosen:
 * every capitalized Cyrillic token across the mixed-case titles is the first
 * word of its title, and «Трикотажний костюм тенор» keeps the model name
 * lowercase. If someone later "fixes" this to Title Case Every Word, these
 * fail.
 */
import { getAltamenProducts, normalizeProductTitle } from './altamen-products';

describe('normalizeProductTitle', () => {
  describe('SKU remnants from the «NAME - SKU» source format', () => {
    it('strips a trailing bare separator', () => {
      expect(normalizeProductTitle('ФУТБОЛКА БАЗОВА БІЛА -')).toBe('Футболка базова біла');
    });

    it('strips a trailing dotted SKU', () => {
      expect(normalizeProductTitle('СОРОЧКА ЛЬОН ПІСОЧНА - 05.30.70.51')).toBe(
        'Сорочка льон пісочна',
      );
    });

    it('strips a trailing numeric SKU', () => {
      expect(normalizeProductTitle('СОРОЧКА ЛЬОН У БЛАКИТНУ СМУЖКУ - 1022404')).toBe(
        'Сорочка льон у блакитну смужку',
      );
    });

    it('does NOT truncate a hyphenated product name', () => {
      // The regex is bounded to codes starting with a digit precisely so this
      // survives — the catalog really does contain «СОРОЧКА-ФУТБОЛКА».
      expect(normalizeProductTitle("ВʼЯЗАНА СОРОЧКА-ФУТБОЛКА БЕЖЕВА")).toBe(
        "Вʼязана сорочка-футболка бежева",
      );
    });

    it('collapses internal whitespace runs', () => {
      expect(normalizeProductTitle('ТРИКОТАЖНИЙ КОСТЮМ ТЕНОР СІРИЙ  ЗІ СТІЙКОЮ')).toBe(
        'Трикотажний костюм тенор сірий зі стійкою',
      );
    });

    it('trims trailing whitespace', () => {
      expect(normalizeProductTitle('ПРИНТОВАНА КОТОН СОРОЧКА З КОРОТКИМ РУКАВОМ  ')).toBe(
        'Принтована котон сорочка з коротким рукавом',
      );
    });
  });

  describe('casing', () => {
    it('sentence-cases ALL-CAPS Cyrillic — not Title Case', () => {
      expect(normalizeProductTitle('ВІЛЬНА СОРОЧКА У КЛІТИНКУ')).toBe(
        'Вільна сорочка у клітинку',
      );
    });

    it('keeps a model name lowercase, matching the house style', () => {
      // «Трикотажний костюм тенор» is how the store writes it themselves.
      expect(normalizeProductTitle('ТРИКОТАЖНИЙ КОСТЮМ ТЕНОР')).toBe(
        'Трикотажний костюм тенор',
      );
    });

    it('leaves a mixed-case title completely untouched', () => {
      expect(normalizeProductTitle("В'язана футболка Reglan")).toBe("В'язана футболка Reglan");
      expect(normalizeProductTitle('Сорочка льон Premium')).toBe('Сорочка льон Premium');
    });

    it('preserves Latin brand tokens inside an ALL-CAPS title', () => {
      expect(normalizeProductTitle('ФУТБОЛКА З ПОЛІРОВАНОЇ БАВОВНИ MOKKO')).toBe(
        'Футболка з полірованої бавовни MOKKO',
      );
    });

    it('canonicalises Latin tokens that appear under two spellings', () => {
      // SANTORINI/Santorini and PREMIUM/Premium both occur; one model must not
      // present itself two ways to narrowByProductName.
      expect(normalizeProductTitle('БРЮКИ SANTORINI ЧОРНІ')).toBe('Брюки Santorini чорні');
      expect(normalizeProductTitle('СОРОЧКА ЛЬОН PREMIUM СІРО-БЛАКИТНА')).toBe(
        'Сорочка льон Premium сіро-блакитна',
      );
    });

    it('handles both apostrophe variants inside the first word', () => {
      // The catalog mixes ʼ (U+02BC) and '. The capital must land on the first
      // LETTER either way.
      expect(normalizeProductTitle('ВʼЯЗАНЕ ПОЛО НА БЛИСКАВЦІ')).toBe(
        'Вʼязане поло на блискавці',
      );
      expect(normalizeProductTitle("В'ЯЗАНЕ ПОЛО НА БЛИСКАВЦІ")).toBe(
        "В'язане поло на блискавці",
      );
    });

    it('leaves a title that is only a Latin token alone', () => {
      expect(normalizeProductTitle('MOKKO')).toBe('MOKKO');
    });
  });

  it('is idempotent — a normalized title survives a second pass', () => {
    const once = normalizeProductTitle('ФУТБОЛКА БАЗОВА БІЛА -');
    expect(normalizeProductTitle(once)).toBe(once);
  });

  it('keeps the trailing code when asked', () => {
    expect(
      normalizeProductTitle('СОРОЧКА ЛЬОН У БЛАКИТНУ СМУЖКУ - 1022404', {
        keepTrailingCode: true,
      }),
    ).toBe('Сорочка льон у блакитну смужку - 1022404');
  });
});

describe('getAltamenProducts — title collisions', () => {
  // Stripping the SKU makes «СОРОЧКА ЛЬОН У БЛАКИТНУ СМУЖКУ -» and
  // «... - 1022404» the same string — but they are two different colourways
  // (Білий у блакитну смужку / Блакитний у білу смужку) the merge step kept
  // apart. Two products sharing a display title is worse than one ugly title:
  // the customer can't tell them apart, `narrowByProductName` can't either, and
  // `titlesEqual` would pair one product's name with the other's price.
  const products = getAltamenProducts();

  it('produces no duplicate titles across the catalog', () => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const key = p.title.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.entries()].filter(([, c]) => c > 1)).toEqual([]);
  });

  it('carries the disambiguating code on ONLY the colliding product', () => {
    const striped = products.filter((p) =>
      p.title.toLowerCase().includes('блакитну смужку'),
    );
    expect(striped).toHaveLength(2);
    expect(striped.filter((p) => /\d{5,}/.test(p.title))).toHaveLength(1);
  });

  it('leaves every other title free of code noise', () => {
    const noisy = products.filter(
      (p) => /\s[-–]\s*[\w.]*\d/.test(p.title) && !p.title.includes('1022404'),
    );
    expect(noisy).toEqual([]);
  });
});
