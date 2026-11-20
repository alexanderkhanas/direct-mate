import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { publicApi } from '../../lib/publicApi';
import { useT } from '../../i18n';
import { Instagram } from '../../components/icons';
import { Alert, Field, SetupButton, TextInput } from '../../components/setup/ui';
import { ClaudeShell, errorCode } from './ClaudeShell';

// These pages are opened by a link Claude gave the owner. The one-time token
// in the link (`?t=`) is what authorizes the action: the owner may not be
// signed in to the admin in this browser.

function Expired() {
  const { t } = useT();
  return <ClaudeShell title={t('setup_claude.link_expired_title')} lead={t('setup_claude.link_expired_text')} />;
}

/** «Підключіть Instagram»: one button to the Meta login. The link is spent on the click, not on opening the page. */
export function ClaudeInstagramPage() {
  const { t } = useT();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'expired' | 'error'>('idle');

  const start = async () => {
    setState('busy');
    try {
      const { data } = await publicApi.post<{ redirectUrl: string }>('/claude/handoff/instagram', { token });
      window.location.href = data.redirectUrl;
    } catch (err) {
      setState(errorCode(err) === 'expired' ? 'expired' : 'error');
    }
  };

  if (!token || state === 'expired') return <Expired />;
  return (
    <ClaudeShell
      icon={<Instagram className="h-10 w-10" aria-hidden="true" />}
      title={t('setup_claude.ig_title')}
      lead={t('setup_claude.ig_lead')}
    >
      {state === 'error' && <Alert tone="error" title={t('setup_claude.link_error')} />}
      <SetupButton size="lg" block loading={state === 'busy'} onClick={start}>
        {t('setup_claude.ig_button')}
      </SetupButton>
    </ClaudeShell>
  );
}

/** The Shopify address and token, typed here so they never pass through the chat. */
export function ClaudeShopifyPage() {
  const { t } = useT();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [shopDomain, setShopDomain] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'expired' | 'bad_domain' | 'error'>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy');
    try {
      await publicApi.post('/claude/handoff/shopify', { token, shopDomain, accessToken });
      setState('done');
    } catch (err) {
      const code = errorCode(err);
      setState(code === 'expired' ? 'expired' : code === 'bad_domain' ? 'bad_domain' : 'error');
    }
  };

  if (!token || state === 'expired') return <Expired />;
  if (state === 'done') {
    return <ClaudeShell title={t('setup_claude.shopify_done_title')} lead={t('setup_claude.shopify_done_text')} />;
  }
  return (
    <ClaudeShell title={t('setup_claude.shopify_title')} lead={t('setup_claude.shopify_lead')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={t('setup_claude.shopify_domain')}
          hint={t('setup_claude.shopify_domain_hint')}
          error={state === 'bad_domain' ? t('setup_claude.shopify_bad_domain') : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              autoComplete="off"
              required
            />
          )}
        </Field>
        <Field label={t('setup_claude.shopify_token')}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoComplete="off"
              required
            />
          )}
        </Field>
        {state === 'error' && <Alert tone="error" title={t('setup_claude.link_error')} />}
        <SetupButton type="submit" size="lg" block loading={state === 'busy'}>
          {t('setup_claude.shopify_button')}
        </SetupButton>
      </form>
    </ClaudeShell>
  );
}

const KNOWN_REASONS = ['cancelled', 'no_account', 'multiple_accounts'];

/** Where the Instagram login comes back to when it was started from Claude. */
export function ClaudeDonePage() {
  const { t } = useT();
  const [params] = useSearchParams();
  if (params.get('instagram') === 'connected') {
    return <ClaudeShell title={t('setup_claude.done_title')} lead={t('setup_claude.done_text')} />;
  }
  const reason = params.get('reason') ?? '';
  return (
    <ClaudeShell title={t('setup_claude.done_error_title')}>
      <Alert tone="error">{t(`setup_claude.done_error_${KNOWN_REASONS.includes(reason) ? reason : 'other'}`)}</Alert>
    </ClaudeShell>
  );
}
