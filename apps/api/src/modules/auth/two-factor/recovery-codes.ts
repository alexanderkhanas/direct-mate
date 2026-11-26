import { createHash, randomBytes } from 'crypto';

/**
 * Recovery codes: a way in when the phone with the authenticator app is lost.
 * Each works once. They're random enough (50 bits) that a plain SHA-256 is a
 * safe way to keep them; the codes themselves are shown once and never stored.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l, o, 0, 1: they read alike

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** As typed: case, spaces and dashes don't matter. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
