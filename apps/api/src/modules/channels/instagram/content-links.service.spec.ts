import { ContentLinksService } from './content-links.service';

/**
 * The SQL carries the rules, so these pin its shape. The behaviour was checked
 * against Postgres (owner beats code, a rejection is never undone, another
 * store's ids link nothing); keep these clauses when changing the queries.
 */
function setup(result: unknown = [{ id: 'l1' }]) {
  const query = jest.fn(async (_sql: string, _params?: unknown[]): Promise<unknown> => result);
  return { links: new ContentLinksService({ query } as never), query };
}

describe('ContentLinksService', () => {
  it('lets code add or upgrade only a suggestion, and only for this store', async () => {
    const { links, query } = setup();
    await links.autoLink('t1', { mediaId: 's1' }, { productId: 'p1', color: null, source: 'caption_sku', status: 'confirmed' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/JOIN products p ON p\.id = \$3 AND p\.tenant_id = \$1/);
    expect(sql).toMatch(/WHERE m\.tenant_id = \$1 AND m\.instagram_media_id = \$2/);
    expect(sql).toMatch(/ON CONFLICT \(mapping_id, product_id, \(coalesce\(color, ''\)\)\) DO UPDATE SET/);
    // A confirmed or rejected pair is the owner's (or certain): untouched.
    expect(sql).toMatch(/WHERE content_products\.status = 'suggested'/);
    expect(params).toEqual(['t1', 's1', 'p1', null, 'caption_sku', 'confirmed', null, '{}']);
  });

  it('targets our row id when given one', async () => {
    const { links, query } = setup();
    await links.autoLink('t1', { mappingId: 'm1' }, { productId: 'p1', color: 'Чорний', source: 'vision', status: 'suggested', confidence: 0.8 });
    expect(query.mock.calls[0][0]).toMatch(/WHERE m\.tenant_id = \$1 AND m\.id = \$2::uuid/);
  });

  it("says whether anything changed, from UPDATE's [rows, count] or INSERT's rows", async () => {
    expect(await setup([[], 0]).links.autoLink('t1', { mediaId: 's1' }, { productId: 'p1', color: null, source: 'vision', status: 'suggested' })).toBe(false);
    expect(await setup([{ id: 'l1' }]).links.autoLink('t1', { mediaId: 's1' }, { productId: 'p1', color: null, source: 'vision', status: 'suggested' })).toBe(true);
    expect(await setup([[{ id: 'l1' }], 1]).links.setStatus('t1', 'l1', 'rejected')).toBe(true);
    expect(await setup([[], 0]).links.setStatus('t1', 'l1', 'rejected')).toBe(false);
  });

  it("confirms the owner's link even over a rejection, keeping a suggestion's source", async () => {
    const { links, query } = setup();
    expect(await links.ownerLink('t1', 'm1', 'p1', null)).toBe('l1');
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE m\.tenant_id = \$1 AND m\.id = \$2::uuid/);
    expect(sql).toMatch(/status = 'confirmed',\s+source = CASE WHEN content_products\.status = 'rejected' THEN 'manual' ELSE content_products\.source END/);
  });

  it('scopes the owner changing a status to their store', async () => {
    const { links, query } = setup([[{ id: 'l1' }], 1]);
    await links.setStatus('t1', 'l1', 'confirmed');
    expect(query.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
  });

  it('adds a pick once per conversation, never on a rejected pair, never changing the status', async () => {
    const { links, query } = setup();
    await links.addPick('t1', { mediaId: 's1' }, { productId: 'p1', color: 'Чорний', conversationId: 'c1' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/'conversation', 'suggested'/);
    expect(sql).toMatch(/WHERE content_products\.status <> 'rejected'/);
    expect(sql).toMatch(/AND NOT coalesce\(content_products\.evidence->'picks', '\[\]'::jsonb\)\s+@> jsonb_build_array\(jsonb_build_object\('conversationId', \$5::text\)\)/);
    expect(sql).not.toMatch(/DO UPDATE SET[\s\S]*status =/);
    expect(params).toEqual(['t1', 's1', 'p1', 'Чорний', 'c1']);
  });

  it("marks an order only on that conversation's picks of products in the order", async () => {
    const { links, query } = setup([[{ id: 'l1', status: 'suggested', owner_asked_at: null }], 1]);
    expect(await links.addOrder('t1', 'c1', { orderId: 'o1', checkoutSessionId: 's1' })).toEqual([
      { id: 'l1', status: 'suggested', ownerAskedAt: null },
    ]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/cp\.product_id IN \(SELECT ci\.product_id FROM checkout_items ci WHERE ci\.checkout_session_id = \$4::uuid\)/);
    expect(sql).toMatch(/cp\.status <> 'rejected'/);
    expect(sql).not.toMatch(/SET status/);
    expect(params).toEqual(['t1', 'c1', 'o1', 's1']);
  });
});
