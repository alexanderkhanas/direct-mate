import { HttpException } from '@nestjs/common';
import { CryptoService } from '../../../common/crypto.service';
import { TwoFactorService } from './two-factor.service';
import { base32Decode, hotp, stepAt } from './totp';
import { hashRecoveryCode } from './recovery-codes';

/** One user row and their recovery codes, answering the SQL the service sends. */
function setup(opts: { required?: boolean } = {}) {
  const crypto = new CryptoService({ get: () => 'ab'.repeat(32) } as never);
  const user = {
    email: 'owner@store.ua',
    totp_secret_encrypted: null as string | null,
    totp_pending_secret_encrypted: null as string | null,
    totp_enabled_at: null as Date | null,
    totp_last_step: null as string | null,
    sessions_valid_after: null as Date | null,
    failed: 0,
    locked_until: null as Date | null,
  };
  let codes: Array<{ hash: string; used: boolean }> = [];

  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT count(*)')) return [{ left: codes.filter((c) => !c.used).length }];
    if (s.startsWith('SELECT')) return [user];
    if (s.startsWith('UPDATE users SET totp_pending_secret_encrypted = $2')) {
      user.totp_pending_secret_encrypted = params[1] as string;
      return [[], 1];
    }
    if (s.startsWith('UPDATE users SET totp_secret_encrypted = totp_pending_secret_encrypted')) {
      Object.assign(user, {
        totp_secret_encrypted: user.totp_pending_secret_encrypted,
        totp_pending_secret_encrypted: null,
        totp_enabled_at: params[1],
        totp_last_step: String(params[2]),
        sessions_valid_after: params[1],
      });
      return [[], 1];
    }
    if (s.startsWith('UPDATE users SET totp_secret_encrypted = NULL')) {
      Object.assign(user, { totp_secret_encrypted: null, totp_enabled_at: null, totp_last_step: null, sessions_valid_after: new Date() });
      return [[], 1];
    }
    if (s.startsWith('UPDATE users SET totp_last_step = $2')) {
      const step = params[1] as number;
      if (user.totp_last_step !== null && Number(user.totp_last_step) >= step) return [[], 0];
      user.totp_last_step = String(step);
      return [[{ id: 'u1' }], 1];
    }
    if (s.startsWith('UPDATE users SET locked_until')) {
      user.failed += 1;
      return [[], 1];
    }
    if (s.startsWith('DELETE FROM user_recovery_codes')) {
      codes = [];
      return [[], 0];
    }
    if (s.startsWith('INSERT INTO user_recovery_codes')) {
      codes = (params[1] as string[]).map((hash) => ({ hash, used: false }));
      return [];
    }
    if (s.startsWith('UPDATE user_recovery_codes SET used_at')) {
      const hit = codes.find((c) => c.hash === params[1] && !c.used);
      if (!hit) return [[], 0];
      hit.used = true;
      return [[{ id: 'c' }], 1];
    }
    throw new Error(`unexpected SQL: ${s}`);
  });
  const dataSource = { query, transaction: async (cb: (m: unknown) => unknown) => cb({ query }) };
  const sessions = {
    state: jest.fn(async () => ({ twoFactorEnabled: !!user.totp_enabled_at, twoFactorRequired: !!opts.required })),
    forget: jest.fn(),
  };
  const service = new TwoFactorService(dataSource as never, crypto, sessions as never);
  return { service, user, crypto, sessions, codes: () => codes };
}

const NOW = new Date(1_700_000_000_000);
const codeFor = (secret: string, at: Date, offsetSteps = 0) => hotp(base32Decode(secret), stepAt(at.getTime()) + offsetSteps);

async function enabled(t: ReturnType<typeof setup>): Promise<{ secret: string; recovery: string[] }> {
  const { secret } = await t.service.startSetup('u1');
  const recovery = await t.service.enable('u1', codeFor(secret, NOW), NOW);
  if (!recovery) throw new Error('enable failed');
  return { secret, recovery };
}

