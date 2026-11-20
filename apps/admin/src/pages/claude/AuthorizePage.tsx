import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { publicApi } from '../../lib/publicApi';
import { getTokenPayload } from '../../lib/auth';
import { useT } from '../../i18n';
import { Alert, buttonClass, Skeleton, SetupButton, TextLink } from '../../components/setup/ui';
import { ClaudeShell, errorCode } from './ClaudeShell';

type Problem = 'expired' | 'wrong_browser' | 'not_owner' | 'store_unavailable' | 'error';

// `publicApi`, not `api`: an expired session must show the sign-in choice here, not bounce to /login.
const withToken = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}` } });

/**
 * Where a sign-in from Claude lands: «Allow Claude to set up your AI agent?».
 * Signed out, it offers sign-in or a new store first and comes back here.
 */
export default function AuthorizePage() {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const requestId = params.get('request') ?? '';
  const here = `/claude/authorize?request=${requestId}`;
  const [signedIn, setSignedIn] = useState(() => !!localStorage.getItem('accessToken'));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null);

  const request = useQuery({
    queryKey: ['claude-request', requestId],
    queryFn: async () => (await publicApi.get<{ clientName: string; redirectHost: string }>(`/claude/requests/${requestId}`)).data,
    retry: false,
    enabled: !!requestId,
  });

  const store = useQuery({
    queryKey: ['claude-authorize-store'],
    queryFn: async () => (await publicApi.get<{ store: { name: string } }>('/onboarding/status', withToken())).data.store,
    retry: false,
    enabled: signedIn,
  });

  const signOut = () => {
    localStorage.removeItem('accessToken');
    queryClient.clear();
    setSignedIn(false);
    setProblem(null);
  };

  const answer = async (action: 'approve' | 'deny') => {
    setBusy(action === 'approve' ? 'allow' : 'cancel');
    setProblem(null);
    try {
      const { data } = await publicApi.post<{ redirectTo: string }>(
        `/claude/requests/${requestId}/${action}`,
        {},
        action === 'approve' ? withToken() : undefined,
      );
      window.location.href = data.redirectTo;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) signOut();
      else setProblem((errorCode(err) as Problem | undefined) ?? 'error');
      setBusy(null);
    }
  };

  if (!requestId || request.isError || problem === 'expired') {
    return <ClaudeShell title={t('setup_claude.auth_expired_title')} lead={t('setup_claude.auth_expired_text')} />;
  }
  if (request.isLoading || !request.data) {
    return (
      <ClaudeShell title={<Skeleton className="h-7 w-3/4" />}>
        <Skeleton className="h-12 w-full" />
      </ClaudeShell>
    );
  }
  const client = request.data.clientName;

  // An expired admin session looks signed in until the first call answers 401.
  if (!signedIn || store.isError) {
    const next = encodeURIComponent(here);
    return (
      <ClaudeShell title={t('setup_claude.auth_guest_title', { client })} lead={t('setup_claude.auth_guest_lead', { client })}>
        <Link to={`/register?next=${next}`} className={buttonClass('brand', 'lg', 'w-full')}>
          {t('setup_claude.auth_create_store')}
        </Link>
        <Link to={`/login?next=${next}`} className={buttonClass('secondary', 'lg', 'w-full')}>
          {t('setup_claude.auth_sign_in')}
        </Link>
      </ClaudeShell>
    );
  }

  return (
    <ClaudeShell
      title={t('setup_claude.auth_title', { client })}
      lead={store.data ? t('setup_claude.auth_lead', { client, store: store.data.name }) : <Skeleton className="h-10 w-full" />}
    >
      {problem && problem !== 'error' && (
        <Alert tone="error" title={t(`setup_claude.auth_${problem}_title`)}>
          {t(`setup_claude.auth_${problem}_text`)}
        </Alert>
      )}
      {problem === 'error' && <Alert tone="error" title={t('setup_claude.auth_error')} />}

      <SetupButton size="lg" block loading={busy === 'allow'} disabled={!!busy || !store.data} onClick={() => answer('approve')}>
        {t('setup_claude.auth_allow')}
      </SetupButton>
      <SetupButton size="lg" block variant="secondary" loading={busy === 'cancel'} disabled={!!busy} onClick={() => answer('deny')}>
        {t('setup_claude.auth_cancel')}
      </SetupButton>

      <p className="text-sm text-dm-muted">
        {t('setup_claude.auth_signed_in_as', { email: getTokenPayload()?.email ?? '' })}
        {' · '}
        <TextLink onClick={signOut}>{t('setup_claude.auth_other_account')}</TextLink>
      </p>
      <p className="text-sm text-dm-muted">{t('setup_claude.auth_returns_to', { host: request.data.redirectHost })}</p>
    </ClaudeShell>
  );
}
