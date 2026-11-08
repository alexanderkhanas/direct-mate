import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, MessageSquare, Plug, Settings, ScrollText, Package, LogOut, GraduationCap, Play, ShoppingCart, ImagePlus, Store, BarChart3, Globe, Ruler, Menu, X, AlertCircle, Power } from './icons';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { usePlural } from '../lib/plural';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useT } from '../i18n';
import { useTenantContext } from '../contexts/TenantContext';
import { IconButton } from './setup/ui';
import { ProgressRing } from './dashboard/ProgressRing';
import { storeInitial } from '../pages/onboarding/SetupShell';
import { doneCount, ownerSteps, type OnboardingStatus } from '../pages/onboarding/steps';

const navItems = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, exact: true },
  { to: '/orders', key: 'nav.orders', icon: ShoppingCart },
  { to: '/conversations', key: 'nav.conversations', icon: MessageSquare },
  { to: '/catalog', key: 'nav.catalog', icon: Package },
  { to: '/connections', key: 'nav.connections', icon: Plug },
  { to: '/training', key: 'nav.training', icon: GraduationCap },
  // Scenario packs run paid model calls; owners get their own test chat in the setup flow.
  { to: '/simulator', key: 'nav.simulator', icon: Play, superadminOnly: true },
  { to: '/content-linking', key: 'nav.content', icon: ImagePlus },
  { to: '/size-charts', key: 'nav.size_charts', icon: Ruler },
  { to: '/settings', key: 'nav.settings', icon: Settings },
  { to: '/logs', key: 'nav.logs', icon: ScrollText },
];

const adminItems = [
  { to: '/admin/stores', key: 'nav.stores', icon: Store },
  { to: '/admin/analytics', key: 'nav.analytics', icon: BarChart3 },
];

interface PlanInfo {
  plan: { planType: string; status: string } | null;
  usage: { used: number; limit: number | null };
  trialDaysRemaining: number | null;
  trialStarted: boolean;
  active: boolean;
}

function isActivePath(pathname: string, item: { to: string; exact?: boolean }) {
  return item.exact ? pathname === item.to : pathname.startsWith(item.to);
}

/**
 * The admin frame: sidebar, global banner and page. Below md the sidebar
 * becomes a drawer behind the menu button in a phone top bar.
 */
export default function Layout() {
  const location = useLocation();
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 768px)');

  const { data: user } = useQuery<{ email: string; role: string }>({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then((r) => r.data),
    staleTime: Infinity,
  });
  const { data: status } = useQuery<OnboardingStatus>({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get('/onboarding/status').then((r) => r.data),
    staleTime: 30_000,
  });

  const isSuperadmin = user?.role === 'superadmin';

  // The drawer closes on navigation (back/forward included) and when the window grows to desktop.
  useEffect(() => setMenuOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (desktop) setMenuOpen(false);
  }, [desktop]);

  const page = [...navItems, ...adminItems].find((item) => isActivePath(location.pathname, item));

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Admin top bar (superadmin only) */}
      {isSuperadmin && <AdminTopBar />}

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-56 flex-none bg-white border-r border-gray-200 md:flex md:flex-col">
          <Logo className="px-5 py-4 border-b border-gray-100" />
          <SidebarBody status={status} user={user} isSuperadmin={isSuperadmin} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone top bar */}
          <header className="flex h-[60px] flex-none items-center gap-2 border-b border-dm-line bg-white pl-1.5 pr-3 md:hidden">
            <IconButton label={t('setup_outside.menu_open')} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
              <Menu className="h-6 w-6" />
            </IconButton>
            {page ? (
              <b className="min-w-0 truncate text-[17px] font-semibold text-dm-ink">{t(page.key)}</b>
            ) : (
              <Logo />
            )}
            {status && (
              <span
                aria-hidden="true"
                className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-full bg-blue-100 text-[13px] font-semibold text-blue-800"
              >
                {storeInitial(status.store.name)}
              </span>
            )}
          </header>

          <main className="flex-1 overflow-y-auto">
            <GlobalBanner status={status} />
            <div className="max-w-5xl mx-auto px-4 py-5 md:px-8 md:py-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)}>
        <SidebarBody status={status} user={user} isSuperadmin={isSuperadmin} onNavigate={() => setMenuOpen(false)} />
      </MenuDrawer>
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src="/logo-square.png" alt="" className="h-7 w-7 rounded-lg object-cover" />
      <span className="font-semibold text-gray-900 text-sm tracking-tight">DirectMate</span>
    </div>
  );
}

