import { updateOrderDraftTool } from './order.tools';
import type { AgentProduct } from '../catalog/catalog-reader.service';
import type { AgentStoreSettings } from '../store-settings.service';
import type { AgentToolDeps, ToolScope } from './tool-deps';

const SCOPE: ToolScope = { tenantId: 't1', conversationId: 'c1', customerId: 'u1' };
const CALL = { toolCallId: 'call-1', messages: [] } as never;

const TROUSERS: AgentProduct = {
  id: 'e10fd211-0000-0000-0000-000000000000',
  ref: 'e10fd211',
  title: 'Штани з затяжками',
  category: 'Брюки',
  brand: null,
  material: null,
  gender: null,
  season: null,
  modelName: null,
  description: null,
  imageUrl: null,
  attributes: {},
  variants: [
    { id: 'v-black-m', color: 'Чорний', size: 'M', price: 3200, regularPrice: null, currency: 'UAH', available: 2, imageUrl: null },
  ],
};

function addItem(input: Record<string, unknown>) {
  const draft = {
    status: 'collecting',
    items: [{ variantId: 'v-black-m', productId: TROUSERS.id, title: TROUSERS.title, color: 'Чорний', size: 'M', qty: 1, unitPrice: 3200 }],
    total: 3200,
    currency: 'UAH',
    customer: {},
    missingFields: [],
    paymentDetailsSentAt: null,
    complete: false,
  };
  const deps = {
    catalog: {
      resolveProductRef: async () => ({ id: TROUSERS.id }),
      loadProducts: async () => [TROUSERS],
    },
    drafts: { update: async () => ({ ok: true, draft }) },
  } as unknown as AgentToolDeps;
  const settings = { checkoutFields: [] } as unknown as AgentStoreSettings;
  return updateOrderDraftTool(deps, SCOPE, settings).execute!({ addItem: input } as never, CALL) as unknown as Promise<
    Record<string, unknown>
  >;
}

describe('update_order_draft: picks from a story, post or reel', () => {
  it('stages the pick, with the chosen colour, when the customer chose it as the item shown', async () => {
    const out = await addItem({ productRef: 'e10fd211', color: 'Чорний', size: 'M', fromContent: true });
    expect(out).toMatchObject({ ok: true, staged: { type: 'content_pick', productId: TROUSERS.id, color: 'Чорний' } });
  });

  it('stages nothing for an alternative', async () => {
    expect(await addItem({ productRef: 'e10fd211', color: 'Чорний', size: 'M' })).not.toHaveProperty('staged');
    expect(await addItem({ productRef: 'e10fd211', color: 'Чорний', size: 'M', fromContent: false })).not.toHaveProperty('staged');
  });
});
