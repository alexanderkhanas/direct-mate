import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
});

// Superadmin tenant override — module-level variable set by TenantContext.
// Known limitation: shared across browser tabs in the same origin.
let overrideTenantId: string | null = null;
export function setOverrideTenantId(id: string | null) {
  overrideTenantId = id;
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
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);
