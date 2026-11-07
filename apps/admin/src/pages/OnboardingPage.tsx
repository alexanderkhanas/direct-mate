import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Circle, Minus } from 'lucide-react';
import { api } from '../lib/api';
import type { TenantSettings } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/Spinner';
import { ProductSourcePanel } from '../components/catalog/ProductSourcePanel';
import { InstagramConnectButton, useInstagramOAuthResult } from '../components/connections/InstagramConnect';
import { TelegramConnectSection } from '../components/connections/TelegramConnectSection';
import { BrandToneSection, ExamplesSection, KnowledgeSection, SizingSection } from '../components/settings/StoreSettingsSections';
import { OwnerTestChat } from '../components/onboarding/OwnerTestChat';
import { SetUpForMeButton } from '../components/onboarding/SetUpForMeButton';
import { useT } from '../i18n';
import { cn } from '../lib/cn';

type StepKey = 'instagram' | 'products' | 'knowledge' | 'tone' | 'sizes' | 'telegram' | 'test' | 'live';

// Mirrors apps/api/src/modules/onboarding/onboarding.service.ts.
export interface OnboardingStatus {
  completed: boolean;
  operatingMode: string;
  steps: Array<{ key: StepKey; state: 'todo' | 'done' | 'skipped'; blocking: boolean }>;
  readiness: { ready: boolean; missing: Array<'instagram' | 'products' | 'knowledge'> };
  store: { name: string; businessType: string; instagram: string | null; feedUrl: string | null };
  supportAvailable: boolean;
}

/**
 * Self-serve setup: from sign-up to a bot that answers customers. Each step
 * embeds the same form the rest of the admin uses; its state comes from the
 * store's real data (GET /onboarding/status), so finishing it anywhere ticks
 * it here.
 */