/** The sidebar under the logo: the setup entry, the nav, then language, user and sign-out. Shared by the desktop sidebar and the phone drawer. */
function SidebarBody({
  status,
  user,
  isSuperadmin,
  onNavigate,
}: {
  status?: OnboardingStatus;
  user?: { email: string };
  isSuperadmin: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, lang, setLang } = useT();

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    queryClient.clear();
    navigate('/login');
  };

  const toggleLang = () => setLang(lang === 'uk' ? 'en' : 'uk');

  return (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {status && !status.completed && <SetupEntry status={status} onNavigate={onNavigate} />}

        {navItems.filter((item) => !item.superadminOnly || isSuperadmin).map((item) => {
          const active = isActivePath(location.pathname, item);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors md:min-h-0',
                active
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50',
              )}
            >
              <item.icon className={cn('h-4 w-4', active ? 'text-gray-900' : 'text-gray-400')} filled={active} />
              {t(item.key)}
            </Link>
          );
        })}

        {/* Admin items moved to top bar */}
      </nav>

      {/* Language + User + Sign out */}
      <div className="px-3 py-3 border-t border-gray-100 space-y-1 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-3">
        <button
          onClick={toggleLang}
          className="flex min-h-11 items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors md:min-h-0"
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
          className="flex min-h-11 items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors md:min-h-0"
        >
          <LogOut className="h-4 w-4 text-gray-400" />
          {t('nav.sign_out')}
        </button>
      </div>
    </>
  );
}

