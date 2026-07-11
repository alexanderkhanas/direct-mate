// Minimal JWT payload access for UI gating. The API is the real
// authority (endpoints enforce role); this only decides what to render.

interface TokenPayload {
  sub?: string;
  email?: string;
  role?: string;
  tenantId?: string;
}

export function getTokenPayload(): TokenPayload | null {
  const token = localStorage.getItem('accessToken');
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as TokenPayload;
  } catch {
    return null;
  }
}

export function isSuperadmin(): boolean {
  return getTokenPayload()?.role === 'superadmin';
}
