import { base32Decode, base32Encode, generateSecret, hotp, otpauthUri, stepAt, verifyTotp } from './totp';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes';

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');

describe('base32', () => {
  it('matches RFC 4648 (without padding) and round-trips', () => {
    const vectors: Array<[string, string]> = [
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
    expect(base32Decode('mzxw 6ytb-oi====').toString()).toBe('foobar');
    expect(() => base32Decode('MZ1')).toThrow();
  });

  it('makes 32-character secrets of 20 random bytes', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateSecret()).not.toBe(secret);
  });
});

describe('hotp / totp', () => {
  it('matches RFC 4226 for counters 0–9', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(RFC_KEY, counter)).toBe(code));
  });

  it('matches RFC 6238 (SHA-1, 8 digits)', () => {
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of vectors) expect(hotp(RFC_KEY, stepAt(seconds * 1000), 8)).toBe(code);
  });
});

describe('verifyTotp', () => {
  const secret = base32Encode(RFC_KEY);
  const now = 1_700_000_000_000;
  const codeAt = (ms: number) => hotp(RFC_KEY, stepAt(ms));

  it("accepts the current code and one 30 s either side (the phone's clock may be off), and returns its step", () => {
    expect(verifyTotp(secret, codeAt(now), now, null)).toBe(stepAt(now));
    expect(verifyTotp(secret, codeAt(now - 30_000), now, null)).toBe(stepAt(now) - 1);
    expect(verifyTotp(secret, codeAt(now + 30_000), now, null)).toBe(stepAt(now) + 1);
    expect(verifyTotp(secret, codeAt(now - 90_000), now, null)).toBeNull();
  });

  it('refuses a code from a step already used, so a seen code can’t be replayed', () => {
    expect(verifyTotp(secret, codeAt(now), now, stepAt(now))).toBeNull();
    expect(verifyTotp(secret, codeAt(now - 30_000), now, stepAt(now) - 1)).toBeNull();
    expect(verifyTotp(secret, codeAt(now), now, stepAt(now) - 1)).toBe(stepAt(now));
  });

  it('takes the code with spaces, refuses anything not 6 digits', () => {
    const code = codeAt(now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(stepAt(now));
    expect(verifyTotp(secret, code.slice(0, 5), now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
    expect(verifyTotp(secret, '', now, null)).toBeNull();
  });

  it('builds the otpauth link authenticator apps read', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'owner@store.ua');
    expect(uri).toBe(
      'otpauth://totp/DirectMate:owner%40store.ua?secret=JBSWY3DPEHPK3PXP&issuer=DirectMate&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('recovery codes', () => {
  it('makes 10 distinct codes; case, spaces and dashes don’t matter when typed', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-km-np-z2-9]{5}-[a-km-np-z2-9]{5}$/);
    expect(normalizeRecoveryCode(' ABCDE-fghij ')).toBe('abcdefghij');
    expect(hashRecoveryCode('ABCDE fghij')).toBe(hashRecoveryCode('abcde-fghij'));
    expect(hashRecoveryCode('abcde-fghij')).not.toBe(hashRecoveryCode('abcde-fghik'));
  });
});
