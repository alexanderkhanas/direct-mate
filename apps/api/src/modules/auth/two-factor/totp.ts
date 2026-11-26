import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Time-based one-time codes (RFC 6238, the scheme every authenticator app
 * uses): the app and the server share a secret, and each turns it plus the
 * current 30-second step into the same 6 digits. Nothing travels between them.
 * HMAC-SHA1, 6 digits, 30 s: what Google Authenticator, 1Password and the rest
 * read from an `otpauth://` link.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now a code may come from: the phone's clock may be off by up to 30 s. */
const WINDOW = 1;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not a base32 string');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new shared secret: 20 random bytes (RFC 4226's recommended length), as base32. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one counter value (RFC 4226 HOTP). */
export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', key).update(message).digest();
  const offset = hash[hash.length - 1] & 0xf;
  const binary =
    ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS);
}

/**
 * The step a code belongs to, or null when it doesn't match. A code from a step
 * at or before `lastStep` (one already used) never matches, so a code that was
 * seen can't be replayed.
 */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep: number | null): number | null {
  const clean = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(clean)) return null;
  const key = base32Decode(secret);
  const now = stepAt(nowMs);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = now + d;
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(clean))) return step;
  }
  return null;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer = 'DirectMate'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
