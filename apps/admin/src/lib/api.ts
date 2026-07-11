import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
});

// Superadmin tenant override — module-level variable set by TenantContext.
// Persisted to localStorage so the picked tenant survives a page reload.
// Seeded from storage at import time so it's in place before the first
// request fires (avoids a request-before-effect race on reload).
// Known limitation: shared across browser tabs in the same origin.
const OVERRIDE_KEY = 'overrideTenantId';
let overrideTenantId: string | null = localStorage.getItem(OVERRIDE_KEY);
export function setOverrideTenantId(id: string | null) {
  overrideTenantId = id;
  if (id) localStorage.setItem(OVERRIDE_KEY, id);
  else localStorage.removeItem(OVERRIDE_KEY);
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (overrideTenantId) config.headers['X-Tenant-Id'] = overrideTenantId;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname;
      const publicPaths = ['/login', '/register', '/welcome', '/privacy', '/terms', '/data-deletion'];
      if (!publicPaths.some(p => path.startsWith(p))) {
        localStorage.removeItem('accessToken');
        setOverrideTenantId(null); // don't carry a tenant override across logins
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);