describe('TwoFactorService', () => {
  it('setup keeps the secret encrypted and pending, and returns a QR code of the otpauth link', async () => {
    const t = setup();
    const res = await t.service.startSetup('u1');
    expect(res.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.otpauthUri).toContain(`secret=${res.secret}`);
    expect(res.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(res.qr.split(',')[1], 'base64').toString()).toContain('<svg');
    expect(t.user.totp_pending_secret_encrypted).not.toContain(res.secret);
    expect(t.crypto.decrypt(t.user.totp_pending_secret_encrypted!)).toBe(res.secret);
    expect(t.user.totp_enabled_at).toBeNull();
  });

  it('a wrong first code leaves 2FA off and counts as a failed attempt', async () => {
    const t = setup();
    const { secret } = await t.service.startSetup('u1');
    const wrong = codeFor(secret, NOW) === '000000' ? '111111' : '000000';
    await expect(t.service.enable('u1', wrong, NOW)).resolves.toBeNull();
    expect(t.user.totp_enabled_at).toBeNull();
    expect(t.user.failed).toBe(1);
  });

  it('the first right code turns 2FA on, ends other sessions and gives 10 recovery codes kept only as hashes', async () => {
    const t = setup();
    const { recovery } = await enabled(t);
    expect(t.user.totp_enabled_at).toEqual(NOW);
    expect(t.user.sessions_valid_after).toEqual(NOW);
    expect(t.user.totp_pending_secret_encrypted).toBeNull();
    expect(recovery).toHaveLength(10);
    expect(t.codes().map((c) => c.hash)).toEqual(recovery.map(hashRecoveryCode));
    expect(t.sessions.forget).toHaveBeenCalledWith('u1');
    await expect(t.service.startSetup('u1')).rejects.toBeInstanceOf(HttpException);
  });

  it('a code works once: the code used to turn 2FA on, or one seen at sign-in, can’t be used again', async () => {
    const t = setup();
    const { secret } = await enabled(t);
    await expect(t.service.check('u1', { code: codeFor(secret, NOW) }, NOW)).resolves.toBe(false);
    const later = new Date(NOW.getTime() + 30_000);
    await expect(t.service.check('u1', { code: codeFor(secret, later) }, later)).resolves.toBe(true);
    await expect(t.service.check('u1', { code: codeFor(secret, later) }, later)).resolves.toBe(false);
    expect(t.user.failed).toBe(2);
  });

  it('a recovery code works once, typed in any case', async () => {
    const t = setup();
    const { recovery } = await enabled(t);
    await expect(t.service.check('u1', { recoveryCode: recovery[3].toUpperCase() })).resolves.toBe(true);
    await expect(t.service.check('u1', { recoveryCode: recovery[3] })).resolves.toBe(false);
    await expect(t.service.status('u1')).resolves.toEqual({ enabled: true, required: false, recoveryCodesLeft: 9 });
  });

  it('refuses any proof while the account is locked', async () => {
    const t = setup();
    const { secret } = await enabled(t);
    t.user.locked_until = new Date(Date.now() + 60_000);
    const later = new Date(NOW.getTime() + 30_000);
    await expect(t.service.check('u1', { code: codeFor(secret, later) }, later)).rejects.toBeInstanceOf(HttpException);
  });

  it('turning 2FA off needs a code, ends the sessions and drops the recovery codes; refused when it’s required', async () => {
    const t = setup();
    const { secret } = await enabled(t);
    const later = new Date(Date.now());
    await expect(t.service.disable('u1', { code: codeFor(secret, later) })).resolves.toBe(true);
    expect(t.user.totp_enabled_at).toBeNull();
    expect(t.codes()).toHaveLength(0);

    const r = setup({ required: true });
    await enabled(r);
    await expect(r.service.disable('u1', { code: '123456' })).rejects.toBeInstanceOf(HttpException);
    expect(r.user.totp_enabled_at).not.toBeNull();
  });

  it('new recovery codes replace the old ones', async () => {
    const t = setup();
    const { recovery } = await enabled(t);
    const fresh = await t.service.regenerateRecoveryCodes('u1', { recoveryCode: recovery[0] });
    expect(fresh).toHaveLength(10);
    await expect(t.service.check('u1', { recoveryCode: recovery[1] })).resolves.toBe(false);
    await expect(t.service.check('u1', { recoveryCode: fresh![0] })).resolves.toBe(true);
  });
});
