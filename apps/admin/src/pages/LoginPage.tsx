import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useT } from '../i18n';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Impersonation: superadmin opened tenant panel in new tab
  useEffect(() => {
    const token = searchParams.get('impersonate');
    if (token) {
      localStorage.setItem('accessToken', token);
      navigate('/');
    }
  }, [searchParams, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('accessToken', data.accessToken);
      navigate('/');
    } catch {
      setError(t('auth.login_error'));
    } finally {
      setLoading(false);
    }
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
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          {t('auth.no_account')}{' '}
          <Link to="/register" className="text-gray-900 font-medium hover:underline">
            {t('auth.create_store')}
          </Link>
        </p>
      </div>
    </div>
  );
}