export default function OnboardingPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get('/onboarding/status').then((r) => r.data),
  });
  const [active, setActive] = useState<StepKey | null>(null);
  const oauth = useInstagramOAuthResult();

  const refresh = () => qc.invalidateQueries({ queryKey: ['onboarding-status'] });

  // Open on the first step not done yet (or Instagram right after its login).
  useEffect(() => {
    if (!status || active) return;
    setActive(oauth ? 'instagram' : (status.steps.find((s) => s.state === 'todo')?.key ?? 'live'));
  }, [status, active, oauth]);

  const skip = useMutation({
    mutationFn: (key: StepKey) => api.post(`/onboarding/steps/${key}/skip`).then((r) => r.data),
    onSuccess: (next: OnboardingStatus) => {
      qc.setQueryData(['onboarding-status'], next);
      goNext(next);
    },
  });

  if (isLoading || !status || !active) return <LoadingState />;

  const steps = status.steps;
  const index = steps.findIndex((s) => s.key === active);
  const doneCount = steps.filter((s) => s.state === 'done').length;
  function goNext(from: OnboardingStatus = status!) {
    const after = from.steps.slice(index + 1).find((s) => s.state !== 'done') ?? from.steps[index + 1];
    if (after) setActive(after.key);
  }
  const current = steps[index];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('setup.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('setup.subtitle', { done: doneCount, total: steps.length })}</p>
        </div>
        <SetUpForMeButton step={active} available={status.supportAvailable} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-6">
        <nav className="space-y-1">
          {steps.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                s.key === active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <StepIcon state={s.state} n={i + 1} />
              <span className="flex-1">{t(`setup.step_${s.key}`)}</span>
            </button>
          ))}
        </nav>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t(`setup.step_${active}`)}</h2>
            <p className="text-sm text-gray-500 mt-1">{t(`setup.step_${active}_desc`)}</p>
          </div>

          {active === 'instagram' && (
            <Card>
              {oauth && (
                <p className={cn('text-sm mb-3', oauth.ok ? 'text-emerald-700' : 'text-red-600')}>{oauth.message}</p>
              )}
              {status.store.instagram ? (
                <p className="text-sm text-gray-700 mb-3">{t('setup.instagram_connected', { username: status.store.instagram })}</p>
              ) : null}
              <InstagramConnectButton returnTo="onboarding" />
            </Card>
          )}
          {active === 'products' && <ProductSourcePanel onImported={refresh} />}
          {active === 'knowledge' && <KnowledgeSection />}
          {active === 'tone' && <ToneStep />}
          {active === 'sizes' && (
            <>
              <SizingSection hideAdvanced />
              <p className="text-xs text-gray-500">
                {t('setup.sizes_charts_hint')}{' '}
                <Link to="/size-charts" className="text-gray-900 underline">{t('setup.sizes_charts_link')}</Link>
              </p>
            </>
          )}
          {active === 'telegram' && <TelegramConnectSection />}
          {active === 'test' && <OwnerTestChat onMessage={refresh} />}
          {active === 'live' && <GoLiveStep status={status} onChanged={refresh} />}

          {active !== 'live' && (
            <div className="flex items-center gap-3">
              <Button onClick={() => { refresh(); goNext(); }}>
                {t('setup.next')}
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!current.blocking && current.state !== 'done' && (
                <Button variant="ghost" onClick={() => skip.mutate(active)} loading={skip.isPending}>
                  {t('setup.skip')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepIcon({ state, n }: { state: 'todo' | 'done' | 'skipped'; n: number }) {
  if (state === 'done') {
    return (
      <span className="h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === 'skipped') {
    return (
      <span className="h-5 w-5 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className="relative h-5 w-5 flex items-center justify-center text-[10px] text-gray-500">
      <Circle className="h-5 w-5 absolute text-gray-300" />
      {n}
    </span>
  );
}

function ToneStep() {
  const { data } = useQuery<TenantSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data),
  });
  if (!data) return <LoadingState />;
  return (
    <>
      <BrandToneSection settings={data} />
      <ExamplesSection />
    </>
  );
}

function GoLiveStep({ status, onChanged }: { status: OnboardingStatus; onChanged: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setMode = useMutation({
    mutationFn: (mode: 'active' | 'learning') => api.patch('/engine/config', { operatingMode: mode }),
    onSuccess: () => {
      onChanged();
      qc.invalidateQueries({ queryKey: ['engine-config'] });
      navigate('/');
    },
  });
  const telegramDone = status.steps.find((s) => s.key === 'telegram')?.state === 'done';
  const { data: plan } = useQuery<{ plan: { planType: string } | null; trialStarted: boolean }>({
    queryKey: ['subscription-plan'],
    queryFn: () => api.get('/subscriptions/plan').then((r) => r.data),
  });
  const { data: plans } = useQuery<Array<{ planType: string; price: number }>>({
    queryKey: ['available-plans'],
    queryFn: () => api.get('/subscriptions/plans').then((r) => r.data),
  });
  const cheapest = plans?.length ? Math.min(...plans.map((p) => p.price)) / 100 : null;
  const trialAhead = plan?.plan?.planType === 'trial' && !plan.trialStarted;
  const live = status.operatingMode === 'active' || status.operatingMode === 'learning';

  return (
    <Card>
      <ul className="space-y-2 mb-4">
        {(['instagram', 'products', 'knowledge'] as const).map((req) => {
          const ok = !status.readiness.missing.includes(req);
          return (
            <li key={req} className="flex items-center gap-2 text-sm">
              {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-gray-300" />}
              <span className={ok ? 'text-gray-700' : 'text-gray-500'}>{t(`setup.ready_${req}`)}</span>
            </li>
          );
        })}
      </ul>
      {!telegramDone && <p className="text-xs text-amber-700 mb-4">{t('setup.telegram_warning')}</p>}
      {trialAhead && cheapest !== null && (
        <p className="text-sm text-gray-700 bg-violet-50 rounded-lg px-3 py-2 mb-4">
          {t('setup.trial_terms', { price: cheapest.toLocaleString('uk-UA') })}
        </p>
      )}
      {live ? (
        <p className="text-sm text-emerald-700">{t(`setup.already_${status.operatingMode}`)}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setMode.mutate('active')} loading={setMode.isPending} disabled={!status.readiness.ready}>
            {t('setup.go_live')}
          </Button>
          <Button variant="secondary" onClick={() => setMode.mutate('learning')} disabled={setMode.isPending}>
            {t('setup.watch_first')}
          </Button>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-3">{t('setup.watch_first_desc')}</p>
    </Card>
  );
}
