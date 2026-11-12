import { FindOperator } from 'typeorm';
import { safeFetch, SafeFetchOptions } from '../../../common/safe-fetch';
import { InstagramContentService } from './instagram-content.service';
import { InstagramMediaMapping } from './entities/instagram-media-mapping.entity';

jest.mock('../../../common/safe-fetch', () => ({ ...jest.requireActual('../../../common/safe-fetch'), safeFetch: jest.fn() }));
const safeFetchMock = safeFetch as jest.MockedFunction<typeof safeFetch>;

const TENANT = 'tenant-1';

type Row = Partial<InstagramMediaMapping> & { id: string; tenantId: string; instagramMediaId: string };

function row(id: string, fields: Partial<InstagramMediaMapping> = {}): Row {
  return {
    id,
    tenantId: TENANT,
    instagramMediaId: `media-${id}`,
    mediaType: 'image',
    productId: null,
    variantId: null,
    linkedColor: null,
    caption: null,
    matchMethod: null,
    confirmed: false,
    ...fields,
  };
}

/**
 * Filters rows the way TypeORM 0.3 reads `find` options: an `undefined` key is
 * skipped (proven against the real query builder below), an array is OR.
 */
function matches(r: Row, where: unknown): boolean {
  if (Array.isArray(where)) return where.some((w) => matches(r, w));
  return Object.entries(where as Record<string, unknown>).every(([key, value]) => {
    if (value === undefined) return true;
    const actual = (r as Record<string, unknown>)[key] ?? null;
    return value instanceof FindOperator ? applyOperator(actual, value) : actual === value;
  });
}

function applyOperator(actual: unknown, op: FindOperator<unknown>): boolean {
  switch (op.type) {
    case 'isNull':
      return actual === null;
    case 'not':
      return op.child ? !applyOperator(actual, op.child) : actual !== op.value;
    case 'equal':
      return actual === op.value;
    case 'in':
      return (op.value as unknown as unknown[]).includes(actual);
    default:
      throw new Error(`Operator ${op.type} not supported by the fake`);
  }
}

/** A query builder that returns `result` and keeps the conditions it was given. */
function chain<T>(result: T, conditions: string[] = []) {
  const qb: Record<string, unknown> = {};
  for (const m of ['select', 'innerJoin', 'leftJoinAndSelect', 'orderBy', 'limit']) qb[m] = () => qb;
  for (const m of ['where', 'andWhere']) {
    qb[m] = (condition: string) => {
      conditions.push(condition);
      return qb;
    };
  }
  qb.getMany = async () => result;
  return qb;
}

interface Graph {
  stories?: Record<string, unknown[]>;
  /** Pages of `/media`, per Instagram account id. */
  media?: Record<string, unknown[][]>;
  /** Accounts whose Graph calls throw (a network error). */
  failing?: string[];
  /** Accounts whose posts call throws. */
  failingPosts?: string[];
}

