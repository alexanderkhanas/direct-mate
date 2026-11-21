import { IntegrationsService, withoutTokens } from './integrations.service';

describe('IntegrationsService', () => {
  const connection = {
    id: 'c1',
    tenantId: 't1',
    type: 'shopify',
    accessTokenEncrypted: 'enc:access',
    refreshTokenEncrypted: 'enc:refresh',
    metadata: { shopDomain: 'lliana.myshopify.com' },
  };

  it('lists connections for the admin without their tokens, even encrypted', async () => {
    const repo = { find: jest.fn(async () => [connection]) };
    const service = new IntegrationsService(repo as never, {} as never, {} as never, {} as never, {} as never);
    const [listed] = await service.findAll('t1');
    expect(listed).toEqual({ id: 'c1', tenantId: 't1', type: 'shopify', metadata: { shopDomain: 'lliana.myshopify.com' } });
    expect(repo.find).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
  });

  it('strips both tokens from a single connection', () => {
    expect(withoutTokens(connection as never)).not.toHaveProperty('accessTokenEncrypted');
    expect(withoutTokens(connection as never)).not.toHaveProperty('refreshTokenEncrypted');
  });
});

describe('IntegrationsService — Instagram login', () => {
  const CONFIG: Record<string, unknown> = {
    'meta.appId': 'meta-app',
    'meta.appSecret': 'meta-secret',
    'meta.loginConfigId': 'cfg-1',
    'meta.oauthRedirectUri': 'https://directmate.app/auth/instagram/callback',
    'meta.instagramAppId': 'ig-app',
    'meta.instagramAppSecret': 'ig-secret',
  };

  function setup(opts: { method?: 'instagram' | 'unified'; existing?: Record<string, unknown> | null } = {}) {
    const config = { get: (key: string) => (key === 'meta.loginMethod' ? (opts.method ?? 'instagram') : CONFIG[key]) };
    const connectionRepo = {
      update: jest.fn(async () => ({ affected: 0 })),
      findOne: jest.fn(async () => opts.existing ?? null),
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn(async (row: Record<string, unknown>) => row),
      find: jest.fn(async () => [] as unknown[]),
    };
    const tokenRepo = { create: jest.fn((row: unknown) => row), save: jest.fn(async () => undefined) };
    const crypto = { encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, '') };
    const service = new IntegrationsService(connectionRepo as never, {} as never, tokenRepo as never, crypto as never, config as never);
    return { service, connectionRepo };
  }

  /** Meta, faked by URL: each entry answers the first request whose URL contains its key (a string body goes as is). */
  function meta(routes: Array<[string, unknown, number?]>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const route = routes.find(([key]) => String(url).includes(key));
      if (!route) return new Response('not found', { status: 404 });
      const [, body, status] = route;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: status ?? 200 });
    }) as never;
    return calls;
  }

  afterEach(() => jest.restoreAllMocks());

  it("opens Instagram's own login with the Instagram app, its scopes and the method in the state", async () => {
    const { service } = setup();
    const url = new URL(await service.instagramLoginUrl('t1', 'onboarding'));
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ig-app');
    expect(url.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
    );
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{32}\.onboarding\.ig$/);
  });

  it('opens Unified Login with the Meta app and the configuration when set to unified', async () => {
    const { service } = setup({ method: 'unified' });
    const url = new URL(await service.instagramLoginUrl('t1', 'claude'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('meta-app');
    expect(url.searchParams.get('config_id')).toBe('cfg-1');
    expect(url.searchParams.get('state')).toMatch(/\.claude\.fb$/);
  });

  it('connects an Instagram Login account: 60-day token, the professional account id, webhooks on graph.instagram.com', async () => {
    const { service, connectionRepo } = setup();
    const calls = meta([
      ['api.instagram.com/oauth/access_token', { data: [{ access_token: 'short', user_id: 111 }] }],
      ['graph.instagram.com/access_token', { access_token: 'long', expires_in: 5183944 }],
      // Unquoted and past 2^53: JSON.parse would make it ...000.
      ['/me?fields=user_id,username', '{"id":"app-scoped","user_id":17841400000000001,"username":"lliana.shop"}'],
      ['/subscribed_apps', { success: true }],
    ]);

    const result = await service.completeInstagramLogin('t1', 'code-1#_', 'instagram');

    expect(result).toEqual({ ok: true, accountId: '17841400000000001' });
    const exchange = calls[0];
    const form = new URLSearchParams(String(exchange.init?.body));
    expect(form.get('code')).toBe('code-1'); // Instagram's trailing #_ removed
    expect(form.get('client_secret')).toBe('ig-secret');
    expect(calls[3].url).toBe(
      'https://graph.instagram.com/v27.0/17841400000000001/subscribed_apps?subscribed_fields=messages,comments',
    );
    const saved = connectionRepo.save.mock.calls[0][0] as Record<string, unknown>;
    expect(saved).toMatchObject({
      externalAccountId: '17841400000000001',
      accessTokenEncrypted: 'enc:long',
      loginMethod: 'instagram',
      metadata: { accountName: 'lliana.shop' },
    });
    const days = ((saved.tokenExpiresAt as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);
  });

  it("never saves an Instagram Login connection on the short-lived token or without the account's user_id", async () => {
    const noLong = setup();
    meta([
      ['api.instagram.com/oauth/access_token', { access_token: 'short' }],
      ['graph.instagram.com/access_token', { error: { message: 'bad' } }, 400],
    ]);
    await expect(noLong.service.completeInstagramLogin('t1', 'c', 'instagram')).rejects.toThrow(/long-lived/);
    expect(noLong.connectionRepo.save).not.toHaveBeenCalled();

    const noUserId = setup();
    meta([
      ['api.instagram.com/oauth/access_token', { access_token: 'short' }],
      ['graph.instagram.com/access_token', { access_token: 'long', expires_in: 100 }],
      ['/me?fields=user_id,username', { id: 'app-scoped' }],
    ]);
    await expect(noUserId.service.completeInstagramLogin('t1', 'c', 'instagram')).rejects.toThrow(/user_id/);
    expect(noUserId.connectionRepo.save).not.toHaveBeenCalled();
  });

  it('subscribes to messages alone when Meta refuses comments, and fails only when messages fail too', async () => {
    const { service } = setup();
    const account = { igAccountId: 'ig1', token: 't', api: 'https://graph.instagram.com/v27.0' };

    let calls = meta([
      ['subscribed_fields=messages,comments', { error: { message: 'permission' } }, 403],
      ['subscribed_fields=messages', { success: true }],
    ]);
    await expect(service.subscribeToWebhooks(account)).resolves.toEqual({ comments: false });
    expect(calls.map((c) => c.url.split('=').pop())).toEqual(['messages,comments', 'messages']);

    calls = meta([['subscribed_apps', { error: { message: 'no' } }, 403]]);
    await expect(service.subscribeToWebhooks(account)).rejects.toThrow(/messages\)/);
  });

  it('keeps the multiple-accounts answer for Unified Login', async () => {
    const { service, connectionRepo } = setup({ method: 'unified' });
    meta([
      ['/oauth/access_token', { access_token: 'bisu' }],
      ['/me/assigned_instagram_accounts', { data: [{ id: 'a' }, { id: 'b' }] }],
      ['?fields=username', { username: 'x' }],
    ]);
    await expect(service.completeInstagramLogin('t1', 'c', 'unified')).resolves.toEqual({ ok: false, reason: 'multiple_accounts' });
    expect(connectionRepo.save).not.toHaveBeenCalled();
  });

  it('renews Instagram Login tokens near expiry, marks expired ones, and only logs expiring Unified ones', async () => {
    const { service, connectionRepo } = setup();
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
    connectionRepo.find.mockResolvedValue([
      { id: 'renew', tenantId: 't1', loginMethod: 'instagram', accessTokenEncrypted: 'enc:old', tokenExpiresAt: inDays(5) },
      { id: 'gone', tenantId: 't2', loginMethod: 'instagram', accessTokenEncrypted: 'enc:old2', tokenExpiresAt: inDays(-1) },
      { id: 'unified', tenantId: 't3', loginMethod: 'unified', accessTokenEncrypted: 'enc:b', tokenExpiresAt: inDays(3) },
    ]);
    const calls = meta([['refresh_access_token', { access_token: 'fresh', expires_in: 5183944 }]]);

    const result = await service.refreshInstagramTokens();

    expect(result).toEqual({ refreshed: 1, failed: 0, expired: 1, expiring: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('grant_type=ig_refresh_token&access_token=old');
    expect(connectionRepo.update).toHaveBeenCalledWith('renew', expect.objectContaining({ accessTokenEncrypted: 'enc:fresh' }));
    expect(connectionRepo.update).toHaveBeenCalledWith('gone', { status: 'error' });
    expect(connectionRepo.update).not.toHaveBeenCalledWith('unified', expect.anything());
  });
});
