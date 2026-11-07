import { readFileSync } from 'fs';
import { join } from 'path';
import { ConnectionStatus } from '@direct-mate/shared';
import { FeedSyncService } from './feed-sync.service';
import { FeedError, fetchFeed } from './feed-fetcher';

jest.mock('./feed-fetcher', () => {
  const actual = jest.requireActual('./feed-fetcher');
  return { ...actual, fetchFeed: jest.fn() };
});
const fetchMock = fetchFeed as jest.MockedFunction<typeof fetchFeed>;
const RSS = readFileSync(join(__dirname, '__fixtures__', 'gmc-rss.xml'), 'utf8');

function setup(meta: Record<string, unknown> = { url: 'https://shop.example/feed.xml' }, opts: { busy?: boolean } = {}) {
  const connection = { id: 'f1', tenantId: 't1', status: ConnectionStatus.Connected, metadata: meta, lastSyncAt: null };
  const updates: Array<Record<string, any>> = [];
  const connections = {
    findOne: jest.fn(async () => connection),
    update: jest.fn(async (_id: string, patch: Record<string, unknown>) => updates.push(patch)),
  };
  const integrations = {
    queueSyncJob: jest.fn(async () => ({ id: 'j1' })),
    markJobRunning: jest.fn(),
    markJobDone: jest.fn(),
    markJobFailed: jest.fn(),
  };
  const catalog = {
    importCatalog: jest.fn(async () => ({ productsCreated: 2, productsUpdated: 0, productsArchived: 0, errors: [] })),
  };
  const catalogIndex = { invalidate: jest.fn() };
  const attributes = { findStale: jest.fn(async () => []), extract: jest.fn() };
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("status = 'running'")) return opts.busy ? [{ '?column?': 1 }] : [];
      if (sql.includes('subscription_plans')) return [{ products_limit: 500, found: true }];
      return [];
    }),
  };
  const service = new FeedSyncService(
    connections as never,
    integrations as never,
    catalog as never,
    catalogIndex as never,
    attributes as never,
    dataSource as never,
  );
  return { service, connections, updates, integrations, catalog, catalogIndex };
}

const fetched = (body = RSS) => ({
  changed: true,
  format: 'gmc' as const,
  body,
  etag: '"v1"',
  lastModified: null,
  url: 'https://shop.example/feed.xml',
});

describe('FeedSyncService.sync', () => {
  beforeEach(() => fetchMock.mockReset());

  it("imports the feed's products under the feed: prefix and refreshes the agent's catalog", async () => {
    fetchMock.mockResolvedValue(fetched());
    const t = setup();
    expect(await t.service.sync('f1')).toEqual({ status: 'imported' });

    const [tenantId, products, options] = t.catalog.importCatalog.mock.calls[0] as unknown as [string, Array<{ externalProductId: string }>, unknown];
    expect(tenantId).toBe('t1');
    expect(products.map((p) => p.externalProductId)).toEqual(['feed:1001', 'feed:2002']);
    expect(options).toEqual({ idPrefix: 'feed:', archiveMissing: true });
    expect(t.catalogIndex.invalidate).toHaveBeenCalledWith('t1');
    expect(t.updates.at(-1)).toMatchObject({
      status: ConnectionStatus.Connected,
      metadata: { etag: '"v1"', lastItemCount: 2, payloadHash: expect.any(String), lastError: null },
    });
  });

  it('writes nothing when the products are the same as last time, even with a new ETag', async () => {
    fetchMock.mockResolvedValue(fetched());
    const first = setup();
    await first.service.sync('f1');
    const hash = first.updates.at(-1)!.metadata.payloadHash;

    fetchMock.mockResolvedValue({ ...fetched(), etag: '"v2"' });
    const again = setup({ url: 'https://shop.example/feed.xml', payloadHash: hash, lastItemCount: 2 });
    expect(await again.service.sync('f1')).toEqual({ status: 'unchanged' });
    expect(again.catalog.importCatalog).not.toHaveBeenCalled();
    expect(again.integrations.markJobDone).toHaveBeenCalledWith('j1', { unchanged: true });
  });

  it('asks the server whether anything changed and stops on 304', async () => {
    fetchMock.mockResolvedValue({ ...fetched(), changed: false, body: '' });
    const t = setup({ url: 'https://shop.example/feed.xml', etag: '"v1"' });
    expect(await t.service.sync('f1')).toEqual({ status: 'unchanged' });
    expect(fetchMock).toHaveBeenCalledWith('https://shop.example/feed.xml', { etag: '"v1"', lastModified: undefined });
    expect(t.catalog.importCatalog).not.toHaveBeenCalled();
  });

  it("doesn't archive anything when a feed suddenly has far fewer products", async () => {
    fetchMock.mockResolvedValue(fetched());
    const t = setup({ url: 'https://shop.example/feed.xml', lastItemCount: 10, payloadHash: 'old' });
    await t.service.sync('f1');
    expect((t.catalog.importCatalog.mock.calls[0] as unknown[])[2]).toEqual({ idPrefix: 'feed:', archiveMissing: false });
    expect(t.updates.at(-1)!.metadata).toMatchObject({
      lastItemCount: 10,
      warnings: expect.arrayContaining([{ code: 'partial_feed', count: 8 }]),
    });
  });

  it("doesn't start while the same feed is already syncing", async () => {
    const t = setup(undefined, { busy: true });
    expect(await t.service.sync('f1')).toEqual({ status: 'already_running' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records why a sync failed, for the owner to see', async () => {
    fetchMock.mockRejectedValue(new FeedError('not_public', 'The link answered 403'));
    const t = setup();
    expect(await t.service.sync('f1')).toEqual({ status: 'failed' });
    expect(t.updates.at(-1)).toMatchObject({
      status: ConnectionStatus.Error,
      metadata: { lastError: { code: 'not_public', message: 'The link answered 403' } },
    });
    expect(t.integrations.markJobFailed).toHaveBeenCalledWith('j1', 'not_public: The link answered 403');
  });
});
