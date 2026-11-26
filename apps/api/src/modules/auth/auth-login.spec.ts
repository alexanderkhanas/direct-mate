import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserSecurityState } from './sessions.service';

const PASSWORD = 'right-password';
const HASH = bcrypt.hashSync(PASSWORD, 4);

function setup(opts: { state?: Partial<UserSecurityState>; lockedUntil?: Date | null; codeOk?: boolean } = {}) {
  const user = {
    id: 'u1',
    email: 'owner@store.ua',
    passwordHash: HASH,
    role: 'owner',
    tenantId: 't1',
    isActive: true,
    totpEnabledAt: opts.state?.twoFactorEnabled ? new Date() : null,
    totpSecretEncrypted: 'secret',
    lockedUntil: opts.lockedUntil ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const userRepo = {
    findOne: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
      where.email === user.email || where.id === user.id ? user : null,
    ),
  };
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '7d' } });
  const sql: string[] = [];
  const dataSource = { query: jest.fn(async (q: string) => (sql.push(q), [])) };
  const state: UserSecurityState = {
    isActive: true,
    role: 'owner',
    twoFactorEnabled: false,
    twoFactorRequired: false,
    sessionsValidAfter: null,
    ...opts.state,
  };
  const sessions = { state: jest.fn(async () => state) };
  const twoFactor = {
    check: jest.fn(async () => opts.codeOk ?? false),
    enable: jest.fn(async () => (opts.codeOk ? ['aaaaa-bbbbb'] : null)),
    startSetup: jest.fn(async () => ({ secret: 'S', otpauthUri: 'otpauth://x', qr: 'data:x' })),
  };
  const service = new AuthService(
    userRepo as never,
    jwt,
    dataSource as never,
    {} as never,
    {} as never,
    twoFactor as never,
    sessions as never,
  );
  return { service, jwt, sql, twoFactor };
}

async function errorOf(p: Promise<unknown>): Promise<HttpException> {
  const err = (await p.catch((e: unknown) => e)) as HttpException;
  expect(err).toBeInstanceOf(HttpException);
  return err;
}

const lifetime = (jwt: JwtService, token: string) => {
  const p = jwt.decode(token) as { iat: number; exp: number };
  return p.exp - p.iat;
};

describe('AuthService.login', () => {
  it('signs in an account without 2FA as before, with a week-long token and no secrets in the user', async () => {
    const { service, jwt } = setup();
    const res = await service.login({ email: 'owner@store.ua', password: PASSWORD });
    if (!('accessToken' in res)) throw new Error('expected a session');
    expect(lifetime(jwt, res.accessToken)).toBe(7 * 86400);
    expect(res.user).toMatchObject({ id: 'u1', twoFactorEnabled: false });
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.user).not.toHaveProperty('totpSecretEncrypted');
  });

  it('gives the same answer for an unknown email and a wrong password; only the wrong password counts against the account', async () => {
    const { service, sql } = setup();
    const unknown = await errorOf(service.login({ email: 'nobody@store.ua', password: PASSWORD }));
    const wrong = await errorOf(service.login({ email: 'owner@store.ua', password: 'wrong-password' }));
    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect(wrong).toBeInstanceOf(UnauthorizedException);
    expect(unknown.getResponse()).toEqual(wrong.getResponse());
    expect(sql.filter((q) => q.includes('failed_logins + 1'))).toHaveLength(1);
  });

  it('refuses a locked account even with the right password', async () => {
    const { service } = setup({ lockedUntil: new Date(Date.now() + 60_000) });
    const err = await errorOf(service.login({ email: 'owner@store.ua', password: PASSWORD }));
    expect(err.getStatus()).toBe(429);
    expect((err.getResponse() as { details: { code: string } }).details.code).toBe('locked');
  });

  it('asks for the code when 2FA is on, and for setup when it is required but not on; never a login token', async () => {
    const on = await setup({ state: { twoFactorEnabled: true } }).service.login({ email: 'owner@store.ua', password: PASSWORD });
    expect(on).toEqual({ twoFactor: 'verify', challenge: expect.any(String) });
    const owed = await setup({ state: { twoFactorRequired: true } }).service.login({ email: 'owner@store.ua', password: PASSWORD });
    expect(owed).toEqual({ twoFactor: 'setup', challenge: expect.any(String) });
  });
});

describe('AuthService two-factor steps', () => {
  async function challengeFor(t: ReturnType<typeof setup>): Promise<string> {
    const res = await t.service.login({ email: 'owner@store.ua', password: PASSWORD });
    if (!('challenge' in res)) throw new Error('expected a challenge');
    return res.challenge;
  }

  it('the challenge lasts 5 minutes and is marked as a challenge (JwtStrategy refuses it as a login)', async () => {
    const t = setup({ state: { twoFactorEnabled: true } });
    const challenge = await challengeFor(t);
    expect(lifetime(t.jwt, challenge)).toBe(300);
    expect(t.jwt.decode(challenge)).toMatchObject({ sub: 'u1', purpose: '2fa' });
  });

  it('a right code gives a 12-hour login token and clears the failed attempts', async () => {
    const t = setup({ state: { twoFactorEnabled: true }, codeOk: true });
    const session = await t.service.verifyTwoFactor(await challengeFor(t), { code: '123456' });
    expect(lifetime(t.jwt, session.accessToken)).toBe(12 * 3600);
    expect(t.jwt.decode(session.accessToken)).not.toHaveProperty('purpose');
    expect(t.sql.some((q) => q.includes('failed_logins = 0'))).toBe(true);
  });

  it('a wrong code is refused', async () => {
    const t = setup({ state: { twoFactorEnabled: true }, codeOk: false });
    const err = await errorOf(t.service.verifyTwoFactor(await challengeFor(t), { code: '000000' }));
    expect((err.getResponse() as { details: { code: string } }).details.code).toBe('invalid_code');
  });

  it('refuses a login token, an expired challenge or garbage in place of the challenge', async () => {
    const t = setup({ state: { twoFactorEnabled: true }, codeOk: true });
    const login = t.jwt.sign({ sub: 'u1', email: 'owner@store.ua', role: 'owner', tenantId: 't1' });
    const expired = t.jwt.sign({ sub: 'u1', purpose: '2fa' }, { expiresIn: -10 });
    for (const challenge of [login, expired, 'garbage']) {
      const err = await errorOf(t.service.verifyTwoFactor(challenge, { code: '123456' }));
      expect((err.getResponse() as { details: { code: string } }).details.code).toBe('challenge_expired');
    }
  });

  it('setup at sign-in: the first code turns 2FA on and returns a login token with the recovery codes', async () => {
    const t = setup({ state: { twoFactorRequired: true }, codeOk: true });
    const challenge = await challengeFor(t);
    await expect(t.service.setupTwoFactor(challenge)).resolves.toMatchObject({ qr: 'data:x' });
    const res = await t.service.enableTwoFactor(challenge, '123456');
    expect(res.recoveryCodes).toEqual(['aaaaa-bbbbb']);
    expect(lifetime(t.jwt, res.accessToken)).toBe(12 * 3600);
    expect(t.twoFactor.enable).toHaveBeenCalledWith('u1', '123456');
  });
});
