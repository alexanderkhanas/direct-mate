import { productsInToolOutputs, titlesMentioned } from './shortlist';

const SHIRTS = ['Сорочка льон', 'Сорочка льон Premium', 'Prive Сорочка льон біліонер', 'Футболка базова біла'];

describe('titlesMentioned', () => {
  it('finds a title in another case and with words in between', () => {
    expect(titlesMentioned('Для весілля раджу білу сорочку льон Premium.', SHIRTS)).toEqual(['Сорочка льон Premium']);
  });

  it("doesn't also count the shorter title inside a longer one", () => {
    expect(titlesMentioned('Сорочка льон Premium або сорочка Prive льон біліонер', SHIRTS)).toEqual([
      'Prive Сорочка льон біліонер',
      'Сорочка льон Premium',
    ]);
  });

  it('matches short words the stemmer leaves alone («біла» / «білу»)', () => {
    expect(titlesMentioned('Можу запропонувати футболку базову білу.', SHIRTS)).toEqual(['Футболка базова біла']);
  });

  it('needs every word of the title', () => {
    expect(titlesMentioned('Є гарні сорочки з льону.', ['Сорочка льон Premium'])).toEqual([]);
  });
});

describe('productsInToolOutputs', () => {
  it('collects ref and title from any tool output shape', () => {
    const out = productsInToolOutputs([
      { products: [{ ref: 'aaaaaaaa', title: 'Сорочка льон Premium', price: 4500 }] },
      { ref: 'bbbbbbbb', title: 'Сорочка в клітинку', stock: [] },
      { ok: true },
    ]);
    expect([...out.entries()]).toEqual([
      ['aaaaaaaa', 'Сорочка льон Premium'],
      ['bbbbbbbb', 'Сорочка в клітинку'],
    ]);
  });
});
