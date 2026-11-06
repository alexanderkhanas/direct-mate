import { CatalogReader } from './catalog-reader.service';

describe('CatalogReader tenant scoping', () => {
  const query = jest.fn();
  const findAllByProductIds = jest.fn();
  const reader = new CatalogReader({ query } as never, { findAllByProductIds } as never);

  beforeEach(() => {
    query.mockReset();
    findAllByProductIds.mockReset();
  });

  it('resolves a ref only within the tenant', async () => {
    query.mockResolvedValue([{ id: 'aaaaaaaa-0000-0000-0000-000000000001' }]);
    await expect(reader.resolveProductRef('tenant-1', 'AAAAAAAA')).resolves.toEqual({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
    });
    expect(query.mock.calls[0][0]).toContain('tenant_id = $1');
    expect(query.mock.calls[0][1]).toEqual(['tenant-1', 'aaaaaaaa%']);
  });

  it('reports a ref from another store as unknown', async () => {
    query.mockResolvedValue([]);
    await expect(reader.resolveProductRef('tenant-1', 'bbbbbbbb')).resolves.toEqual({
      error: 'No product with ref "bbbbbbbb" in this store.',
    });
  });

  it('rejects anything that is not a ref before querying, LIKE wildcards included', async () => {
    for (const bad of ['%', 'aaaa%', "aaaaaaaa' OR 1=1", 'p1', '']) {
      await expect(reader.resolveProductRef('tenant-1', bad)).resolves.toHaveProperty('error');
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an ambiguous short ref', async () => {
    query.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(reader.resolveProductRef('tenant-1', 'aaaaaaaa')).resolves.toHaveProperty('error');
  });

  it('hydrates products with the tenant filter and drops rows of other tenants', async () => {
    findAllByProductIds.mockResolvedValue([
      { product: { id: 'mine', title: 'A', imageUrl: null, category: null }, variants: [] },
      { product: { id: 'theirs', title: 'B', imageUrl: null, category: null }, variants: [] },
    ]);
    query.mockResolvedValue([{ id: 'mine' }]);
    const products = await reader.loadProducts('tenant-1', ['mine', 'theirs']);
    expect(findAllByProductIds).toHaveBeenCalledWith(['mine', 'theirs'], { tenantId: 'tenant-1' });
    expect(products.map((p) => p.id)).toEqual(['mine']);
  });
});
