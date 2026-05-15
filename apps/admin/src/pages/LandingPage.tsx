import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { analytics } from '../lib/analytics';
import {
  MessageSquare,
  Image,
  ShoppingBag,
  BarChart3,
  ArrowRight,
  Bot,
  Zap,
  Shield,
  Shirt,
  Sparkles,
} from 'lucide-react';
import { useT } from '../i18n';
import { Tabs } from '../components/ui/Tabs';
import { getScenariosForTenant, type DemoTenantSlug } from '../components/demo/scenarios';

const DemoWidget = lazy(() =>
  import('../components/demo').then((m) => ({ default: m.DemoWidget })),
);

const DEMO_TABS: Array<{ value: DemoTenantSlug; label: string; icon: React.ReactNode; brandName: string }> = [
  {
    value: 'demo-women-clothes',
    label: 'Жіночий одяг',
    icon: <Shirt className="h-3.5 w-3.5" />,
    brandName: 'StyleBoutique UA',
  },
  {
    value: 'demo-cosmetics',
    label: 'Косметика',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    brandName: 'Glow Cosmetics',
  },
];

export default function LandingPage() {
  const { t } = useT();

  const [tenantSlug, setTenantSlug] = useState<DemoTenantSlug>('demo-women-clothes');
  const scenarios = useMemo(() => getScenariosForTenant(tenantSlug), [tenantSlug]);
  const brandName = useMemo(
    () => DEMO_TABS.find((tab) => tab.value === tenantSlug)?.brandName,
    [tenantSlug],
  );

  const handleTabChange = (slug: DemoTenantSlug) => {
    setTenantSlug(slug);
    analytics.demoTabSwitched(slug);
  };

  const scrollToDemo = () => {
    document.getElementById('demo')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // demo_section_visible — fires once per session, 1s dwell at threshold 0.3.
  // Lives outside the lazy-loaded widget so it captures eyeballs even when
  // the demo chunk hasn't loaded yet (the lazy-load attribution metric).
  const demoSectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (sessionStorage.getItem('demo_section_visible_fired') === '1') return;
    const el = demoSectionRef.current;
    if (!el) return;
    let timer: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          if (timer == null) {
            timer = window.setTimeout(() => {
              sessionStorage.setItem('demo_section_visible_fired', '1');
              analytics.demoSectionVisible();
              observer.disconnect();
            }, 1000);
          }
        } else if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => {
      if (timer != null) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const features = [
    { icon: Bot, titleKey: 'landing.feature_ai_title', descKey: 'landing.feature_ai_desc' },
    { icon: Image, titleKey: 'landing.feature_images_title', descKey: 'landing.feature_images_desc' },
    { icon: ShoppingBag, titleKey: 'landing.feature_orders_title', descKey: 'landing.feature_orders_desc' },
    { icon: BarChart3, titleKey: 'landing.feature_analytics_title', descKey: 'landing.feature_analytics_desc' },
  ];

  const steps = [
    { num: '1', titleKey: 'landing.step1_title', descKey: 'landing.step1_desc' },
    { num: '2', titleKey: 'landing.step2_title', descKey: 'landing.step2_desc' },
    { num: '3', titleKey: 'landing.step3_title', descKey: 'landing.step3_desc' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/logo-square.png"
              alt="DirectMate"
              className="h-6 w-6 sm:h-7 sm:w-7 rounded-md object-cover shrink-0"
            />
            <span className="text-lg sm:text-xl font-bold text-gray-900">DirectMate</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-2 sm:px-4 py-2 whitespace-nowrap">
              {t('landing.cta_signin')}
            </Link>
            <Link
              to="/register"
              onClick={() => analytics.ctaClicked('header', 'primary_cta')}
              className="text-sm bg-gray-900 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              {t('landing.cta_create')}
            </Link>
          </div>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-20 sm:pt-32 pb-10 sm:pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-3 sm:px-4 py-1.5 mb-5 sm:mb-6">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-medium text-gray-600">{t('landing.tagline')}</span>
        </div>
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-gray-900 tracking-tight leading-[1.1] max-w-3xl mx-auto">
          {t('landing.hero_title')}
        </h1>
        <p className="mt-4 sm:mt-6 text-base sm:text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
          {t('landing.hero_subtitle')}
        </p>
        <div className="mt-8 sm:mt-10 flex flex-col items-center sm:flex-row sm:justify-center gap-3 sm:gap-4 max-w-sm sm:max-w-none mx-auto">
          <Link
            to="/register"
            onClick={() => analytics.ctaClicked('hero', 'primary_cta')}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gray-900 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            {t('landing.cta_create')}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => {
              analytics.ctaClicked('hero', 'demo_scroll');
              scrollToDemo();
            }}
            className="inline-flex items-center justify-center gap-2 text-gray-600 bg-white border border-gray-200 px-5 py-2.5 sm:px-6 sm:py-3 rounded-lg text-sm font-medium hover:text-gray-900 hover:border-gray-300 transition-colors whitespace-nowrap"
          >
            Подивитись демо ↓
          </button>
        </div>
      </section>

      <section ref={demoSectionRef} id="demo" className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-24 pb-16 sm:pb-24 scroll-mt-16">
        <div className="text-center mb-8 sm:mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Спробуйте зараз</h2>
          <p className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-500 max-w-lg mx-auto">
            <span className="sm:hidden">Оберіть сценарій нижче ↓</span>
            <span className="hidden sm:inline">
              Оберіть сценарій — побачите як DirectMate відповідає реальним клієнтам у діректі.
            </span>
          </p>
        </div>
        <Tabs<DemoTenantSlug>
          value={tenantSlug}
          onChange={handleTabChange}
          options={DEMO_TABS.map(({ value, label, icon }) => ({ value, label, icon }))}
          ariaLabel="Demo tenant"
        />
        <Suspense fallback={<div className="h-[600px]" aria-hidden />}>
          {/* key={tenantSlug} forces a fresh DemoWidget instance per tab so
              messages, refs, and playback state reset cleanly on tab switch. */}
          <DemoWidget
            key={tenantSlug}
            tenantSlug={tenantSlug}
            scenarios={scenarios}
            brandName={brandName}
          />
        </Suspense>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-center mb-10 sm:mb-14">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{t('landing.features_title')}</h2>
          <p className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-500">{t('landing.features_subtitle')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {features.map((f) => (
            <div key={f.titleKey} className="border border-gray-100 rounded-xl p-5 sm:p-6 hover:border-gray-200 transition-colors">
              <div className="bg-gray-50 rounded-lg p-2.5 w-fit">
                <f.icon className="h-5 w-5 text-gray-700" />
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">{t(f.titleKey)}</h3>
              <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t(f.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10 sm:mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{t('landing.steps_title')}</h2>
            <p className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-500">{t('landing.steps_subtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6 sm:gap-8">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-gray-900 text-white text-sm font-bold mb-3 sm:mb-4">
                  {s.num}
                </div>
                <h3 className="font-semibold text-gray-900">{t(s.titleKey)}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t(s.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        <div className="bg-gray-900 rounded-2xl px-6 sm:px-8 py-10 sm:py-14">
          <Shield className="h-8 w-8 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl sm:text-3xl font-bold text-white">{t('landing.cta_bottom_title')}</h2>
          <p className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-400 max-w-lg mx-auto">{t('landing.cta_bottom_subtitle')}</p>
          <Link
            to="/register"
            onClick={() => analytics.ctaClicked('bottom_cta', 'primary_cta')}
            className="mt-6 sm:mt-8 inline-flex items-center justify-center gap-2 bg-white text-gray-900 px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            {t('landing.cta_bottom_button')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-gray-100 py-6 sm:py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-400">
            <MessageSquare className="h-4 w-4" />
            <span className="text-sm">DirectMate</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-6">
            <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Terms and Conditions
            </Link>
            <Link to="/data-deletion" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Data Deletion
            </Link>
            <span className="text-xs text-gray-400">&copy; 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
