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
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/conversations', label: 'Conversations', icon: MessageSquare },
  { to: '/catalog', label: 'Catalog', icon: Package },
  { to: '/connections', label: 'Connections', icon: Plug },
  { to: '/training', label: 'Training', icon: GraduationCap },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/testing', label: 'Testing', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/logs', label: 'Logs', icon: ScrollText },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const { data: user } = useQuery<{ email: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
    staleTime: Infinity,
  });

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    navigate('/login');
  };

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
          {nav.map((item) => {
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
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User + sign out */}
        <div className="px-3 py-3 border-t border-gray-100">
          {user && (
            <p className="px-3 text-xs text-gray-400 truncate mb-1">{user.email}</p>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="h-4 w-4 text-gray-400" />
            Sign out
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
