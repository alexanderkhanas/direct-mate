import { SessionsService } from './sessions.service';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

interface Row {
  is_active: boolean;
  role: string;
  totp_enabled_at: Date | null;
  require_two_factor: boolean;
  sessions_valid_after: Date | null;
}

function setup(rows: Record<string, Partial<Row>>) {
  const table: Record<string, Row> = {};
  for (const [id, r] of Object.entries(rows)) {
    table[id] = { is_active: true, role: 'owner', totp_enabled_at: null, require_two_factor: false, sessions_valid_after: null, ...r };
  }
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    const id = params[0] as string;
    if (sql.startsWith('SELECT')) return table[id] ? [table[id]] : [];
    if (sql.startsWith('UPDATE users SET sessions_valid_after')) {
      table[id].sessions_valid_after = params[1] as Date;
      return [[], 1];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { sessions: new SessionsService({ query } as never), table, query };
}

const token = (p: Partial<JwtPayload>): JwtPayload => ({ sub: 'u1', email: 'a@b.c', role: 'owner', tenantId: 't1', iat: 1_000, ...p });

describe('SessionsService.accepts', () => {
  it('accepts a token of an active user who owes nothing', async () => {
    const { sessions } = setup({ u1: {} });
    await expect(sessions.accepts(token({}))).resolves.toBe(true);
  });

  it('refuses a sign-in challenge, an unknown user and a deactivated one', async () => {
    const { sessions } = setup({ u1: {}, u2: { is_active: false } });
    await expect(sessions.accepts(token({ purpose: '2fa' }))).resolves.toBe(false);
    await expect(sessions.accepts(token({ sub: 'nobody' }))).resolves.toBe(false);
    await expect(sessions.accepts(token({ sub: 'u2' }))).resolves.toBe(false);
  });

  it('refuses a superadmin, or a user of a store that requires 2FA, until 2FA is on', async () => {
    const { sessions } = setup({
      admin: { role: 'superadmin' },
      admin2fa: { role: 'superadmin', totp_enabled_at: new Date() },
      owner: { require_two_factor: true },
    });
    await expect(sessions.accepts(token({ sub: 'admin', role: 'superadmin' }))).resolves.toBe(false);
    await expect(sessions.accepts(token({ sub: 'admin2fa', role: 'superadmin' }))).resolves.toBe(true);
    await expect(sessions.accepts(token({ sub: 'owner' }))).resolves.toBe(false);
  });

  it('refuses tokens issued before the sessions were ended, to the millisecond', async () => {
    const { sessions } = setup({ u1: { sessions_valid_after: new Date(1_000_500) } });
    await expect(sessions.accepts(token({ iat: 1_000, iatMs: 1_000_499 }))).resolves.toBe(false);
    await expect(sessions.accepts(token({ iat: 1_000, iatMs: 1_000_500 }))).resolves.toBe(true);
    // A token from before `iatMs` existed: by `iat`, so one from the same second doesn't count.
    await expect(sessions.accepts(token({ iat: 1_000 }))).resolves.toBe(false);
    await expect(sessions.accepts(token({ iat: 1_001 }))).resolves.toBe(true);
  });

  it("checks an impersonation token against the superadmin behind it, not the owner (who may be locked out)", async () => {
    const { sessions } = setup({
      admin: { role: 'superadmin', totp_enabled_at: new Date() },
      lockedOwner: { is_active: false },
      someOwner: {},
    });
    await expect(sessions.accepts(token({ sub: 'lockedOwner', imp: 'admin' }))).resolves.toBe(true);
    // Only a superadmin can stand behind one.
    await expect(sessions.accepts(token({ sub: 'lockedOwner', imp: 'someOwner' }))).resolves.toBe(false);
  });

  it('reads a user once a minute, but at once after ending their sessions here', async () => {
    const { sessions, query } = setup({ u1: {} });
    await sessions.accepts(token({ iat: 1 }));
    await sessions.accepts(token({ iat: 1 }));
    expect(query).toHaveBeenCalledTimes(1);

    await sessions.endAll('u1', new Date(5_000));
    await expect(sessions.accepts(token({ iat: 1 }))).resolves.toBe(false);
    await expect(sessions.accepts(token({ iat: 5 }))).resolves.toBe(true);
  });
});
