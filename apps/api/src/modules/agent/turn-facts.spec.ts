import { collectEffects, collectFacts } from './turn-facts';

describe('collectFacts', () => {
  it('collects prices, sizes, colours and titles by key, at any depth', () => {
    const facts = collectFacts([
      {
        title: 'Сорочка льон',
        price: 3300,
        regularPrice: 3800,
        stock: [{ color: 'Чорний', inStockSizes: ['M', 'XXL'], outOfStockSizes: ['S'] }],
        description: 'Ціна 9999 грн у тексті не рахується',
      },
    ]);
    expect(facts.prices.sort()).toEqual([3300, 3800]);
    expect(facts.sizes.sort()).toEqual(['2XL', 'M', 'S']);
    expect(facts.colors).toEqual(['Чорний']);
    expect(facts.titles).toEqual(['Сорочка льон']);
  });
});

describe('collectEffects', () => {
  const placeOrder = { type: 'place_order', checkoutSessionId: 's1' };

  it('keeps staged effects in call order, once each, and skips refusals', () => {
    const { effects, handoff } = collectEffects([
      { toolResults: [{ toolName: 'place_order', output: { ok: true, staged: placeOrder } }] },
      {
        toolResults: [
          { toolName: 'place_order', output: { ok: true, staged: placeOrder } },
          { toolName: 'send_payment_details', output: { ok: false, error: 'cod' } },
        ],
      },
    ]);
    expect(effects).toEqual([placeOrder]);
    expect(handoff).toBeNull();
  });

  it('returns the handoff the model asked for', () => {
    const { handoff } = collectEffects([
      {
        toolResults: [
          { toolName: 'handoff', output: { ok: true, handoff: { reason: 'order_change', summaryForManager: 'x' } } },
        ],
      },
    ]);
    expect(handoff).toEqual({ reason: 'order_change', summaryForManager: 'x' });
  });
});
