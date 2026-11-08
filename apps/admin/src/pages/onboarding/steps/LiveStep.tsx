import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import { Alert, StepTitle, TextLink, Tick } from '../../../components/setup/ui';
import { TelegramCard } from '../../../components/onboarding/launch/TelegramCard';
import { useCheapestPrice, useSubscriptionPlan } from '../../../components/onboarding/launch/plan';
import { useSetup, useSetupStep } from '../SetupContext';

/** What the server needs before the bot may answer customers, in step order (each is also the step that fixes it). */
const REQUIREMENTS = ['products', 'knowledge', 'instagram'] as const;
type Requirement = (typeof REQUIREMENTS)[number];

type Mode = 'active' | 'learning';

/** The flat card (trial terms, watch first) with the tighter gap the design uses; `Card` fixes its own gap. */
const NOTE_CARD = 'flex flex-col gap-1 rounded-2xl border border-dm-line bg-dm-sunken p-4';

/**
 * «Увімкнути бота» (m60, m61, d60): what's ready, Telegram for handoffs, the
 * trial terms, then turn the bot on or watch first. While something required
 * is missing, the footer names it and goes there.
 */
export default function LiveStep() {
  const { t } = useT();
  const plural = usePlural();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { status, steps, goTo, refresh } = useSetup();
  const { data: plan } = useSubscriptionPlan();
  const price = useCheapestPrice();
  const [refused, setRefused] = useState<Requirement[] | null>(null);

  const setMode = useMutation({
    mutationFn: (mode: Mode) => api.patch('/engine/config', { operatingMode: mode }),
    onMutate: () => setRefused(null),
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: ['engine-config'] });
      void qc.invalidateQueries({ queryKey: ['subscription-plan'] });
      // Wait for the fresh status (completed), so the success page doesn't send the owner back here.
      await refresh();
      navigate('/onboarding/done');
    },
    onError: (err) => {
      const missing: unknown = isAxiosError(err) ? err.response?.data?.error?.details?.missing : undefined;
      if (Array.isArray(missing)) {
        setRefused(REQUIREMENTS.filter((r) => missing.includes(r)));
        void refresh();
      }
    },
  });
  const pending: Mode | null = setMode.isPending ? setMode.variables : null;

  const missing = REQUIREMENTS.filter((r) => status.readiness.missing.includes(r));
  const instagramConnected = !missing.includes('instagram');
  // Already on, or set to watch; not while this step's own switch is still finishing.
  const live = (status.operatingMode === 'active' || status.operatingMode === 'learning') && !setMode.isPending && !setMode.isSuccess;
  const trialAhead = plan?.plan?.planType === 'trial' && !plan.trialStarted;
  const firstMissing = missing[0];

  useSetupStep(
    live
      ? { primary: { label: t('setup_launch.go_home'), onClick: () => navigate('/') } }
      : {
          primary: firstMissing
            ? {
                label: plural(missing.length, 'setup_launch.steps_left', { what: t(`setup_launch.todo_${firstMissing}`) }),
                onClick: () => goTo(firstMissing),
                variant: 'blocked',
              }
            : {
                label: t('setup.go_live'),
                onClick: () => setMode.mutate('active'),
                loading: pending === 'active',
                disabled: pending === 'learning',
              },
          secondary: instagramConnected
            ? {
                label: t('setup.watch_first'),
                onClick: () => setMode.mutate('learning'),
                loading: pending === 'learning',
                disabled: pending === 'active',
              }
            : null,
        },
  );

  const stepNumber = (key: Requirement) => steps.find((s) => s.key === key)?.n;

  return (
    <>
      <StepTitle title={status.readiness.ready && !live ? t('setup_launch.title_ready') : t('setup.step_live')} lead={t('setup.step_live_desc')} />

      {live && <Alert tone="info" title={t(`setup.already_${status.operatingMode}`)} />}

      {refused && refused.length > 0 ? (
        <Alert tone="error" title={t('setup_launch.refused_title')}>
          {t('setup_launch.refused_text')}
          <ul className="mt-1 flex flex-col">
            {refused.map((r) => (
              <li key={r}>
                <TextLink onClick={() => goTo(r)} className="inline-flex min-h-11 items-center">
                  {t(`setup_launch.missing_${r}`)}
                </TextLink>
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        setMode.isError && (
          <Alert tone="error" title={t('setup_launch.go_live_failed_title')}>
            {t('setup_launch.go_live_failed')}
          </Alert>
        )
      )}

      <ul aria-label={t('setup_launch.checklist')} className="rounded-2xl border border-dm-line bg-white p-1">
        {REQUIREMENTS.map((r, i) => (
          <li key={r}>
            {i > 0 && <hr className="ml-12 h-px border-0 bg-dm-line" />}
            {missing.includes(r) ? (
              <button
                type="button"
                onClick={() => goTo(r)}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-xl bg-blue-50 px-3.5 text-left text-sm font-medium text-dm-ink transition-colors hover:bg-blue-100 lg:min-h-[54px] lg:px-4"
              >
                <Tick state="now" n={stepNumber(r)} />
                <span className="min-w-0 flex-1">{t(`setup_launch.missing_${r}`)}</span>
                <span className="text-sm font-medium text-blue-800 underline decoration-1 underline-offset-[3px]">{t(`setup_launch.fix_${r}`)}</span>
              </button>
            ) : (
              <div className="flex min-h-[52px] items-center gap-3 px-3.5 text-sm text-dm-ink lg:min-h-[54px] lg:px-4">
                <Tick state="done" />
                <span className="min-w-0 flex-1">{t(`setup.ready_${r}`)}</span>
                <ReadyDetail requirement={r} />
              </div>
            )}
          </li>
        ))}
      </ul>

      <TelegramCard />

      {(trialAhead || (instagramConnected && !live)) && (
        <div className="grid gap-3.5 lg:grid-cols-2 lg:gap-4">
          {trialAhead && (
            <div className={NOTE_CARD}>
              <b className="text-[15px] font-semibold text-dm-ink">{t('setup_launch.trial_title')}</b>
              <p className="text-sm text-dm-muted">
                {t('setup_launch.trial_start')}
                {price !== null && <> {t('setup_launch.trial_price', { price: price.toLocaleString('uk-UA') })}</>}
              </p>
            </div>
          )}
          {instagramConnected && !live && (
            <div className={cn(NOTE_CARD, !trialAhead && 'lg:col-span-2')}>
              <b className="text-[15px] font-semibold text-dm-ink">{t('setup_launch.watch_title')}</b>
              <p className="text-sm text-dm-muted">{t('setup_launch.watch_text')}</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** The detail on a done row: «51 з 64» in stock, the Instagram handle. */
function ReadyDetail({ requirement }: { requirement: Requirement }) {
  const { t } = useT();
  const { status } = useSetup();
  const { products, instagram } = status.store;
  const text =
    requirement === 'products'
      ? t('setup_launch.in_stock_of', { inStock: products.inStock, total: products.total })
      : requirement === 'instagram' && instagram
        ? `@${instagram}`
        : null;
  return text ? <span className="min-w-0 truncate text-[13px] text-dm-muted">{text}</span> : null;
}
