import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Check, ChevronLeft, Eye, EyeOff, MessageCircle } from '../components/icons';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { Alert, Field, IconButton, SetupButton, TextInput } from '../components/setup/ui';

type RegisterError = { field: 'email' | 'password' | null; message: string };

/** Taken emails come back as 409 «Email already registered» (auth.service.ts). */
function isEmailTaken(err: unknown): boolean {
  return isAxiosError(err) && (err.response?.status === 409 || err.response?.data?.error?.message === 'Email already registered');
}

/**
 * Sign-up (m01): store name, email and password, then straight into setup.
 * Full-width on phones; a centred card on desktop.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useT();
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<RegisterError | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError({ field: 'password', message: t('auth.password_too_short') });
      return;
    }

    setLoading(true);
    try {
      // businessType is left out: sign-up is for clothing stores, and the API defaults to fashion.
      const { data } = await api.post('/auth/register', { storeName, email, password });
      // A new store: nothing cached from a previous session may leak into its setup.
      queryClient.clear();
      localStorage.setItem('accessToken', data.accessToken);
      navigate('/onboarding');
    } catch (err) {
      setError(
        isEmailTaken(err) ? { field: 'email', message: t('auth.email_taken') } : { field: null, message: t('auth.register_error') },
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white font-sans text-[15px] leading-[1.45] text-dm-ink antialiased lg:bg-dm-bg">
      <div className="mx-auto flex min-h-[100dvh] w-full flex-col lg:max-w-[440px] lg:justify-center lg:py-12">
        <div className="flex h-[60px] flex-none items-center pl-1.5 lg:h-auto lg:pb-3 lg:pl-0">
          <Link
            to="/welcome"
            aria-label={t('common.back')}
            title={t('common.back')}
            className="inline-grid h-11 w-11 place-items-center rounded-xl text-dm-ink2 transition-colors hover:bg-dm-bubble focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 lg:-ml-2.5"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 px-5 pb-7 lg:flex-none lg:rounded-2xl lg:border lg:border-dm-line lg:bg-white lg:p-8 lg:shadow-dm"
        >
          <div className="flex flex-col gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white" aria-hidden="true">
              <MessageCircle className="h-5 w-5" />
            </span>
            <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-balance">{t('auth.register_title')}</h1>
            <p className="text-[15px] text-dm-muted text-pretty">{t('setup_launch.reg_lead')}</p>
          </div>

          <Field label={t('auth.store_name')}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                autoComplete="organization"
                required
              />
            )}
          </Field>

          <Field label={t('auth.email')} error={error?.field === 'email' ? error.message : undefined}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            )}
          </Field>

          <Field
            label={t('auth.password')}
            hint={t('setup_launch.reg_password_hint')}
            error={error?.field === 'password' ? error.message : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <div className="relative flex items-center">
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  // Room for the show/hide button; inline so it wins over the input's own padding.
                  style={{ paddingRight: 48 }}
                />
                <IconButton
                  label={t(showPassword ? 'setup_launch.reg_hide_password' : 'setup_launch.reg_show_password')}
                  onClick={() => setShowPassword((shown) => !shown)}
                  className="absolute right-0.5"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </IconButton>
              </div>
            )}
          </Field>

          {error?.field === null && <Alert tone="error" title={error.message} />}

          <SetupButton type="submit" size="lg" block loading={loading} className="mt-1">
            {t('auth.create_account')}
          </SetupButton>

          <ul className="flex flex-col gap-2 text-sm text-dm-ink2">
            {[t('setup_launch.reg_trial_note'), t('setup_launch.reg_help_note')].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 flex-none text-dm-green-icon" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>

          <p className="mt-auto pt-2 text-center text-[15px] text-dm-muted lg:mt-2 lg:pt-0">
            {t('auth.have_account')}{' '}
            <Link to="/login" className="font-medium text-blue-800 underline decoration-1 underline-offset-[3px] hover:text-blue-700">
              {t('auth.sign_in')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