function setup(opts: {
  rows?: Row[];
  products?: Array<{ id: string; sku: string }>;
  variants?: Array<{ id: string; sku: string; productId: string; color: string | null }>;
  connections?: Array<{ tenantId: string; externalAccountId: string }>;
  graph?: Graph;
  workerEnabled?: boolean;
  /** `pausedUntil` of the app-wide Graph budget pause, when one is on. */
  pausedUntil?: string;
  /** What the SKU pass's query returns. */
  skuRows?: Row[];
  /** What ContentLinksService.autoLink answers: false when the pair was linked or rejected meanwhile. */
  autoLinked?: boolean;
} = {}) {
  const rows = opts.rows ?? [];
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const connections = (opts.connections ?? [{ tenantId: TENANT, externalAccountId: 'ig-1' }]).map((c) => ({
    ...c,
    accessTokenEncrypted: `enc-${c.externalAccountId}`,
  }));

  const mappingRepo = {
    find: jest.fn(async ({ where }: { where: unknown }) => rows.filter((r) => matches(r, where))),
    findOne: jest.fn(async ({ where }: { where: unknown }) => rows.find((r) => matches(r, where)) ?? null),
    update: jest.fn(async (criteria: unknown, patch: Partial<Row>) => {
      const where = typeof criteria === 'string' ? { id: criteria } : criteria;
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
    save: jest.fn(async (r: Row) => r),
    createQueryBuilder: jest.fn(() => chain(opts.skuRows ?? [], skuConditions)),
  };
  const skuConditions: string[] = [];
  const links = { autoLink: jest.fn(async () => opts.autoLinked ?? true) };
  const verifier = { checkNewStories: jest.fn(async (_tenantId: string, _ids: string[]) => undefined) };
  const connectionRepo = {
    find: jest.fn(async () => connections),
    findOne: jest.fn(async ({ where }: { where: { tenantId: string } }) => connections.find((c) => c.tenantId === where.tenantId) ?? null),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown> => {
      statements.push({ sql, params });
      if (sql.includes('INSERT INTO instagram_media_mappings')) {
        const existing = rows.find((r) => r.tenantId === params[0] && r.instagramMediaId === params[1]);
        if (existing) return [{ inserted: false }];
        rows.push(row(`new-${rows.length}`, { tenantId: params[0] as string, instagramMediaId: params[1] as string, mediaType: params[2] as string, matchMethod: 'bulk_import' }));
        return [{ inserted: true }];
      }
      if (sql.includes('FROM app_state')) return opts.pausedUntil ? [{ paused_until: opts.pausedUntil }] : [];
      if (sql.includes("match_method = 'bulk_import'")) {
        return [{ found: rows.some((r) => r.tenantId === params[0] && r.matchMethod === 'bulk_import' && r.mediaType !== 'story') }];
      }
      return [];
    }),
  };
  const config = {
    get: (key: string) => {
      if (key === 'contentFetch.workerEnabled') return opts.workerEnabled ?? true;
      if (key === 'openai.apiKey') return 'test-key';
      return undefined;
    },
  };
  const crypto = { decrypt: (enc: string) => enc.replace('enc-', 'token-') };

  const service = new InstagramContentService(
    mappingRepo as never,
    connectionRepo as never,
    { createQueryBuilder: () => chain(opts.products ?? []) } as never,
    { createQueryBuilder: () => chain(opts.variants ?? []) } as never,
    { findOne: async () => null } as never,
    crypto as never,
    config as never,
    {} as never,
    {} as never,
    dataSource as never,
    links as never,
    verifier as never,
  );

  const graph = opts.graph ?? {};
  const fetchMock = jest.fn(async (input: string) => {
    const url = new URL(input);
    const [, , account, edge] = url.pathname.split('/');
    if (graph.failing?.includes(account)) throw new Error('socket hang up');
    if (edge === 'media' && graph.failingPosts?.includes(account)) throw new Error('socket hang up');
    const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (edge === 'stories') return respond({ data: graph.stories?.[account] ?? [] });
    if (edge === 'media') {
      const pages = graph.media?.[account] ?? [[]];
      const page = Number(url.searchParams.get('after') ?? 0);
      const next = page + 1 < pages.length ? page + 1 : null;
      return respond({
        data: pages[page],
        paging: next === null ? {} : { cursors: { after: String(next) }, next: `${url.origin}${url.pathname}?after=${next}` },
      });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  global.fetch = fetchMock as never;

  return { service, rows, statements, mappingRepo, connectionRepo, dataSource, fetchMock, links, skuConditions, verifier };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

const skuPass = (service: InstagramContentService) =>
  (service as unknown as { matchSkusInCaptions(tenantId: string): Promise<number> }).matchSkusInCaptions(TENANT);

describe('SKU pass', () => {
  it('asks only for captioned content with no link at all, never a row added by hand or a customer photo', async () => {
    const { service, skuConditions } = setup();
    await skuPass(service);
    expect(skuConditions).toEqual(
      expect.arrayContaining([
        'm.tenant_id = :tenantId',
        'm.caption IS NOT NULL',
        `(m.match_method IS NULL OR m.match_method = 'bulk_import')`,
        `m.media_type <> 'customer_photo'`,
        // A rejected link counts: a pair the owner said no to stays off.
        'NOT EXISTS (SELECT 1 FROM content_products cp WHERE cp.mapping_id = m.id)',
      ]),
    );
  });

  it('links a product SKU for every colour and a variant SKU in its colour, as certain', async () => {
    const fetched = row('fetched', { matchMethod: 'bulk_import', caption: 'Нова сукня. Артикул: SKU-2' });
    const shared = row('shared', { mediaType: 'post', caption: 'SKU-3V у чорному' });
    const { service, links } = setup({
      skuRows: [fetched, shared],
      products: [{ id: 'product-2', sku: 'SKU-2' }],
      variants: [{ id: 'variant-3', sku: 'SKU-3V', productId: 'product-3', color: 'Чорний' }],
    });

    expect(await skuPass(service)).toBe(2);
    expect(links.autoLink).toHaveBeenCalledWith(TENANT, { mappingId: 'fetched' }, {
      productId: 'product-2',
      color: null,
      source: 'caption_sku',
      status: 'confirmed',
    });
    expect(links.autoLink).toHaveBeenCalledWith(TENANT, { mappingId: 'shared' }, {
      productId: 'product-3',
      color: 'Чорний',
      source: 'caption_sku',
      status: 'confirmed',
    });
  });

  it("doesn't count a pair that was linked or rejected after the row was read", async () => {
    const fetched = row('fetched', { matchMethod: 'bulk_import', caption: 'Артикул: SKU-2' });
    const { service } = setup({ skuRows: [fetched], products: [{ id: 'product-2', sku: 'SKU-2' }], autoLinked: false });
    expect(await skuPass(service)).toBe(0);
  });
});

const post = (id: string, extra: Record<string, unknown> = {}) => ({ id, media_type: 'IMAGE', media_url: `https://cdn/${id}.jpg`, caption: `пост ${id}`, ...extra });
const story = (id: string) => ({ id, media_type: 'IMAGE', media_url: `https://cdn/${id}.jpg`, timestamp: '2026-11-11T08:00:00+0000' });
const mediaCalls = (fetchMock: jest.Mock, account = 'ig-1') =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(`/${account}/media`));

describe('scheduled fetch', () => {
  it('does nothing when CONTENT_FETCH_WORKER_ENABLED is off', async () => {
    const { service, connectionRepo, fetchMock } = setup({ workerEnabled: false });
    await service.tick();
    expect(connectionRepo.find).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads posts on the first tick and stories only on the next one', async () => {
    const { service, fetchMock } = setup({ rows: [row('old', { matchMethod: 'bulk_import' })] });
    await service.tick();
    expect(mediaCalls(fetchMock)).toHaveLength(1);
    fetchMock.mockClear();
    await service.tick();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([expect.stringContaining('/ig-1/stories')]);
  });

  it("doesn't start a run while the last one is still going", async () => {
    const { service, connectionRepo } = setup();
    let release!: () => void;
    connectionRepo.find.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve([]))));
    const first = service.tick();
    await service.tick();
    await new Promise((r) => setImmediate(r));
    release();
    await first;
    expect(connectionRepo.find).toHaveBeenCalledTimes(1);
  });

  it("carries on with the next store when one store's fetch fails", async () => {
    const { service, rows } = setup({
      connections: [
        { tenantId: 'tenant-a', externalAccountId: 'ig-a' },
        { tenantId: 'tenant-b', externalAccountId: 'ig-b' },
      ],
      graph: { failing: ['ig-a'], stories: { 'ig-b': [story('s-b')] }, media: { 'ig-b': [[post('p-b')]] } },
    });

    await service.fetchAllStores({ posts: true });

    expect(rows.filter((r) => r.tenantId === 'tenant-b').map((r) => r.instagramMediaId).sort()).toEqual(['p-b', 's-b']);
  });

  it('pages on through new posts and stops at the first page with a post it already has', async () => {
    const { service, fetchMock, rows } = setup({
      rows: [row('known', { instagramMediaId: 'p3', matchMethod: 'bulk_import' })],
      graph: { media: { 'ig-1': [[post('p1'), post('p2')], [post('p3'), post('p4')], [post('p5')]] } },
    });

    await service.fetchAllStores({ posts: true });

    expect(mediaCalls(fetchMock)).toHaveLength(2);
    expect(rows.map((r) => r.instagramMediaId)).not.toContain('p5');
  });

  it('pages through everything (up to the cap) when no post was ever fetched, whatever a customer brought up', async () => {
    const { service, fetchMock, rows } = setup({
      rows: [
        row('shared-by-customer', { instagramMediaId: 'p1', mediaType: 'post' }),
        row('fetched-story', { instagramMediaId: 's0', mediaType: 'story', matchMethod: 'bulk_import' }),
      ],
      graph: { media: { 'ig-1': [[post('p1'), post('p2')], [post('p3')]] } },
    });

    await service.fetchAllStores({ posts: true });

    expect(mediaCalls(fetchMock)).toHaveLength(2);
    expect(rows.map((r) => r.instagramMediaId)).toEqual(expect.arrayContaining(['p2', 'p3']));
  });

  it("refreshes a stored item's type, cover and product type", async () => {
    const reel = post('r1', { media_type: 'VIDEO', media_product_type: 'REELS', thumbnail_url: 'https://cdn/r1-cover.jpg' });
    const { service, statements } = setup({
      rows: [row('shared', { instagramMediaId: 'r1', mediaType: 'post' }), row('old', { matchMethod: 'bulk_import' })],
      graph: { media: { 'ig-1': [[reel]] } },
    });

    await service.fetchAllStores({ posts: true });

    const upsert = statements.find((s) => s.sql.includes('INSERT INTO instagram_media_mappings') && s.params[1] === 'r1')!;
    expect(upsert.sql).toMatch(/ON CONFLICT \(tenant_id, instagram_media_id\) DO UPDATE SET/);
    expect(upsert.sql).toMatch(/media_type = EXCLUDED\.media_type/);
    expect(upsert.sql).toMatch(/thumbnail_url = coalesce\(EXCLUDED\.thumbnail_url/);
    expect(upsert.sql).toMatch(/media_product_type = coalesce\(EXCLUDED\.media_product_type/);
    expect(upsert.params.slice(0, 3)).toEqual([TENANT, 'r1', 'video']);
    expect(upsert.params).toEqual(expect.arrayContaining(['https://cdn/r1-cover.jpg', 'REELS']));
  });

  it('runs the visual check for new stories after every store is fetched', async () => {
    const order: string[] = [];
    const { service, fetchMock, verifier } = setup({
      connections: [
        { tenantId: 'tenant-a', externalAccountId: 'ig-a' },
        { tenantId: 'tenant-b', externalAccountId: 'ig-b' },
      ],
      graph: { stories: { 'ig-a': [story('s-a')], 'ig-b': [story('s-b')] } },
    });
    fetchMock.mockImplementation(((impl) => async (u: string) => {
      order.push(`fetch ${new URL(u).pathname.split('/')[2]}`);
      return impl(u);
    })(fetchMock.getMockImplementation()!));
    verifier.checkNewStories.mockImplementation(async (tenantId: string, ids: string[]) => {
      order.push(`vision ${tenantId} ${ids.join(',')}`);
    });

    await service.fetchAllStores({ posts: false });

    expect(order).toEqual(['fetch ig-a', 'fetch ig-b', 'vision tenant-a s-a', 'vision tenant-b s-b']);
  });
});

describe('scheduled fetch, when Graph misbehaves', () => {
  it("waits out the app-wide pause on Meta's call budget", async () => {
    const { service, connectionRepo, fetchMock, statements } = setup({ pausedUntil: '2026-11-11T20:00:00+00:00' });
    await service.tick();
    expect(connectionRepo.find).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(statements.find((s) => s.sql.includes('FROM app_state'))!.params).toEqual(['instagram_history_budget']);
  });

  it('still sends the new stories to the visual check when the posts fetch fails', async () => {
    const { service, verifier } = setup({ graph: { stories: { 'ig-1': [story('s1')] }, failingPosts: ['ig-1'] } });
    await service.fetchAllStores({ posts: true });
    expect(verifier.checkNewStories).toHaveBeenCalledWith(TENANT, ['s1']);
  });

  it('gives every Graph call a timeout', async () => {
    const { service, fetchMock } = setup({ graph: { stories: { 'ig-1': [story('s1')] }, media: { 'ig-1': [[post('p1')]] } } });
    await service.fetchAllStores({ posts: true });
    await service.getMediaDetails(TENANT, 'p1');
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.length).toBe(3);
    for (const [, init] of calls) expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('media details', () => {
  it("tells Graph refusing a media (another account's, or gone) from a brief failure", async () => {
    const { service, fetchMock } = setup();
    const graphError = (status: number, error: Record<string, number>) => ({ ok: false, status, json: async () => ({ error }) });
    fetchMock.mockImplementation((async (input: string) => {
      const id = new URL(input).pathname.split('/')[2];
      if (id === 'net') throw new Error('socket hang up');
      return (
        {
          gone: graphError(400, { code: 100, error_subcode: 33 }),
          private: graphError(400, { code: 10 }),
          denied: graphError(403, { code: 200 }),
          throttled: graphError(400, { code: 4 }),
          broken: graphError(500, { code: 2 }),
          ok: { ok: true, status: 200, json: async () => ({ id: 'ok', media_type: 'IMAGE', media_url: 'https://cdn/ok.jpg' }) },
        } as Record<string, unknown>
      )[id];
    }) as never);

    const refused = async (id: string) => {
      const read = await service.readMediaDetails(TENANT, id);
      return read.details ? 'read' : read.refused;
    };
    expect(await refused('gone')).toBe(true);
    expect(await refused('private')).toBe(true);
    expect(await refused('denied')).toBe(true);
    expect(await refused('throttled')).toBe(false);
    expect(await refused('broken')).toBe(false);
    expect(await refused('net')).toBe(false);
    expect(await refused('ok')).toBe('read');
    expect(await service.getMediaDetails(TENANT, 'gone')).toBeNull();
  });

  it('counts a store without a connection as refused: there is no way to ask', async () => {
    const { service } = setup({ connections: [] });
    expect(await service.readMediaDetails(TENANT, 'p1')).toEqual({ details: null, refused: true });
  });
});

describe('saving our copy of content', () => {
  it('fills an empty image path, and replaces only the one known to be gone', async () => {
    const { service, statements } = setup();
    await service.saveContentImage(TENANT, 'p1', '/uploads/content-media/t/new.jpg');
    await service.saveContentImage(TENANT, 'p1', '/uploads/content-media/t/new.jpg', '/uploads/content-media/t/gone.jpg');
    const [plain, healing] = statements.filter((s) => s.sql.includes('UPDATE instagram_media_mappings SET image_path'));
    expect(plain.sql).toMatch(/AND \(image_path IS NULL OR image_path = \$4::text\)/);
    expect(plain.params[3]).toBeNull();
    expect(healing.params[3]).toBe('/uploads/content-media/t/gone.jpg');

    await service.saveUnlinkedMedia(TENANT, 's1', 'story', { imagePath: '/uploads/content-media/t/new.jpg' }, '/uploads/content-media/t/gone.jpg');
    const upsert = statements.find((s) => s.sql.includes('INSERT INTO instagram_media_mappings') && s.params[1] === 's1')!;
    expect(upsert.sql).toMatch(
      /image_path = CASE WHEN instagram_media_mappings\.image_path IS NOT DISTINCT FROM \$10::text THEN EXCLUDED\.image_path\s+ELSE coalesce\(instagram_media_mappings\.image_path, EXCLUDED\.image_path\) END/,
    );
    expect(upsert.params[9]).toBe('/uploads/content-media/t/gone.jpg');
  });
});

describe('vision images', () => {
  afterEach(() => safeFetchMock.mockReset());

  it('downloads a picture with a size cap, and never a video', async () => {
    const { service } = setup();
    const toDataUrl = (url: string) => (service as unknown as { toBase64DataUrl(u: string): Promise<string | null> }).toBase64DataUrl(url);
    safeFetchMock.mockImplementation(async (url: string, options: SafeFetchOptions = {}) => {
      const headers = { 'content-type': url.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' };
      options.onHeaders?.(200, headers);
      return { status: 200, headers, body: Buffer.from('img'), url };
    });

    expect(await toDataUrl('https://cdn/p.jpg')).toBe(`data:image/jpeg;base64,${Buffer.from('img').toString('base64')}`);
    expect(safeFetchMock.mock.calls[0][1]).toMatchObject({ maxBytes: 20 * 1024 * 1024 });
    expect(await toDataUrl('https://cdn/r.mp4')).toBeNull();
  });
});

describe('«Fetch content» button', () => {
  it('answers after the fetch and leaves the visual check of new stories running in the background', async () => {
    const { service, verifier } = setup({ graph: { stories: { 'ig-1': [story('s1')] }, media: { 'ig-1': [[post('p1')]] } } });
    verifier.checkNewStories.mockImplementation(() => new Promise(() => {}));

    await expect(service.fetchContent(TENANT)).resolves.toEqual({ fetched: 2, matched: 0 });
    expect(verifier.checkNewStories).toHaveBeenCalledWith(TENANT, ['s1']);
  });

  it('refuses a store without an Instagram connection', async () => {
    const { service } = setup({ connections: [] });
    await expect(service.fetchContent(TENANT)).rejects.toThrow('No active Instagram connection');
  });
});
