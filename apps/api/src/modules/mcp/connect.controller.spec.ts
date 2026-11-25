import { GoneException } from '@nestjs/common';
import { ConnectController } from './connect.controller';
import { HandoffService } from './handoff.service';
import { tokenHash } from './oauth/pkce';

/** A fake database holding one store and its connect tokens. */
function setup(opts: { connected?: boolean; token?: { action?: string; used?: boolean; expired?: boolean } } = {}) {
  const tok = { action: 'connect', used: false, expired: false, ...opts.token };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM handoff_tokens')) {
      const ok = params[0] === tokenHash('good') && params[1] === tok.action && !tok.used && !tok.expired;
      return ok ? [{ tenant_id: 't1' }] : [];
    }
    if (sql.includes('FROM tenants t')) return [{ name: 'TapTap', connected: !!opts.connected }];
    if (sql.includes('INSERT INTO handoff_tokens')) return [];
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const dataSource = { query };
  const handoffs = new HandoffService(dataSource as never, { get: () => 'https://directmate.app' } as never);
  const integrations = { instagramLoginUrl: jest.fn(async () => 'https://www.instagram.com/oauth/authorize?x') };
  const permissions = { set: jest.fn(async () => ({ permissions: {} })) };
  const controller = new ConnectController(dataSource as never, handoffs, integrations as never, permissions as never);
  return { controller, handoffs, integrations, permissions, query };
}

async function gone(p: Promise<unknown>): Promise<string | undefined> {
  const err = (await p.catch((e: unknown) => e)) as GoneException;
  expect(err).toBeInstanceOf(GoneException);
  return (err.getResponse() as { details?: { code?: string } }).details?.code;
}

describe('ConnectController', () => {
  it("shows the store's name for a live link", async () => {
    const t = setup();
    await expect(t.controller.view('good')).resolves.toEqual({ storeName: 'TapTap' });
  });

  it('refuses an unknown, used, expired or other-action link', async () => {
    expect(await gone(setup().controller.view('bad'))).toBe('expired');
    expect(await gone(setup({ token: { used: true } }).controller.view('good'))).toBe('expired');
    expect(await gone(setup({ token: { expired: true } }).controller.view('good'))).toBe('expired');
    expect(await gone(setup({ token: { action: 'instagram' } }).controller.view('good'))).toBe('expired');
  });

  it('stops working once the store has Instagram connected', async () => {
    const t = setup({ connected: true });
    expect(await gone(t.controller.view('good'))).toBe('connected');
    expect(await gone(t.controller.instagram({ token: 'good', allowRead: true }))).toBe('connected');
    expect(t.permissions.set).not.toHaveBeenCalled();
  });

  it("records the owner's read permission as given through the link, then sends them to the Instagram login", async () => {
    const t = setup();
    const res = await t.controller.instagram({ token: 'good', allowRead: true });
    expect(t.permissions.set).toHaveBeenCalledWith('t1', 'read_messages', true, { source: 'link' });
    expect(t.integrations.instagramLoginUrl).toHaveBeenCalledWith('t1', 'link');
    expect(res).toEqual({ redirectUrl: 'https://www.instagram.com/oauth/authorize?x' });
    // The link isn't spent: a cancelled login can be tried again.
    expect(t.query.mock.calls.some(([sql]) => sql.includes('UPDATE handoff_tokens'))).toBe(false);
  });
});

describe('HandoffService connect links', () => {
  it('issues a /connect link with the given lifetime', async () => {
    const t = setup();
    const link = await t.handoffs.issue('t1', 'connect', 7 * 86400);
    expect(link.url).toMatch(/^https:\/\/directmate\.app\/connect\?t=[A-Za-z0-9_-]{43}$/);
    expect(link.expiresInSeconds).toBe(7 * 86400);
    const insert = t.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO handoff_tokens'))!;
    expect(insert[1]).toEqual([expect.any(String), 't1', 'connect', 7 * 86400]);
  });

  it('keeps the Claude links under /claude', async () => {
    const t = setup();
    const link = await t.handoffs.issue('t1', 'instagram');
    expect(link.url).toMatch(/^https:\/\/directmate\.app\/claude\/instagram\?t=/);
    expect(link.expiresInSeconds).toBe(600);
  });
});
