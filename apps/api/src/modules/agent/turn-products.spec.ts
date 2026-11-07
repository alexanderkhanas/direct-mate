import { productsInReply } from './turn-products';
import { formatCatalogOverview } from './catalog/catalog-index.service';
import type { AgentStepRecord } from './agent.types';

const step = (
  toolCalls: AgentStepRecord['toolCalls'],
  toolResults: AgentStepRecord['toolResults'],
): AgentStepRecord => ({ attempt: 1, text: '', finishReason: 'tool-calls', toolCalls, toolResults });

describe('productsInReply', () => {
  const search = step(
    [{ toolName: 'search_products', input: { query: 'сорочка' } }],
    [
      {
        toolName: 'search_products',
        output: {
          products: [
            { ref: '5d041fb6', title: 'Сорочка льон', price: 3300 },
            { ref: '007ad88f', title: 'Сорочка льон Premium', price: 4500 },
            { ref: 'aaaa1111', title: 'Сорочка в клітинку', price: 3100 },
          ],
        },
      },
    ],
  );

  it('keeps the listed products the reply names, in any word form', () => {
    const reply = 'Є дві: • Сорочка з льону — 3300 грн • Сорочка з льону Premium — 4500 грн.';
    expect(productsInReply([search], reply)).toEqual([
      { ref: '5d041fb6', title: 'Сорочка льон' },
      { ref: '007ad88f', title: 'Сорочка льон Premium' },
    ]);
  });

  it('counts products looked up, shown or added to the order, even when the reply only says «ця»', () => {
    const lookups = step(
      [
        { toolName: 'get_product', input: { productRef: '5d041fb6' } },
        { toolName: 'update_order_draft', input: { addItem: { productRef: '007ad88f', size: 'M' } } },
      ],
      [
        { toolName: 'get_product', output: { ref: '5d041fb6', title: 'Сорочка льон' } },
        { toolName: 'update_order_draft', output: { draft: { items: [{ productRef: '007ad88f', title: 'Сорочка льон Premium' }] } } },
      ],
    );
    expect(productsInReply([lookups], 'Додала, ось вона.').map((p) => p.ref)).toEqual(['5d041fb6', '007ad88f']);
  });

  it('ignores refs no tool returned and listed products the reply does not name', () => {
    const bogus = step([{ toolName: 'get_product', input: { productRef: 'deadbeef' } }], []);
    expect(productsInReply([search, bogus], 'Підкажіть розмір?')).toEqual([]);
  });
});

describe('formatCatalogOverview', () => {
  it('summarises categories with counts, in-stock price ranges and sold-out products', () => {
    const row = (product_id: string, category: string, price: string, available: string) => ({
      product_id,
      title: product_id,
      category,
      color: null,
      price,
      sale_price: null,
      currency: 'UAH',
      available,
    });
    expect(
      formatCatalogOverview([
        row('p1', 'Сорочки', '3300', '2'),
        row('p2', 'Сорочки', '4500', '1'),
        row('p3', 'Сорочки', '2900', '0'),
        row('p4', 'Брюки', '3500', '5'),
      ]),
    ).toBe('- Сорочки: 3 товари, 3300 грн–4500 грн (1 немає в наявності)\n- Брюки: 1 товар, 3500 грн');
  });
});
