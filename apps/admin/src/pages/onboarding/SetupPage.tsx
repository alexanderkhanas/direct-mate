import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { LoadingState } from '../../components/ui/Spinner';
import { Alert, SetupButton } from '../../components/setup/ui';
import { useT } from '../../i18n';
import { SetupProvider, type InstagramOAuthReturn, type SetupContextValue } from './SetupContext';
import { SetupShell } from './SetupShell';
import {
  firstOpenStep,
  isOwnerStepKey,
  nextStep,
  ownerSteps,
  previousStep,
  type OnboardingStatus,
  type OwnerStepKey,
} from './steps';

const INTRO_SEEN_KEY = 'dm-setup-intro-seen';

function readIntroSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Self-serve setup, full-screen and outside the admin layout. The active step
 * lives in `?step=` so the browser's back button works; each step's state comes
 * from the store's real data (GET /onboarding/status).
 */
export default function SetupPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: status, isError, refetch } = useQuery<OnboardingStatus>({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get('/onboarding/status').then((r) => r.data),
  });

  // Meta sends the owner back with ?instagram=…: open that step and keep the result for it.
  const [oauth] = useState<InstagramOAuthReturn | null>(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get('instagram');
    return result ? { ok: result === 'connected', reason: q.get('reason') } : null;
  });
  // The intro shows once, on a plain first visit (decided before `?step=` is pinned below).
  const [intro, setIntro] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return !readIntroSeen() && !q.has('step') && !q.has('instagram');
  });

  const steps = useMemo(() => (status ? ownerSteps(status) : []), [status]);
  const requested = params.get('step');
  const active: OwnerStepKey | null = !status
    ? null
    : isOwnerStepKey(requested) && steps.some((s) => s.key === requested)
      ? requested
      : oauth
        ? 'instagram'
        : firstOpenStep(steps);

  // Pin the opening step in the URL (dropping the OAuth params), so it doesn't move as steps finish.
  useEffect(() => {
    if (active && requested !== active) setParams({ step: active }, { replace: true });
  }, [active, requested, setParams]);

  const goTo = useCallback((key: OwnerStepKey) => setParams({ step: key }), [setParams]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['onboarding-status'] }), [qc]);

  const skipMutation = useMutation({
    mutationFn: (key: OwnerStepKey) => api.post<OnboardingStatus>(`/onboarding/steps/${key}/skip`).then((r) => r.data),
    onSuccess: (next, key) => {
      qc.setQueryData(['onboarding-status'], next);
      const to = nextStep(ownerSteps(next), key);
      if (to) goTo(to);
    },
  });

  if (!status && isError) return <StatusError onRetry={() => void refetch()} />;
  if (!status || !active) return <LoadingState />;

  const current = steps.find((s) => s.key === active)!;
  const showIntro = intro && steps.every((s) => s.state !== 'done');

  const value: SetupContextValue = {
    status,
    steps,
    active,
    current,
    goTo,
    goNext: () => {
      // A step that just saved has put the fresh status in the cache; decide from that, then refetch.
      const latest = qc.getQueryData<OnboardingStatus>(['onboarding-status']) ?? status;
      void refresh();
      const to = nextStep(ownerSteps(latest), active);
      if (to) goTo(to);
    },
    goBack: () => {
      const to = previousStep(steps, active);
      if (to) goTo(to);
    },
    refresh,
    skip: () => skipMutation.mutate(active),
    skipping: skipMutation.isPending,
    oauth,
  };

  return (
    <SetupProvider value={value}>
      <SetupShell
        intro={showIntro}
        onIntroDone={() => {
          try {
            localStorage.setItem(INTRO_SEEN_KEY, '1');
          } catch {
            // Private mode: the intro shows again next time, which is harmless.
          }
          setIntro(false);
        }}
        skipFailed={skipMutation.isError}
      />
    </SetupProvider>
  );
}

/** The status couldn't be read (a 500, a dropped connection): say so, and offer a retry instead of a spinner. */
export function StatusError({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-4 bg-dm-bg px-4 font-sans">
      <Alert tone="error" title={t('setup_shell.load_failed_title')}>
        {t('setup_shell.load_failed_text')}
      </Alert>
      <SetupButton size="lg" onClick={onRetry}>
        {t('setup_shell.retry')}
      </SetupButton>
    </div>
  );
}
