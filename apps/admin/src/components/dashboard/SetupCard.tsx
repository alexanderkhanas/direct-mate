import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { usePlural } from '../../lib/plural';
import { buttonClass, Tick } from '../setup/ui';
import { SetUpForMeButton } from '../onboarding/SetUpForMeButton';
import { tickState } from '../../pages/onboarding/SetupShell';
import { doneCount, firstOpenStep, ownerSteps, type OnboardingStatus, type OwnerStep } from '../../pages/onboarding/steps';
import { ProgressRing } from './ProgressRing';

/**
 * The Dashboard's «Завершіть налаштування» card while setup is unfinished: the
 * next step with a way into it, the free-setup offer, and every step linking
 * to its screen. Replaces the global setup banner on the Dashboard.
 */
export function SetupCard({ status }: { status: OnboardingStatus }) {
  const { t } = useT();
  const plural = usePlural();
  const steps = ownerSteps(status);
  const done = doneCount(steps);
  const remaining = steps.filter((s) => s.state === 'todo').length;
  const next = firstOpenStep(steps);
  const progress = t('setup_outside.progress', { done, total: steps.length });

  // Phones: two cards (the next step, then the steps). From md: one card, the next step beside the steps.
  return (
    <section
      aria-label={t('setup_outside.card_title')}
      className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:gap-x-6 md:gap-y-5 md:rounded-2xl md:border md:border-dm-line md:bg-white md:p-6"
    >
      <div className="flex flex-col gap-3.5 rounded-2xl border border-dm-line bg-white p-4 md:contents">
        <div className="flex items-start justify-between gap-4 md:col-span-2 md:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-[17px] font-semibold leading-[1.3] text-dm-ink md:text-xl">{t('setup_outside.card_title')}</h2>
            <p className="text-sm text-dm-muted md:text-[15px]">
              {t('setup_outside.card_lead')}
              {remaining > 0 && <> {plural(remaining, 'setup_outside.remaining')}</>}
            </p>
          </div>
          <span className="flex flex-none items-center gap-2 text-[13px] font-medium tabular-nums text-dm-ink2 md:text-sm">
            <ProgressRing value={done} max={steps.length} size={32} />
            {progress}
          </span>
        </div>

        <div className="flex flex-col gap-3.5 md:gap-3 md:rounded-[14px] md:bg-dm-bg md:p-5">
          <div className="flex flex-col gap-1.5 rounded-xl bg-dm-bg p-3.5 md:contents">
            <span className="text-[13px] font-medium text-blue-800">{t('setup_outside.next_step')}</span>
            <b className="text-base font-semibold text-dm-ink md:text-lg">{t(`setup_shell.step_${next}`)}</b>
            <p className="text-sm text-dm-ink2 md:text-[15px]">{t(`setup_outside.desc_${next}`)}</p>
          </div>
          <div className="flex flex-col items-center gap-2 md:mt-1 md:flex-row md:flex-wrap md:gap-3.5">
            <Link to={`/onboarding?step=${next}`} className={buttonClass('brand', 'lg', 'w-full md:w-auto md:h-12 md:text-[15px]')}>
              {t('setup_outside.continue')}
            </Link>
            <SetUpForMeButton look="pill" step={next} available={status.supportAvailable} />
          </div>
        </div>
      </div>

      <nav aria-label={t('setup_shell.steps_sheet')} className="flex flex-col gap-0.5 rounded-2xl border border-dm-line bg-white p-1 md:self-start md:border-0 md:p-0">
        {steps.map((s) => (
          <Link
            key={s.key}
            to={`/onboarding?step=${s.key}`}
            aria-current={s.key === next ? 'step' : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm transition-colors hover:bg-dm-sunken md:px-2.5',
              s.state === 'done' || s.key === next ? 'text-dm-ink' : 'text-dm-muted',
              s.key === next && 'md:shadow-[inset_0_0_0_1px_theme(colors.blue.200)]',
            )}
          >
            <Tick state={tickState(s, next)} n={s.n} />
            <span className="min-w-0 flex-1">{t(`setup_shell.step_${s.key}`)}</span>
            <span className="text-[13px] text-dm-muted">{stepMeta(s, status.store.products.total, t, plural)}</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}

/** «64 товари» beside a finished products step, «пропущено» beside a skipped one. */
function stepMeta(step: OwnerStep, products: number, t: (key: string) => string, plural: (n: number, keyBase: string) => string): string {
  if (step.key === 'products' && step.state === 'done' && products > 0) return plural(products, 'setup_shell.products');
  if (step.state === 'skipped') return t('setup_shell.skipped');
  return '';
}
