/** Where Claude sends the owner back after sign-in (web, Desktop, mobile). */
export const CLAUDE_REDIRECTS: readonly string[] = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Is this a redirect we send an authorization code to? Either one of the
 * allowed URLs exactly, or plain http on this machine with any port (Claude
 * Code and MCP Inspector listen on a random one). Compared as parsed URLs:
 * a prefix or regex match would let `claude.ai.evil.com` through.
 */
export function redirectAllowed(uri: unknown, allowed: readonly string[] = CLAUDE_REDIRECTS): boolean {
  if (typeof uri !== 'string' || uri.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return true;
  if (url.protocol !== 'https:') return false;
  return allowed.some((a) => {
    const want = new URL(a);
    return url.origin === want.origin && url.pathname === want.pathname && url.search === want.search;
  });
}

/**
 * Does the redirect in an authorization request match one the client
 * registered? Exact, except that a loopback redirect may differ in port.
 */
export function redirectRegistered(uri: string, registered: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return registered.some((r) => {
    if (r === uri) return true;
    let reg: URL;
    try {
      reg = new URL(r);
    } catch {
      return false;
    }
    return (
      url.protocol === 'http:' &&
      reg.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      url.hostname === reg.hostname &&
      url.pathname === reg.pathname &&
      url.search === reg.search
    );
  });
}
