import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setOverrideTenantId } from '../lib/api';

interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

interface TenantContextValue {
  selectedTenantId: string | null;
  selectedTenantName: string | null;
  setSelectedTenantId: (id: string | null) => void;
  tenants: TenantOption[];
  isSuperadmin: boolean;
}

const TenantContext = createContext<TenantContextValue>({
  selectedTenantId: null,
  selectedTenantName: null,
  setSelectedTenantId: () => {},
  tenants: [],
  isSuperadmin: false,
});

export function useTenantContext() {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  // Seed from the persisted override so a reload keeps the picked tenant.
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(
    () => localStorage.getItem('overrideTenantId'),
  );

  const hasToken = !!localStorage.getItem('accessToken');

  const { data: user } = useQuery<{ role: string }>({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: hasToken,
  });

  const isSuperadmin = user?.role === 'superadmin';

  const { data: tenants } = useQuery<TenantOption[]>({
    queryKey: ['admin-tenants-list'],
    queryFn: () => api.get('/admin/tenants').then(r =>
      (r.data as any[]).map(t => ({ id: t.id, name: t.name, slug: t.slug })),
    ),
    enabled: isSuperadmin,
    staleTime: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();

  const setSelectedTenantId = (id: string | null) => {
    setSelectedTenantIdState(id);
    setOverrideTenantId(id);
    // Invalidate all queries so pages refetch with the new tenant context
    queryClient.invalidateQueries();
  };

  // Sync override on mount (in case of page reload with stored selection)
  useEffect(() => {
    setOverrideTenantId(selectedTenantId);
  }, [selectedTenantId]);

  // Drop a persisted selection that's no longer a valid tenant (deleted, or
  // the current superadmin can't see it), so a stale override can't stick.
  useEffect(() => {
    if (
      selectedTenantId &&
      tenants &&
      tenants.length > 0 &&
      !tenants.some((t) => t.id === selectedTenantId)
    ) {
      setSelectedTenantIdState(null);
      setOverrideTenantId(null);
    }
  }, [selectedTenantId, tenants]);

  const selectedTenantName = tenants?.find(t => t.id === selectedTenantId)?.name ?? null;

  return (
    <TenantContext.Provider
      value={{
        selectedTenantId,
        selectedTenantName,
        setSelectedTenantId,
        tenants: tenants ?? [],
        isSuperadmin,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}
