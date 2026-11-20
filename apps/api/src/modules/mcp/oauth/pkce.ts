import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** RFC 7636: 43–128 characters from the unreserved set. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Does the verifier sent to the token endpoint hash to the S256 challenge from the authorization request? */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false;
  const got = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const want = Buffer.from(challenge);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A random token for codes, access and refresh tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are looked up by this, so a leaked table doesn't hand out working tokens. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
