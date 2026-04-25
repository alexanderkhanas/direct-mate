import { Link } from 'react-router-dom';
import {
  MessageSquare,
  Image,
  ShoppingBag,
  BarChart3,
  ArrowRight,
  Bot,
  Zap,
  Shield,
} from 'lucide-react';
import { useT } from '../i18n';
import { DemoWidget } from '../components/demo';

export default function LandingPage() {
  const { t } = useT();

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
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-gray-900" />
            <span className="text-xl font-bold text-gray-900">DirectMate</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-4 py-2">
              {t('landing.cta_signin')}
            </Link>
            <Link to="/register" className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
              {t('landing.cta_create')}
            </Link>
          </div>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-4 py-1.5 mb-6">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-xs font-medium text-gray-600">{t('landing.tagline')}</span>
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 tracking-tight leading-tight max-w-3xl mx-auto">
          {t('landing.hero_title')}
        </h1>
        <p className="mt-6 text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
          {t('landing.hero_subtitle')}
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/register" className="inline-flex items-center gap-2 bg-gray-900 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">
            {t('landing.cta_create')}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/login" className="inline-flex items-center gap-2 text-gray-600 px-6 py-3 rounded-lg text-sm font-medium hover:text-gray-900 transition-colors border border-gray-200 hover:border-gray-300">
            {t('landing.cta_signin')}
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-gray-900">{t('landing.features_title')}</h2>
          <p className="mt-3 text-gray-500">{t('landing.features_subtitle')}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div key={f.titleKey} className="border border-gray-100 rounded-xl p-6 hover:border-gray-200 transition-colors">
              <div className="bg-gray-50 rounded-lg p-2.5 w-fit">
                <f.icon className="h-5 w-5 text-gray-700" />
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">{t(f.titleKey)}</h3>
              <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t(f.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-gray-900">{t('landing.steps_title')}</h2>
            <p className="mt-3 text-gray-500">{t('landing.steps_subtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-gray-900 text-white text-sm font-bold mb-4">
                  {s.num}
                </div>
                <h3 className="font-semibold text-gray-900">{t(s.titleKey)}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{t(s.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900">Спробуйте зараз</h2>
          <p className="mt-3 text-gray-500 max-w-lg mx-auto">
            Оберіть сценарій — побачите як DirectMate відповідає реальним клієнтам у DM.
          </p>
        </div>
        <DemoWidget />
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <div className="bg-gray-900 rounded-2xl px-8 py-14">
          <Shield className="h-8 w-8 text-gray-400 mx-auto mb-4" />
          <h2 className="text-3xl font-bold text-white">{t('landing.cta_bottom_title')}</h2>
          <p className="mt-3 text-gray-400 max-w-lg mx-auto">{t('landing.cta_bottom_subtitle')}</p>
          <Link to="/register" className="mt-8 inline-flex items-center gap-2 bg-white text-gray-900 px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors">
            {t('landing.cta_bottom_button')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400">
            <MessageSquare className="h-4 w-4" />
            <span className="text-sm">DirectMate</span>
          </div>
          <div className="flex items-center gap-6">
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