/** While setup is unfinished: «Налаштування · 3 з 6 кроків» with a progress ring, back into setup. */
function SetupEntry({ status, onNavigate }: { status: OnboardingStatus; onNavigate?: () => void }) {
  const { t } = useT();
  const steps = ownerSteps(status);
  const done = doneCount(steps);
  return (
    <Link
      to="/onboarding"
      onClick={onNavigate}
      className="mb-2.5 flex min-h-11 items-center gap-2.5 rounded-xl bg-blue-50 p-2.5 text-blue-800 transition-colors hover:bg-blue-100"
    >
      <ProgressRing value={done} max={steps.length} />
      <span className="flex min-w-0 flex-col">
        <b className="text-[13px] font-semibold">{t('setup_outside.setup_entry')}</b>
        <span className="text-xs">{t('setup_outside.setup_entry_progress', { done, total: steps.length })}</span>
      </span>
    </Link>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The phone menu: a left panel over a scrim. Esc and the scrim close it; focus
 * stays inside while it's open and returns to the menu button (as in `Sheet`,
 * which has no left side).
 */
function MenuDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-[rgba(18,24,38,.45)]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('setup_outside.menu')}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-dm-sheet outline-none"
      >
        <div className="flex flex-none items-center justify-between border-b border-gray-100 py-2 pl-5 pr-2">
          <Logo />
          <IconButton label={t('setup_shell.close')} onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function AdminTopBar() {
  const location = useLocation();
  const { selectedTenantId, setSelectedTenantId, tenants } = useTenantContext();

  const adminLinks = [
    { to: '/admin/stores', label: 'Stores', icon: Store },
    { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/admin/config', label: 'Config', icon: Settings },
  ];

  return (
    <div className="bg-indigo-600 text-white px-4 py-1.5 flex items-center gap-4 overflow-x-auto whitespace-nowrap text-xs">
      <span className="font-semibold tracking-wide uppercase text-indigo-200 mr-2">Admin</span>
      {adminLinks.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors',
            location.pathname.startsWith(link.to)
              ? 'bg-indigo-500 text-white'
              : 'text-indigo-200 hover:text-white hover:bg-indigo-500/50',
          )}
        >
          <link.icon className="h-3.5 w-3.5" />
          {link.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <Store className="h-3.5 w-3.5 text-indigo-300" />
        <select
          value={selectedTenantId ?? ''}
          onChange={(e) => setSelectedTenantId(e.target.value || null)}
          className="bg-indigo-500 text-white text-xs border border-indigo-400 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-white/30"
        >
          <option value="">All stores</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Global banners ─────────────────────────────────────────

type BannerTone = 'red' | 'amber' | 'blue';

const BANNER_TONE: Record<BannerTone, string> = {
  red: 'bg-dm-red-bg border-dm-red-line text-dm-red',
  amber: 'bg-dm-amber-bg border-dm-amber-line text-dm-amber-ink',
  blue: 'bg-blue-50 border-blue-100 text-blue-800',
};

// On a phone the action is its own full-width line, at least 44 px tall; from md it sits at the end of the row.
const BANNER_ACTION =
  'flex min-h-11 w-full items-center font-semibold underline decoration-1 underline-offset-[3px] md:min-h-0 md:w-auto md:whitespace-nowrap';

/**
 * One banner above every admin page, the most urgent that applies: plan
 * inactive, then setup unfinished (not on the Dashboard, where the setup card
 * replaces it), then the running trial.
 */
function GlobalBanner({ status }: { status?: OnboardingStatus }) {
  const location = useLocation();
  const { data: plan, isPending } = useQuery<PlanInfo>({
    queryKey: ['subscription-plan'],
    queryFn: () => api.get('/subscriptions/plan').then((r) => r.data),
    staleTime: 60_000,
  });
  // Decide once the plan is known, so a setup banner doesn't flash before a red one.
  if (isPending) return null;
  if (plan && !plan.active) return <InactiveBanner />;
  if (status && !status.completed && location.pathname !== '/') return <SetupBanner status={status} />;
  if (plan?.plan?.planType === 'trial' && plan.trialStarted) return <TrialBanner plan={plan} />;
  return null;
}

function Banner({
  tone,
  icon,
  compact,
  children,
}: {
  tone: BannerTone;
  icon?: ReactNode;
  /** The trial: one smaller line. */
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 border-b px-4 pt-3 md:items-center md:gap-3 md:px-8',
        compact ? 'text-[13px] md:py-2' : 'text-sm md:py-2.5',
        BANNER_TONE[tone],
      )}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-3">{children}</div>
    </div>
  );
}

/** The bot is silent: the trial or the paid period ended. Not dismissible. */
function InactiveBanner() {
  const { t } = useT();
  return (
    <Banner tone="red" icon={<AlertCircle className="h-5 w-5 flex-none" aria-hidden="true" />}>
      <span className="md:hidden">{t('setup_outside.banner_inactive_short')}</span>
      <span className="hidden md:inline md:flex-1">{t('plan_banner.inactive')}</span>
      <Link to="/settings#subscription" className={cn(BANNER_ACTION, 'md:hidden')}>
        {t('plan_banner.choose_plan')}
        <span aria-hidden="true">&nbsp;→</span>
      </Link>
      <Link
        to="/settings#subscription"
        className="hidden h-9 flex-none items-center rounded-[10px] bg-dm-red px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#912018] md:inline-flex"
      >
        {t('plan_banner.choose_plan')}
      </Link>
    </Banner>
  );
}

function SetupBanner({ status }: { status: OnboardingStatus }) {
  const { t } = useT();
  const steps = ownerSteps(status);
  const done = doneCount(steps);
  return (
    <Banner tone="amber" icon={<Power className="h-5 w-5 flex-none" aria-hidden="true" />}>
      <span className="md:hidden">{t('setup_outside.banner_setup_short', { done, total: steps.length })}</span>
      <span className="hidden md:inline md:flex-1">{t('setup_outside.banner_setup')}</span>
      <span className="hidden items-center gap-2 text-[13px] tabular-nums md:inline-flex">
        <span className="relative h-1 w-[72px] overflow-hidden rounded-sm bg-dm-amber/20" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 bg-dm-amber" style={{ width: `${(done / Math.max(1, steps.length)) * 100}%` }} />
        </span>
        {t('setup_outside.progress', { done, total: steps.length })}
      </span>
      <Link to="/onboarding" className={BANNER_ACTION}>
        {t('setup_outside.banner_setup_link')}
        <span aria-hidden="true">&nbsp;→</span>
      </Link>
    </Banner>
  );
}

/** Quiet while the trial has room; amber in its last 3 days or past 80 % of its conversations. */
function TrialBanner({ plan }: { plan: PlanInfo }) {
  const { t } = useT();
  const plural = usePlural();
  const days = plan.trialDaysRemaining ?? 0;
  const { used, limit } = plan.usage;
  const urgent = days <= 3 || (limit !== null && limit > 0 && used >= 0.8 * limit);
  const daysText = plural(days, 'setup_outside.days');
  const message =
    limit !== null
      ? t('setup_outside.banner_trial', { days: daysText, conversations: plural(Math.max(0, limit - used), 'setup_outside.conversations') })
      : t('setup_outside.banner_trial_days', { days: daysText });
  return (
    <Banner tone={urgent ? 'amber' : 'blue'} compact>
      <span className="md:flex-1">{message}</span>
      <Link to="/settings#subscription" className={BANNER_ACTION}>
        {t('plan_banner.choose_plan')}
      </Link>
    </Banner>
  );
}
