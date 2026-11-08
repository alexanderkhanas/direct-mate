import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { Check, ChevronRight, MessageCircle, Sparkles } from '../../components/icons';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { LoadingState } from '../../components/ui/Spinner';
import { buttonClass } from '../../components/setup/ui';
import { useSubscriptionPlan } from '../../components/onboarding/launch/plan';
import type { OnboardingStatus } from './steps';
import { StatusError } from './SetupPage';

/**
 * After go-live (m62, d62): full-screen, outside the setup shell and the admin
 * layout. Says the bot is answering (or watching), whether the trial started,
 * and where to go next. Setup not finished: back to /onboarding.
 */
export default function SuccessPage() {
  const { t } = useT();
  const { data: status, isFetching, isError, refetch } = useQuery<OnboardingStatus>({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get('/onboarding/status').then((r) => r.data),
  });
  const { data: plan } = useSubscriptionPlan();

  if (!status && isError) return <StatusError onRetry={() => void refetch()} />;
  // A cached status from before go-live may still be refreshing: wait for it before sending the owner back.
  if (!status || (!status.completed && isFetching)) return <LoadingState />;
  if (!status.completed) return <Navigate to="/onboarding" replace />;
  // Paused after setup (e.g. from Settings): nothing here would be true, so go to the Dashboard.
  if (status.operatingMode !== 'active' && status.operatingMode !== 'learning') return <Navigate to="/" replace />;

  const learning = status.operatingMode === 'learning';
  const handle = status.store.instagram;
  const title = learning
    ? handle
      ? t('setup_launch.done_learning_title', { handle })
      : t('setup_launch.done_learning_title_plain')
    : handle
      ? t('setup_launch.done_title', { handle })
      : t('setup_launch.done_title_plain');
  const trialRunning = plan?.plan?.planType === 'trial' && plan.trialStarted;
  const lead = learning ? t('setup_launch.done_learning_lead') : trialRunning ? t('setup_launch.done_trial') : null;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white font-sans text-[15px] leading-[1.45] text-dm-ink antialiased">
      <header className="flex h-[60px] flex-none items-center gap-2.5 px-4 text-[15px] font-semibold lg:h-16 lg:px-6">
        <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-blue-600 text-white" aria-hidden="true">
          <MessageCircle className="h-4 w-4" />
        </span>
        DirectMate
      </header>

      <main className="flex flex-1 flex-col items-center px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-8 text-center lg:justify-center lg:px-6 lg:pb-[72px] lg:pt-6">
        <div className="flex w-full max-w-[760px] flex-col items-center gap-3.5 lg:gap-4">
          <span
            role="img"
            aria-label={t('setup_launch.done_medal')}
            className="grid h-[88px] w-[88px] flex-none place-items-center rounded-full bg-dm-green-bg text-dm-green-icon shadow-[0_0_0_10px_#F3FBF6,0_0_0_20px_#F9FDFA] lg:h-[104px] lg:w-[104px]"
          >
            <Check className="h-10 w-10" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-balance lg:mt-6 lg:text-[40px]">{title}</h1>
          {lead && <p className="max-w-[300px] text-[15px] text-dm-muted text-pretty lg:max-w-[560px] lg:text-lg">{lead}</p>}

          <div className="mt-[18px] grid w-full gap-2.5 text-left lg:mt-6 lg:grid-cols-2 lg:gap-4">
            <div className="flex items-start gap-3 rounded-2xl border border-dm-line bg-white p-4">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-blue-50 text-blue-600" aria-hidden="true">
                <MessageCircle className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <b className="text-[15px] font-semibold lg:text-base">{t('setup_launch.done_check_title')}</b>
                <span className="text-sm text-dm-muted">
                  {t(learning ? 'setup_launch.done_check_text_learning' : 'setup_launch.done_check_text')}
                </span>
              </span>
            </div>
            <Link
              to="/"
              className="flex items-center gap-3 rounded-2xl border border-dm-line bg-white p-4 transition-colors hover:border-dm-line2 hover:bg-dm-sunken focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 lg:items-start"
            >
              <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-dm-bubble text-dm-ink2" aria-hidden="true">
                <Sparkles className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="text-[15px] font-semibold lg:text-base">{t('setup_launch.done_better_title')}</b>
                <span className="text-sm text-dm-muted">{t('setup_launch.done_better_text')}</span>
              </span>
              <ChevronRight className="h-5 w-5 flex-none text-dm-muted lg:self-center" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="mt-auto flex w-full flex-col gap-1 pt-6 lg:mt-5 lg:w-auto lg:flex-row lg:gap-2.5 lg:pt-0">
          <Link to="/conversations" className={buttonClass('brand', 'lg', 'w-full lg:w-auto')}>
            {t('setup_launch.done_conversations')}
          </Link>
          <Link to="/" className={buttonClass('ghost', 'lg', 'w-full lg:w-auto')}>
            {t('setup_launch.go_home')}
          </Link>
        </div>
      </main>
    </div>
  );
}
