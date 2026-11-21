import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Instagram } from '../icons';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';

/** Reasons the API's Instagram callback can send back (integrations.controller.ts). */
const KNOWN_REASONS = [
  'cancelled',
  'missing_params',
  'invalid_state',
  'no_account',
  'multiple_accounts',
  'subscribe_failed',
  'exchange_failed',
];

/** What went wrong and what to do, in words, instead of the raw reason code. */
export function instagramErrorMessage(reason: string | null, t: (key: string) => string): string {
  return t(`instagram_connect.error_${reason && KNOWN_REASONS.includes(reason) ? reason : 'unknown'}`);
}

/** Reads `?instagram=connected|error&reason=…` once, after Meta sends the owner back, and clears it. */
export function useInstagramOAuthResult(): { ok: boolean; message: string } | null {
  const { t } = useT();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('instagram');
    if (!status) return;
    setResult(
      status === 'connected'
        ? { ok: true, message: t('instagram_connect.connected') }
        : { ok: false, message: instagramErrorMessage(params.get('reason'), t) },
    );
    window.history.replaceState({}, '', window.location.pathname);
  }, [t]);
  return result;
}

/**
 * The login «Connect Instagram» opens: Instagram's own (`instagram`) or Meta's
 * Unified Login through Facebook (`unified`). Set on the server; Instagram's
 * own until it answers.
 */
export type InstagramLoginMethod = 'instagram' | 'unified';

export function useInstagramLoginMethod(): InstagramLoginMethod {
  const { data } = useQuery({
    queryKey: ['instagram-login-method'],
    queryFn: () => api.get<{ method: InstagramLoginMethod }>('/connections/instagram/login-method').then((r) => r.data),
    staleTime: Infinity,
  });
  return data?.method ?? 'instagram';
}

/** What the owner needs before the login, then the button that starts it. */
export function InstagramConnectButton({ returnTo }: { returnTo: 'onboarding' | 'connections' }) {
  const { t } = useT();
  const method = useInstagramLoginMethod();
  const start = useMutation({
    mutationFn: () => api.post('/connections/instagram/oauth/start', { returnTo }).then((r) => r.data),
    onSuccess: (data: { redirectUrl: string }) => {
      window.location.href = data.redirectUrl;
    },
  });
  return (
    <div className="space-y-3">
      <ul className="text-xs text-gray-500 space-y-1 list-disc pl-4">
        <li>{t('instagram_connect.need_professional')}</li>
        {method === 'instagram' ? (
          <li>{t('instagram_connect.need_instagram')}</li>
        ) : (
          <>
            <li>{t('instagram_connect.need_facebook')}</li>
            <li>{t('instagram_connect.one_account')}</li>
          </>
        )}
      </ul>
      <Button onClick={() => start.mutate()} loading={start.isPending}>
        <Instagram className="h-4 w-4" />
        {t('instagram_connect.button')}
      </Button>
      {start.isError && <p className="text-xs text-red-600">{t('instagram_connect.error_start')}</p>}
    </div>
  );
}
