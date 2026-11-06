import { CheckoutSessionStatus } from '@direct-mate/shared';
import { returnedRows } from '../../common/db';
import { missingDraftFields, normalizePhone, OrderDraftService } from './order-draft.service';

describe('normalizePhone', () => {
  it.each([
    ['+380 67 123 45 67', '+380671234567'],
    ['067-123-45-67', '+380671234567'],
    ['380671234567', '+380671234567'],
    ['+48 512 345 678', '+48512345678'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['12345', 'мій номер', '67 123 45 67'])('rejects %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe('missingDraftFields', () => {
  const customer = { fullName: 'Іван Петренко', phone: null, city: 'Київ', branch: null, paymentMethod: null, comment: null };

  it('lists required fields still empty, and items when there are none', () => {
    expect(missingDraftFields([], customer, ['fullName', 'phone', 'city', 'novaPoshtaBranch'])).toEqual([
      'items',
      'phone',
      'novaPoshtaBranch',
    ]);
  });
});

/**
 * placeOrder against a fake transaction: each test scripts the rows the SQL
 * would return, keyed by a fragment of the statement.
 */
describe('OrderDraftService.placeOrder', () => {
  type Rows = Array<Record<string, unknown>>;
  function setup(responses: Array<[string, Rows]>, opts: { failWith?: Error } = {}) {
    const executed: string[] = [];
    const query = jest.fn(async (sql: string) => {
      executed.push(sql);
      return responses.find(([fragment]) => sql.includes(fragment))?.[1] ?? [];
    });
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => {
        if (opts.failWith) throw opts.failWith;
        return cb({ query });
      }),
      manager: { query },
    };
    return { service: new OrderDraftService(dataSource as never), executed };
  }

  const READY: [string, Rows] = [
    'FROM checkout_sessions',
    [{ status: CheckoutSessionStatus.ReadyForDraftOrder, customer_id: 'c1' }],
  ];

  it('returns the existing order instead of creating a second one', async () => {
    const { service, executed } = setup([READY, ['FROM orders', [{ id: 'order-1' }]]]);
    await expect(service.placeOrder('t1', 's1', 'instagram_ai')).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
      alreadyPlaced: true,
    });
    expect(executed.some((sql) => sql.includes('INSERT INTO orders'))).toBe(false);
  });

  it('refuses a draft that is not complete', async () => {
    const { service } = setup([
      ['FROM checkout_sessions', [{ status: CheckoutSessionStatus.CollectingCustomerInfo, customer_id: 'c1' }]],
    ]);
    await expect(service.placeOrder('t1', 's1', 'instagram_ai')).resolves.toEqual({
      ok: false,
      error: 'The order draft is not complete yet.',
    });
  });

  it('refuses when an item sold out since it was added', async () => {
    const { service } = setup([
      READY,
      ['FROM checkout_items', [{ title: 'Сорочка льон', qty: 1, available: '0', unit_price: '3300', currency: 'UAH' }]],
    ]);
    await expect(service.placeOrder('t1', 's1', 'instagram_ai')).resolves.toEqual({
      ok: false,
      error: 'No longer in stock: Сорочка льон.',
    });
  });

  it('creates the order, its items and closes the draft', async () => {
    const { service, executed } = setup([
      READY,
      [
        'FROM checkout_items',
        [{ product_id: 'p1', variant_id: 'v1', title: 'A', qty: 2, available: '5', unit_price: '3300', currency: 'UAH' }],
      ],
      ['INSERT INTO orders', [{ id: 'order-2' }]],
    ]);
    await expect(service.placeOrder('t1', 's1', 'instagram_ai')).resolves.toEqual({
      ok: true,
      orderId: 'order-2',
      alreadyPlaced: false,
    });
    expect(executed.filter((sql) => sql.includes('INSERT INTO order_items'))).toHaveLength(1);
    expect(executed.some((sql) => sql.includes('UPDATE checkout_sessions SET status'))).toBe(true);
  });

  it('returns the winner of a concurrent placement that hit the unique index', async () => {
    const raced = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { service } = setup([['FROM orders', [{ id: 'order-3' }]]], { failWith: raced });
    await expect(service.placeOrder('t1', 's1', 'instagram_ai')).resolves.toEqual({
      ok: true,
      orderId: 'order-3',
      alreadyPlaced: true,
    });
  });
});

describe('returnedRows', () => {
  it('unwraps the [rows, affectedCount] shape the driver returns for UPDATE and DELETE', () => {
    expect(returnedRows([[], 0])).toEqual([]);
    expect(returnedRows([[{ id: 's1' }], 1])).toEqual([{ id: 's1' }]);
  });

  it('passes SELECT and INSERT rows through, even two of them', () => {
    expect(returnedRows([{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('OrderDraftService.claimPaymentDetailsSend', () => {
  it('is true exactly when the row was updated', async () => {
    // The real driver's shape for UPDATE … RETURNING: [rows, affectedCount].
    const query = jest.fn().mockResolvedValueOnce([[{ id: 's1' }], 1]).mockResolvedValueOnce([[], 0]);
    const service = new OrderDraftService({ query } as never);
    await expect(service.claimPaymentDetailsSend('t1', 's1')).resolves.toBe(true);
    await expect(service.claimPaymentDetailsSend('t1', 's1')).resolves.toBe(false);
    expect(query.mock.calls[0][0]).toContain('payment_details_sent_at IS NULL');
  });
});
