import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useT } from '../i18n';

const BUSINESS_TYPES = [
  { value: 'beauty', label: 'Beauty & Cosmetics' },
  { value: 'fashion', label: 'Fashion & Clothing' },
  { value: 'barber', label: 'Barbershop & Hair' },
];

export default function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useT();
  const [storeName, setStoreName] = useState('');
  const [businessType, setBusinessType] = useState('beauty');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        storeName,
        businessType,
        email,
        password,
      });
      localStorage.setItem('accessToken', data.accessToken);
      navigate('/onboarding');
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (msg === 'Email already registered') {
        setError(t('auth.email_taken'));
      } else {
        setError(t('auth.register_error'));
      }
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
          <h1 className="text-xl font-semibold text-gray-900">{t('auth.register_title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('auth.register_subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label={t('auth.store_name')}
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="My Store"
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.business_type')}</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt.value} value={bt.value}>{bt.label}</option>
                ))}
              </select>
            </div>

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
              placeholder="Min 8 characters"
              autoComplete="new-password"
              required
            />

            <Input
              label={t('auth.confirm_password')}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
              required
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {t('auth.create_account')}
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          {t('auth.have_account')}{' '}
          <Link to="/login" className="text-gray-900 font-medium hover:underline">
            {t('auth.sign_in')}
          </Link>
        </p>
      </div>
    </div>
  );
}
