import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { useT } from '../../i18n';
import { Check, Instagram } from '../../components/icons';
import { Alert, CheckRow, SetupButton, Skeleton } from '../../components/setup/ui';
import { ClaudeShell as Shell, errorCode } from '../claude/ClaudeShell';

// A connect link (`npm run connect-link`) opens these: an owner we set the
// store up for allows reading their Direct and connects Instagram, without
// signing in. The token in the link (`?t=`) is the authorization; it works
// until it expires or Instagram is connected, so a cancelled login can retry.

const POINTS = ['point_read', 'point_redact', 'point_new', 'point_silent', 'point_revoke'] as const;

export function ConnectPage() {
  const { t } = useT();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [store, setStore] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'busy' | 'expired' | 'connected' | 'error'>(token ? 'loading' : 'expired');
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!token) return;
    publicApi
      .get<{ storeName: string }>('/connect', { params: { t: token } })
      .then(({ data }) => {
        setStore(data.storeName);
        setState('idle');
      })
      .catch((err) => setState(errorCode(err) === 'connected' ? 'connected' : 'expired'));
  }, [token]);

  const start = async () => {
    setState('busy');
    try {
      const { data } = await publicApi.post<{ redirectUrl: string }>('/connect/instagram', { token, allowRead: true });
      window.location.href = data.redirectUrl;
    } catch (err) {
      const code = errorCode(err);
      setState(code === 'expired' ? 'expired' : code === 'connected' ? 'connected' : 'error');
    }
  };

  if (state === 'expired') return <Shell title={t('setup_connect.expired_title')} lead={t('setup_connect.expired_text')} />;
  if (state === 'connected') return <Shell title={t('setup_connect.connected_title')} lead={t('setup_connect.connected_text')} />;
  if (state === 'loading') {
    return (
      <Shell title={<Skeleton className="h-7 w-3/4" />}>
        <Skeleton className="h-24 w-full" />
      </Shell>
    );
  }

  return (
    <Shell
      icon={<Instagram className="h-10 w-10" aria-hidden="true" />}
      title={t('setup_connect.title', { store: store ?? '' })}
      lead={t('setup_connect.lead')}
    >
      <ul className="flex flex-col gap-2">
        {POINTS.map((key) => (
          <li key={key} className="flex items-start gap-2.5 text-[15px] text-dm-ink">
            <Check className="mt-0.5 h-[18px] w-[18px] flex-none text-blue-600" aria-hidden="true" />
            <span>{t(`setup_connect.${key}`)}</span>
          </li>
        ))}
      </ul>
      <CheckRow checked={allowed} onChange={setAllowed}>
        {t('setup_connect.consent')}
      </CheckRow>
      {state === 'error' && <Alert tone="error" title={t('setup_connect.error')} />}
      <div className="flex flex-col gap-2">
        <SetupButton size="lg" block disabled={!allowed} loading={state === 'busy'} onClick={start}>
          {t('setup_connect.button')}
        </SetupButton>
        <p className="text-sm text-dm-muted">{t('setup_connect.hint')}</p>
      </div>
    </Shell>
  );
}

const KNOWN_REASONS = ['cancelled', 'no_account'];

/** Where the Instagram login comes back to when it was started from a connect link. */
export function ConnectDonePage() {
  const { t } = useT();
  const [params] = useSearchParams();
  if (params.get('instagram') === 'connected') {
    return <Shell title={t('setup_connect.done_title')} lead={t('setup_connect.done_text')} />;
  }
  const reason = params.get('reason') ?? '';
  return (
    <Shell title={t('setup_connect.done_error_title')}>
      <Alert tone="error">{t(`setup_connect.done_error_${KNOWN_REASONS.includes(reason) ? reason : 'other'}`)}</Alert>
    </Shell>
  );
}
