import { createHash } from 'crypto';
import { OAuthError, OAuthService } from './oauth.service';

const USER = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const GRANT = '33333333-3333-4333-8333-333333333333';
const CLIENT = { clientId: 'c1', clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] };
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

type Row = Record<string, unknown>;

/** `rows` answers a query by a fragment of its SQL; an UPDATE … RETURNING answers `[rows, count]` like the driver. */
function setup(rows: Record<string, Row[]>, env = 'production') {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    const key = Object.keys(rows).find((k) => sql.includes(k));
    const found = key ? rows[key] : [];
    return /^\s*UPDATE/.test(sql) ? [found, found.length] : found;
  });
  const config = { get: (k: string) => (k === 'nodeEnv' ? env : k === 'mcp.publicUrl' ? 'https://mcp.directmate.app' : undefined) };
  const events = { record: jest.fn(async () => undefined) };
  const service = new OAuthService({ query } as never, config as never, events as never);
  const ran = (fragment: string) => queries.filter((q) => q.sql.includes(fragment));
  return { service, events, ran };
}

const owner = (over: Row = {}) => ({ tenant_id: 't1', role: 'owner', is_active: true, tenant_active: true, is_demo: false, ...over });
const CLAIMED = [{ redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 'xyz' }];

describe('OAuthService.approve', () => {
  it('sends the owner back to the client with a code, the state and the issuer', async () => {
    const { service, events } = setup({ 'FROM users u JOIN tenants': [owner()], 'SET tenant_id': CLAIMED });
    const result = await service.approve(REQUEST, USER, 'cookie');
    const url = new URL((result as { redirectTo: string }).redirectTo);
    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('iss')).toBe('https://mcp.directmate.app');
    expect(events.record).toHaveBeenCalledWith('t1', 'authorized');
  });

  it('refuses a manager, a deactivated user, and a user it cannot find', async () => {
    for (const user of [[owner({ role: 'manager' })], [owner({ is_active: false })], []]) {
      const { service, ran } = setup({ 'FROM users u JOIN tenants': user, 'SET tenant_id': CLAIMED });
      expect(await service.approve(REQUEST, USER, 'cookie')).toEqual({ problem: 'not_owner' });
      expect(ran('SET tenant_id')).toHaveLength(0);
    }
  });

  it('refuses a demo store in production and a closed store anywhere', async () => {
    const demo = setup({ 'FROM users u JOIN tenants': [owner({ is_demo: true })], 'SET tenant_id': CLAIMED });
    expect(await demo.service.approve(REQUEST, USER, 'cookie')).toEqual({ problem: 'store_unavailable' });
    const closed = setup({ 'FROM users u JOIN tenants': [owner({ tenant_active: false })], 'SET tenant_id': CLAIMED }, 'development');
    expect(await closed.service.approve(REQUEST, USER, 'cookie')).toEqual({ problem: 'store_unavailable' });
  });

  it('allows a demo store in development, where it is what there is to test with', async () => {
    const { service } = setup({ 'FROM users u JOIN tenants': [owner({ is_demo: true })], 'SET tenant_id': CLAIMED }, 'development');
    expect(await service.approve(REQUEST, USER, 'cookie')).toHaveProperty('redirectTo');
  });

  it('in production always binds the request to the browser cookie, even a missing one', async () => {
    const { service, ran } = setup({ 'FROM users u JOIN tenants': [owner()], 'SET tenant_id': CLAIMED });
    await service.approve(REQUEST, USER, undefined);
    expect(ran('SET tenant_id')[0].params[5]).toEqual(expect.any(String));
  });

  it('in development skips the binding only when no cookie arrived', async () => {
    const without = setup({ 'FROM users u JOIN tenants': [owner()], 'SET tenant_id': CLAIMED }, 'development');
    await without.service.approve(REQUEST, USER, undefined);
    expect(without.ran('SET tenant_id')[0].params[5]).toBeNull();
    const withCookie = setup({ 'FROM users u JOIN tenants': [owner()], 'SET tenant_id': CLAIMED }, 'development');
    await withCookie.service.approve(REQUEST, USER, 'cookie');
    expect(withCookie.ran('SET tenant_id')[0].params[5]).toEqual(expect.any(String));
  });

  it('tells a request opened in another browser from one that is over', async () => {
    const other = setup({ 'FROM users u JOIN tenants': [owner()], 'SELECT c.client_name': [{ client_name: 'Claude', redirect_uri: CLAIMED[0].redirect_uri }] });
    expect(await other.service.approve(REQUEST, USER, 'cookie')).toEqual({ problem: 'wrong_browser' });
    const over = setup({ 'FROM users u JOIN tenants': [owner()] });
    expect(await over.service.approve(REQUEST, USER, 'cookie')).toEqual({ problem: 'expired' });
  });

  it('does not touch the database for an id that is not a uuid', async () => {
    const { service, ran } = setup({});
    expect(await service.approve("x' OR 1=1", USER, 'cookie')).toEqual({ problem: 'expired' });
    expect(ran('')).toHaveLength(0);
  });
});

