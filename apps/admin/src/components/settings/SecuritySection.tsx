import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldCheck } from '../icons';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';
import { RecoveryCodes, TwoFactorSetupData, TwoFactorSetupForm, isImpersonating, proofOf, twoFactorErrorText } from '../auth/TwoFactor';

interface TwoFactorStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

type Mode = 'idle' | 'setup' | 'disable' | 'new-codes' | 'end-sessions';

/**
 * Settings → signing in to your own account: two-factor sign-in on or off,
 * new recovery codes, sign out everywhere. Turning 2FA on or off ends every
 * session, so the API hands back a new login token for this one.
 */
export function SecuritySection() {
  const { t } = useT();
  const qc = useQueryClient();
  const impersonating = isImpersonating();
  const { data: status } = useQuery<TwoFactorStatus>({
    queryKey: ['two-factor'],
    queryFn: () => api.get('/auth/2fa').then((r) => r.data),
    enabled: !impersonating,
  });
  const { data: me } = useQuery<{ email: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
    staleTime: Infinity,
  });
  const [mode, setMode] = useState<Mode>('idle');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [proof, setProof] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setMode('idle');
    setProof('');
    setError('');
  };

  const startSetup = useCallback(
    async (): Promise<TwoFactorSetupData> => (await api.post<TwoFactorSetupData>('/auth/2fa/me/setup')).data,
    [],
  );

  const enable = async (code: string) => {
    const { data } = await api.post<{ accessToken: string; recoveryCodes: string[] }>('/auth/2fa/me/enable', { code });
    localStorage.setItem('accessToken', data.accessToken);
    setCodes(data.recoveryCodes);
    reset();
    void qc.invalidateQueries({ queryKey: ['two-factor'] });
  };

  const submitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'disable') {
        const { data } = await api.post<{ accessToken: string }>('/auth/2fa/me/disable', proofOf(proof));
        localStorage.setItem('accessToken', data.accessToken);
      } else {
        const { data } = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/me/recovery-codes', proofOf(proof));
        setCodes(data.recoveryCodes);
      }
      reset();
      void qc.invalidateQueries({ queryKey: ['two-factor'] });
    } catch (err) {
      setError(twoFactorErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const endSessions = async () => {
    setBusy(true);
    try {
      await api.post('/auth/sessions/end-all');
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    } catch (err) {
      setError(twoFactorErrorText(err, t));
      setBusy(false);
    }
  };

  if (impersonating) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('two_factor.section_title')}</h2>
        <p className="text-xs text-gray-500">{t('two_factor.impersonating')}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('two_factor.section_title')}</h2>

      {codes ? (
        <RecoveryCodes codes={codes} email={me?.email} onDone={() => setCodes(null)} />
      ) : mode === 'setup' ? (
        <div className="space-y-3">
          <TwoFactorSetupForm start={startSetup} enable={enable} intro={t('two_factor.setup_text')} />
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            {t('two_factor.cancel')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {status && (
            <div className="flex items-start gap-3">
              {status.enabled ? (
                <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
              ) : (
                <Shield className="h-5 w-5 text-gray-400 shrink-0" />
              )}
              <div className="text-sm">
                <p className="font-medium text-gray-900">{status.enabled ? t('two_factor.status_on') : t('two_factor.status_off')}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {status.enabled ? t('two_factor.codes_left', { count: status.recoveryCodesLeft }) : t('two_factor.setup_text')}
                </p>
                {status.required && <p className="text-xs text-gray-500 mt-0.5">{t('two_factor.required_note')}</p>}
              </div>
            </div>
          )}

          {(mode === 'disable' || mode === 'new-codes') && (
            <form onSubmit={submitProof} className="space-y-3">
              <Input
                label={t('two_factor.proof_label')}
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                autoComplete="one-time-code"
                placeholder="123456"
                autoFocus
                required
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant={mode === 'disable' ? 'danger' : 'primary'} loading={busy}>
                  {mode === 'disable' ? t('two_factor.disable') : t('two_factor.new_codes')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={reset}>
                  {t('two_factor.cancel')}
                </Button>
              </div>
            </form>
          )}

          {mode === 'end-sessions' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">{t('two_factor.end_sessions_text')}</p>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="danger" loading={busy} onClick={endSessions}>
                  {t('two_factor.end_sessions_confirm')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={reset}>
                  {t('two_factor.cancel')}
                </Button>
              </div>
            </div>
          )}

          {mode === 'idle' && status && (
            <div className="flex flex-wrap gap-2">
              {status.enabled ? (
                <>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setMode('new-codes')}>
                    {t('two_factor.new_codes')}
                  </Button>
                  {!status.required && (
                    <Button type="button" size="sm" variant="secondary" onClick={() => setMode('disable')}>
                      {t('two_factor.disable')}
                    </Button>
                  )}
                </>
              ) : (
                <Button type="button" size="sm" onClick={() => setMode('setup')}>
                  {t('two_factor.enable')}
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode('end-sessions')}>
                {t('two_factor.end_sessions')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
