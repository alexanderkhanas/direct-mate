import { useCallback, useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from '../components/icons';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useT } from '../i18n';
import { safeNext } from '../lib/next';
import { RecoveryCodes, TwoFactorSetupData, TwoFactorSetupForm, proofOf, twoFactorErrorText } from '../components/auth/TwoFactor';

/** After the password: a login token, or the code step or 2FA setup the account owes first. */
type LoginResponse = { accessToken: string } | { twoFactor: 'verify' | 'setup'; challenge: string };

type Step =
  | { kind: 'password' }
  | { kind: 'verify'; challenge: string }
  | { kind: 'setup'; challenge: string }
  | { kind: 'codes'; accessToken: string; codes: string[] };

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const next = safeNext(searchParams.get('next'));

  // Impersonation: superadmin opened tenant panel in new tab. The token comes after `#`, so it never
  // reaches the server or its logs.
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('impersonate');
    if (token) {
      queryClient.clear();
      localStorage.setItem('accessToken', token);
      navigate('/', { replace: true });
    }
  }, [navigate, queryClient]);

  const finish = (accessToken: string) => {
    // A new session: nothing cached from the previous store may leak into this one.
    queryClient.clear();
    localStorage.setItem('accessToken', accessToken);
    // A sign-in that started on Claude's consent page goes back there.
    navigate(next ?? '/');
  };

  const backToPassword = (message = '') => {
    setStep({ kind: 'password' });
    setCode('');
    setUseRecovery(false);
    setError(message);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
      if ('accessToken' in data) finish(data.accessToken);
      else setStep({ kind: data.twoFactor, challenge: data.challenge });
    } catch (err) {
      setError((err as { response?: { status?: number } })?.response?.status === 429 ? twoFactorErrorText(err, t) : t('auth.login_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'verify') return;
    setError('');
    setLoading(true);
    try {
      const proof = useRecovery ? { recoveryCode: code.trim() } : proofOf(code);
      const { data } = await api.post<{ accessToken: string }>('/auth/2fa/verify', { challenge: step.challenge, ...proof });
      finish(data.accessToken);
    } catch (err) {
      if ((err as { response?: { data?: { error?: { details?: { code?: string } } } } })?.response?.data?.error?.details?.code === 'challenge_expired') {
        backToPassword(t('two_factor.expired'));
      } else {
        setError(twoFactorErrorText(err, t));
      }
    } finally {
      setLoading(false);
    }
  };

  const startSetup = useCallback(async (): Promise<TwoFactorSetupData> => {
    if (step.kind !== 'setup') throw new Error('not in setup');
    return (await api.post<TwoFactorSetupData>('/auth/2fa/setup', { challenge: step.challenge })).data;
  }, [step]);

  const enableSetup = async (setupCode: string) => {
    if (step.kind !== 'setup') return;
    const { data } = await api.post<{ accessToken: string; recoveryCodes: string[] }>('/auth/2fa/enable', {
      challenge: step.challenge,
      code: setupCode,
    });
    setStep({ kind: 'codes', accessToken: data.accessToken, codes: data.recoveryCodes });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <Link to="/welcome" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" />
          {t('common.back')}
        </Link>
        <div className="flex flex-col items-center mb-8">
          <img
            src="/logo-square.png"
            alt="DirectMate"
            className="h-12 w-12 rounded-2xl object-cover mb-4"
          />
          <h1 className="text-xl font-semibold text-gray-900">DirectMate</h1>
          <p className="text-sm text-gray-500 mt-1">{t('auth.login_subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          {step.kind === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{t('two_factor.verify_title')}</h2>
                {!useRecovery && <p className="text-sm text-gray-600 mt-1">{t('two_factor.verify_text')}</p>}
              </div>
              <Input
                key={useRecovery ? 'recovery' : 'app'}
                label={useRecovery ? t('two_factor.recovery_label') : t('two_factor.code_label')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={useRecovery ? 'abcde-fghij' : '123456'}
                autoFocus
                required
              />
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
              <Button type="submit" loading={loading} className="w-full" size="lg">
                {t('two_factor.confirm')}
              </Button>
              <div className="flex flex-col items-center gap-2 text-sm">
                <button
                  type="button"
                  className="text-gray-600 hover:text-gray-900"
                  onClick={() => {
                    setUseRecovery(!useRecovery);
                    setCode('');
                    setError('');
                  }}
                >
                  {useRecovery ? t('two_factor.use_app') : t('two_factor.use_recovery')}
                </button>
                <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => backToPassword()}>
                  {t('two_factor.other_account')}
                </button>
              </div>
            </form>
          )}

          {step.kind === 'setup' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-900">{t('two_factor.setup_title')}</h2>
              <TwoFactorSetupForm start={startSetup} enable={enableSetup} intro={t('two_factor.setup_required')} />
              <div className="text-center text-sm">
                <button type="button" className="text-gray-400 hover:text-gray-600" onClick={() => backToPassword()}>
                  {t('two_factor.other_account')}
                </button>
              </div>
            </div>
          )}

          {step.kind === 'codes' && (
            <RecoveryCodes codes={step.codes} email={email} onDone={() => finish(step.accessToken)} />
          )}

          {step.kind === 'password' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('auth.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            <Input
              label={t('auth.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {t('auth.sign_in')}
            </Button>
          </form>
          )}
        </div>

        {step.kind === 'password' && (
        <p className="text-center text-sm text-gray-500 mt-4">
          {t('auth.no_account')}{' '}
          <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="text-gray-900 font-medium hover:underline">
            {t('auth.create_store')}
          </Link>
        </p>
        )}
      </div>
    </div>
  );
}
