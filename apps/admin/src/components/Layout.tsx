import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  ScrollText,
  Package,
  LogOut,
  Zap,
  GraduationCap,
  FileText,
  FlaskConical,
  ShoppingCart,
  ImagePlus,
  Store,
  BarChart3,
  Globe,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useT, type Lang } from '../i18n';

const navItems = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, exact: true },
  { to: '/orders', key: 'nav.orders', icon: ShoppingCart },
  { to: '/conversations', key: 'nav.conversations', icon: MessageSquare },
  { to: '/catalog', key: 'nav.catalog', icon: Package },
  { to: '/connections', key: 'nav.connections', icon: Plug },
  { to: '/training', key: 'nav.training', icon: GraduationCap },
  { to: '/templates', key: 'nav.templates', icon: FileText },
  { to: '/testing', key: 'nav.testing', icon: FlaskConical },
  { to: '/content-linking', key: 'nav.content', icon: ImagePlus },
  { to: '/settings', key: 'nav.settings', icon: Settings },
  { to: '/logs', key: 'nav.logs', icon: ScrollText },
];

const adminItems = [
  { to: '/admin/stores', key: 'nav.stores', icon: Store },
  { to: '/admin/analytics', key: 'nav.analytics', icon: BarChart3 },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, setLang } = useT();

  const { data: user } = useQuery<{ email: string; role: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
    staleTime: Infinity,
  });

  const isSuperadmin = user?.role === 'superadmin';

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    navigate('/login');
  };

  const toggleLang = () => setLang(lang === 'uk' ? 'en' : 'uk');

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
          <div className="h-7 w-7 rounded-lg bg-gray-900 flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold text-gray-900 text-sm tracking-tight">DirectMate</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {navItems.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50',
                )}
              >
                <item.icon
                  className={cn('h-4 w-4', active ? 'text-gray-900' : 'text-gray-400')}
                  strokeWidth={active ? 2.5 : 2}
                />
                {t(item.key)}
              </Link>
            );
          })}

          {isSuperadmin && (
            <>
              <div className="mx-3 my-2 border-t border-gray-200" />
              <p className="px-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{t('nav.admin')}</p>
              {adminItems.map((item) => {
                const active = location.pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      active
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-500 hover:text-indigo-700 hover:bg-indigo-50',
                    )}
                  >
                    <item.icon
                      className={cn('h-4 w-4', active ? 'text-indigo-600' : 'text-gray-400')}
                      strokeWidth={active ? 2.5 : 2}
                    />
                    {t(item.key)}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* Language + User + Sign out */}
        <div className="px-3 py-3 border-t border-gray-100 space-y-1">
          <button
            onClick={toggleLang}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <Globe className="h-4 w-4 text-gray-400" />
            {lang === 'uk' ? 'UA' : 'EN'}
            <span className="text-xs text-gray-400 ml-auto">
              {lang === 'uk' ? 'English' : 'Українська'}
            </span>
          </button>
          {user && (
            <p className="px-3 text-xs text-gray-400 truncate">{user.email}</p>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="h-4 w-4 text-gray-400" />
            {t('nav.sign_out')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
