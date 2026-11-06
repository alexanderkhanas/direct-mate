import { categoryCard, describeProduct, pickVariant } from './product-shapes';
import type { AgentProduct, AgentVariant } from '../catalog/catalog-reader.service';

const variant = (id: string, color: string | null, size: string | null, available: number, price = 3300): AgentVariant => ({
  id,
  color,
  size,
  price,
  regularPrice: null,
  currency: 'UAH',
  available,
  imageUrl: null,
});

const SHIRT: AgentProduct = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  ref: 'aaaaaaaa',
  title: 'Сорочка льон',
  category: 'Сорочки',
  brand: null,
  material: 'льон',
  gender: null,
  season: null,
  modelName: null,
  description: null,
  imageUrl: null,
  attributes: { formality: 'святкова', pattern: 'однотонний', fabricLook: 'фактурна', collar: 'кент', fit: 'прямий' },
  variants: [
    variant('black-m', 'Чорний', 'M', 2),
    variant('black-2xl', 'Чорний', '2XL', 1),
    variant('white-l', 'Білий', 'L', 0),
  ],
};

describe('pickVariant', () => {
  it('asks for the colour instead of guessing', () => {
    expect(pickVariant(SHIRT, undefined, 'M')).toEqual({
      error: 'Which colour of Сорочка льон? Colours: Чорний, Білий.',
    });
  });

  it('asks for the size instead of guessing', () => {
    expect(pickVariant(SHIRT, 'чорну')).toEqual({ error: 'Which size of Сорочка льон? Sizes: M, 2XL.' });
  });

  it('matches a declined colour and an XXL/2XL spelling', () => {
    expect(pickVariant(SHIRT, 'чорну', 'XXL')).toEqual({ variant: SHIRT.variants[1] });
  });

  it('says which colours and sizes exist when the customer names one that does not', () => {
    expect(pickVariant(SHIRT, 'синя', 'M')).toEqual({ error: 'Сорочка льон has no colour "синя". Colours: Чорний, Білий.' });
  });

  it('needs no colour for a product whose colour is in its name', () => {
    const tee = { ...SHIRT, variants: [variant('m', null, 'M', 1), variant('l', null, 'L', 1)] };
    expect(pickVariant(tee, undefined, 'L')).toEqual({ variant: tee.variants[1] });
  });
});

describe('describeProduct', () => {
  it('groups stock by colour with sizes in and out of stock', () => {
    expect(describeProduct(SHIRT).stock).toEqual([
      { color: 'Чорний', inStock: true, inStockSizes: ['M', '2XL'], outOfStockSizes: [] },
      { color: 'Білий', inStock: false, inStockSizes: [], outOfStockSizes: ['L'] },
    ]);
  });

  it('quotes the in-stock price, the regular price of a discount, and per-variant prices only when they differ', () => {
    const discounted = {
      ...SHIRT,
      variants: [{ ...variant('a', 'Чорний', 'M', 1, 2900), regularPrice: 3300 }, variant('b', 'Білий', 'L', 1, 3100)],
    };
    const details = describeProduct(discounted);
    expect(details).toMatchObject({ price: 2900, maxPrice: 3100, regularPrice: 3300 });
    expect(details.variantPrices).toHaveLength(2);
    expect(describeProduct(SHIRT).variantPrices).toBeUndefined();
  });

  it('includes the look, without the colour the variants already name', () => {
    expect(describeProduct(SHIRT).look).toBe('святкова, однотонний, фактурна, кент, прямий');
  });
});

describe('categoryCard', () => {
  it('keeps what a choice needs: price, colours in stock and look, but no sizes', () => {
    expect(categoryCard(SHIRT)).toEqual({
      ref: 'aaaaaaaa',
      title: 'Сорочка льон',
      price: 3300,
      colorsInStock: ['Чорний'],
      look: 'святкова, однотонний, фактурна, кент, прямий',
    });
  });

  it('names the colour in the look when the variants carry none', () => {
    const tee = {
      ...SHIRT,
      attributes: { formality: 'повсякденна', colour: 'Білий' },
      variants: [variant('m', null, 'M', 1)],
    };
    expect(categoryCard(tee).look).toBe('повсякденна, Білий');
  });

  it('leaves the look out until the photo has been read', () => {
    expect(categoryCard({ ...SHIRT, attributes: {} }).look).toBeUndefined();
  });
});
