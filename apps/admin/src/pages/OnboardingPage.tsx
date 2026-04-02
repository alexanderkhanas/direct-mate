import { Link } from 'react-router-dom';
import { Calendar, ArrowRight, CheckCircle, MessageSquare } from 'lucide-react';
import { useT } from '../i18n';

const CALENDLY_URL = 'https://calendly.com/alexander-khanas03/30min';

export default function OnboardingPage() {
  const { t } = useT();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-gray-900" />
          <span className="text-lg font-bold text-gray-900">DirectMate</span>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-lg w-full">
          <div className="flex items-center gap-2 mb-6">
            <CheckCircle className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-medium text-emerald-700">{t('onboarding.success')}</span>
          </div>

          <h1 className="text-3xl font-bold text-gray-900">{t('onboarding.title')}</h1>
          <p className="mt-3 text-gray-500 leading-relaxed">{t('onboarding.subtitle')}</p>

          <div className="mt-8 space-y-3">
            {(['step1', 'step2', 'step3', 'step4'] as const).map((key) => (
              <div key={key} className="flex items-start gap-3">
                <CheckCircle className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                <span className="text-sm text-gray-600">{t(`onboarding.${key}`)}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 space-y-3">
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <Calendar className="h-4 w-4" />
              {t('onboarding.book_call')}
            </a>
            <Link
              to="/"
              className="w-full flex items-center justify-center gap-2 text-gray-500 px-6 py-3 rounded-lg text-sm hover:text-gray-700 transition-colors"
            >
              {t('onboarding.skip')}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <p className="mt-6 text-xs text-gray-400 text-center">{t('onboarding.free_setup')}</p>
        </div>
      </div>
    </div>
  );
}
