import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HISTORY_KEY } from './historyImport';

export type DirectPermission = 'read_messages' | 'reply_to_customers';

export interface DirectPermissionState {
  allowed: boolean;
  since: string | null;
  decided: boolean;
}

export type DirectPermissions = Record<DirectPermission, DirectPermissionState>;

/** The mode each permission is needed for (the API refuses the mode without it). */
export const NEEDED_FOR: Record<'active' | 'learning', DirectPermission> = {
  active: 'reply_to_customers',
  learning: 'read_messages',
};

/**
 * The owner's two permissions for the store's Instagram Direct, used by the
 * launch step and Settings. Withdrawing one the mode uses pauses the store, so
 * the store config and setup status are refetched with it.
 */
export function useDirectPermissions() {
  const qc = useQueryClient();
  const query = useQuery<DirectPermissions>({
    queryKey: ['direct-permissions'],
    queryFn: () => api.get<DirectPermissions>('/onboarding/permissions').then((r) => r.data),
  });
  const set = useMutation({
    mutationFn: (input: { permission: DirectPermission; allowed: boolean }) =>
      api
        .post<{ permissions: DirectPermissions; operatingMode?: 'paused' }>('/onboarding/permissions', input)
        .then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(['direct-permissions'], data.permissions);
      void qc.invalidateQueries({ queryKey: ['engine-config'] });
      void qc.invalidateQueries({ queryKey: ['onboarding-status'] });
      void qc.invalidateQueries({ queryKey: HISTORY_KEY });
    },
  });
  return { permissions: query.data, isLoading: query.isLoading, set };
}
