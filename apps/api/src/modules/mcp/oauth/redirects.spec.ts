import { createHash } from 'crypto';
import { pkceMatches } from './pkce';
import { redirectAllowed, redirectRegistered } from './redirects';

describe('redirectAllowed', () => {
  it('allows both Claude callbacks', () => {
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectAllowed('https://claude.com/api/mcp/auth_callback')).toBe(true);
  });

  it('allows http on this machine with any port', () => {
    expect(redirectAllowed('http://localhost:53124/callback')).toBe(true);
    expect(redirectAllowed('http://127.0.0.1:6274/oauth/callback')).toBe(true);
    expect(redirectAllowed('http://[::1]:8080/callback')).toBe(true);
  });

  it('refuses a host that only starts like Claude, another path, plain http elsewhere', () => {
    expect(redirectAllowed('https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false);
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback/../../x')).toBe(false);
    expect(redirectAllowed('https://claude.ai/other')).toBe(false);
    expect(redirectAllowed('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(redirectAllowed('https://localhost/callback')).toBe(false);
  });

  it('refuses userinfo, fragments and non-URLs', () => {
    expect(redirectAllowed('https://claude.ai@evil.com/api/mcp/auth_callback')).toBe(false);
    expect(redirectAllowed('https://user:pw@claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback#x')).toBe(false);
    expect(redirectAllowed('javascript:alert(1)')).toBe(false);
    expect(redirectAllowed(undefined)).toBe(false);
  });
});

describe('redirectRegistered', () => {
  it('needs an exact match for https', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback'];
    expect(redirectRegistered('https://claude.ai/api/mcp/auth_callback', registered)).toBe(true);
    expect(redirectRegistered('https://claude.com/api/mcp/auth_callback', registered)).toBe(false);
  });

  it('lets a loopback redirect differ only in port', () => {
    const registered = ['http://localhost:1111/callback'];
    expect(redirectRegistered('http://localhost:2222/callback', registered)).toBe(true);
    expect(redirectRegistered('http://localhost:2222/other', registered)).toBe(false);
    expect(redirectRegistered('http://127.0.0.1:2222/callback', registered)).toBe(false);
  });
});

describe('pkceMatches', () => {
  const verifier = 'a'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  it('accepts the verifier that hashes to the challenge', () => {
    expect(pkceMatches(verifier, challenge)).toBe(true);
  });

  it('refuses another verifier, a short one, and a missing one', () => {
    expect(pkceMatches('b'.repeat(43), challenge)).toBe(false);
    expect(pkceMatches('a'.repeat(42), challenge)).toBe(false);
    expect(pkceMatches(undefined, challenge)).toBe(false);
  });
});