describe('OAuthService.exchangeCode', () => {
  const spent = (over: Row = {}) => [
    { client_id: 'c1', redirect_uri: CLIENT.redirectUris[0], resource: 'https://mcp.directmate.app/mcp', code_challenge: CHALLENGE, tenant_id: 't1', user_id: USER, ...over },
  ];
  const input = (over: Row = {}) => ({
    client: CLIENT,
    code: 'code',
    redirectUri: CLIENT.redirectUris[0],
    resource: 'https://mcp.directmate.app/mcp',
    codeVerifier: VERIFIER,
    ...over,
  });
  const failure = (p: Promise<unknown>) => p.then(() => 'no error', (e: OAuthError) => e.error);

  it('issues tokens for a good code and opens a grant', async () => {
    const { service, ran } = setup({ 'SET used_at = now()': spent(), 'INSERT INTO mcp_grants': [{ id: GRANT }] });
    const tokens = await service.exchangeCode(input());
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);
    // Only hashes are stored.
    expect(JSON.stringify(ran('INSERT INTO mcp_tokens')[0].params)).not.toContain(tokens.accessToken);
  });

  it('refuses a spent or unknown code, another client’s code, a different redirect, resource or verifier', async () => {
    expect(await failure(setup({}).service.exchangeCode(input()))).toBe('invalid_grant');
    const rows = { 'SET used_at = now()': spent(), 'INSERT INTO mcp_grants': [{ id: GRANT }] };
    expect(await failure(setup({ ...rows, 'SET used_at = now()': spent({ client_id: 'other' }) }).service.exchangeCode(input()))).toBe('invalid_grant');
    expect(await failure(setup(rows).service.exchangeCode(input({ redirectUri: 'https://claude.com/api/mcp/auth_callback' })))).toBe('invalid_grant');
    expect(await failure(setup(rows).service.exchangeCode(input({ resource: 'https://evil.example/mcp' })))).toBe('invalid_target');
    expect(await failure(setup(rows).service.exchangeCode(input({ codeVerifier: 'w'.repeat(43) })))).toBe('invalid_grant');
  });
});

describe('OAuthService.refresh', () => {
  it('ends the whole grant when a refresh token is presented a second time', async () => {
    const { service, ran } = setup({ 'used_at IS NOT NULL': [{ grant_id: GRANT }], 'SET revoked_at': [{ id: GRANT }] });
    const err = await service.refresh(CLIENT, 'already-used').catch((e: OAuthError) => e);
    expect((err as OAuthError).error).toBe('invalid_grant');
    expect(ran('SET revoked_at')[0].params[0]).toBe(GRANT);
    expect(ran('DELETE FROM mcp_tokens')).toHaveLength(1);
  });

  it('refuses when the grant no longer stands, even with a good refresh token', async () => {
    const { service } = setup({ "kind = 'refresh' AND used_at IS NULL": [{ grant_id: GRANT }] });
    const err = await service.refresh(CLIENT, 'good').catch((e: OAuthError) => e);
    expect((err as OAuthError).error).toBe('invalid_grant');
  });
});

describe('OAuthService.revokeGrant', () => {
  it('passes the owner’s tenant so one store cannot revoke another’s connection', async () => {
    const { service, ran } = setup({});
    expect(await service.revokeGrant(GRANT, 't1')).toBe(false);
    expect(ran('SET revoked_at')[0].params).toEqual([GRANT, 't1']);
  });
});
