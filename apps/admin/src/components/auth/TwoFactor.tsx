import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download } from '../icons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';
import { useT } from '../../i18n';

/** What `/auth/2fa/setup` returns: the QR code of the otpauth link, and the key to type in by hand. */
export interface TwoFactorSetupData {
  secret: string;
  otpauthUri: string;
  qr: string;
}

/** The API's error code (`error.details.code`) of a failed request. */
export function apiErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: { details?: { code?: string } } } } })?.response?.data?.error?.details?.code;
}

/** A message for a failed code step. */
export function twoFactorErrorText(err: unknown, t: (key: string, params?: Record<string, string | number>) => string): string {
  const code = apiErrorCode(err);
  if (code === 'invalid_code') return t('two_factor.wrong_code');
  if (code === 'challenge_expired') return t('two_factor.expired');
  // The account's lock (`locked`), or the per-address limit on sign-in routes (a 429 without a code: a minute).
  if (code === 'locked' || (err as { response?: { status?: number } })?.response?.status === 429) {
    const seconds =
      (err as { response?: { data?: { error?: { details?: { retryAfterSeconds?: number } } } } })?.response?.data?.error?.details
        ?.retryAfterSeconds ?? 60;
    return t('two_factor.locked', { minutes: Math.max(1, Math.ceil(seconds / 60)) });
  }
  return t('two_factor.error');
}

/** Six digits are a code from the app; anything else is taken as a recovery code. */
export function proofOf(value: string): { code?: string; recoveryCode?: string } {
  const clean = value.replace(/\s/g, '');
  return /^\d{6}$/.test(clean) ? { code: clean } : { recoveryCode: value.trim() };
}

/** Whether the signed-in token is a superadmin's view of a store as its owner. */
export function isImpersonating(): boolean {
  try {
    const token = localStorage.getItem('accessToken');
    const part = token?.split('.')[1];
    if (!part) return false;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { imp?: string };
    return !!payload.imp;
  } catch {
    return false;
  }
}

/** The key in groups of four, easier to type. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? t('two_factor.copied') : t('two_factor.copy')}
      </span>
    </Button>
  );
}

/**
 * Setting up the authenticator app: install, scan the QR code (or type the
 * key), confirm with the first code. `start` asks the API for a new secret;
 * `enable` sends the first code and resolves once 2FA is on.
 */
export function TwoFactorSetupForm({
  start,
  enable,
  intro,
}: {
  start: () => Promise<TwoFactorSetupData>;
  enable: (code: string) => Promise<void>;
  intro?: string;
}) {
  const { t } = useT();
  const [setup, setSetup] = useState<TwoFactorSetupData | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // one secret per setup, even when React runs effects twice
    started.current = true;
    start()
      .then(setSetup)
      .catch((err) => setError(twoFactorErrorText(err, t)));
  }, [start, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await enable(code.replace(/\s/g, ''));
    } catch (err) {
      setError(twoFactorErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {intro && <p className="text-sm text-gray-600">{intro}</p>}
      <ol className="space-y-4 text-sm text-gray-700">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium">1</span>
          <span>{t('two_factor.step_app')}</span>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium">2</span>
          <div className="space-y-3 min-w-0">
            <span>{t('two_factor.step_scan')}</span>
            {setup ? (
              <>
                <img src={setup.qr} alt="QR" className="h-44 w-44 rounded-lg border border-gray-200 bg-white p-2" />
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">{t('two_factor.manual_key')}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-md bg-gray-50 px-2 py-1 text-sm text-gray-900">{grouped(setup.secret)}</code>
                    <CopyButton text={setup.secret} />
                  </div>
                </div>
              </>
            ) : (
              !error && <Spinner />
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium">3</span>
          <span>{t('two_factor.step_code')}</span>
        </li>
      </ol>
      <Input
        label={t('two_factor.code_label')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={7}
        required
      />
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      <Button type="submit" loading={loading} disabled={!setup} className="w-full">
        {t('two_factor.enable')}
      </Button>
    </form>
  );
}

/** The recovery codes, shown once: copy or download them, confirm, continue. */
export function RecoveryCodes({ codes, email, onDone }: { codes: string[]; email?: string; onDone: () => void }) {
  const { t } = useT();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  const download = () => {
    const header = t('two_factor.codes_file_title', { email: email ?? '' });
    const blob = new Blob([`${header}\n\n${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'directmate-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t('two_factor.codes_title')}</h2>
        <p className="text-sm text-gray-600 mt-1">{t('two_factor.codes_text')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3">
        {codes.map((c) => (
          <code key={c} className="text-sm text-gray-900 text-center">
            {c}
          </code>
        ))}
      </div>
      <div className="flex gap-2">
        <CopyButton text={text} />
        <Button type="button" variant="secondary" size="sm" onClick={download}>
          <span className="inline-flex items-center gap-1.5">
            <Download className="h-4 w-4" />
            {t('two_factor.download')}
          </span>
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
        {t('two_factor.codes_saved')}
      </label>
      <Button type="button" className="w-full" disabled={!saved} onClick={onDone}>
        {t('two_factor.continue')}
      </Button>
    </div>
  );
}
