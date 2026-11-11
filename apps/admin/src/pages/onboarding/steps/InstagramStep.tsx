import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Info, ShieldCheck } from '../../../components/icons';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { useT } from '../../../i18n';
import { Alert, StepTitle, CheckMark, Switch, TextLink } from '../../../components/setup/ui';
import { SetUpForMeButton } from '../../../components/onboarding/SetUpForMeButton';
import { AiLearning } from '../../../components/onboarding/AiLearning';
import {
  HISTORY_KEY,
  factSections,
  historyPhase,
  useHistoryImport,
  useStartHistoryImport,
  type HistoryImport,
  type HistoryImportView,
} from '../../../components/onboarding/historyImport';
import { useSetup, useSetupStep } from '../SetupContext';
import { storeInitial } from '../SetupShell';

/** Reasons the API's Instagram callback can send back (integrations.controller.ts). */
const KNOWN_REASONS = [
  'cancelled',
  'missing_params',
  'invalid_state',
  'no_account',
  'multiple_accounts',
  'subscribe_failed',
  'exchange_failed',
] as const;

function reasonKey(reason: string | null): string {
  return reason && (KNOWN_REASONS as readonly string[]).includes(reason) ? reason : 'unknown';
}

/**
 * Instagram (boards m50, m51), right after products: what to check before the
 * Facebook login, whether to read recent chats (they draft the notes and the
 * tone), the login itself, what went wrong when Meta sends the owner back, and
 * the connected account with the reading's progress. The bot stays off until
 * the last step; «Підключити пізніше» moves on without connecting.
 */
export default function InstagramStep() {
  const { t } = useT();
  const qc = useQueryClient();
  const { status, oauth, goNext } = useSetup();
  const connected = !status.readiness.missing.includes('instagram');
  const failed = oauth && !oauth.ok ? reasonKey(oauth.reason) : null;

  const history = useHistoryImport({ poll: true });
  const imp = history.data?.import ?? null;
  // On by default; a choice saved earlier wins until the owner flips it here.
  const [consentPick, setConsentPick] = useState<boolean | null>(null);
  const consent = consentPick ?? imp?.consent ?? true;

  const start = useMutation({
    mutationFn: async () => {
      // Saved before the login, so the reading can start as soon as Meta sends the owner back. Only a
      // choice that's known: one the owner made here, or the saved one (or the default) once it's loaded,
      // never the default while that's still loading or failed to load. Not a reason to stop the login:
      // «Прочитати переписки» asks again later.
      if (consentPick !== null || history.isSuccess) {
        await api.post('/onboarding/history/consent', { read: consent }).catch(() => undefined);
      }
      return api.post<{ redirectUrl: string }>('/connections/instagram/oauth/start', { returnTo: 'onboarding' }).then((r) => r.data);
    },
    onSuccess: ({ redirectUrl }) => {
      window.location.href = redirectUrl;
    },
  });

  const requestImport = useMutation({
    mutationFn: () => api.post<HistoryImportView>('/onboarding/history/import').then((r) => r.data),
    onSuccess: (view) => qc.setQueryData(HISTORY_KEY, view),
  });

  // Connected with consent and nothing asked for yet (back from Meta, or a reload): queue the reading, once.
  const shouldRequest = connected && !!history.data?.instagramConnected && !!imp?.consent && historyPhase(imp) === 'none';
  const requested = useRef(false);
  const { mutate: request } = requestImport;
  useEffect(() => {
    if (!shouldRequest || requested.current) return;
    requested.current = true;
    request();
  }, [shouldRequest, request]);

  // Back from Facebook via the browser's back button, Safari restores the page as it was (spinner on): reset it.
  const { reset } = start;
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && reset();
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);

  useSetupStep({
    // Connected: the default «Далі».
    primary: connected
      ? undefined
      : {
          label: failed ? t('setup_launch.ig_retry') : t('instagram_connect.button'),
          onClick: () => start.mutate(),
          // Stays busy until the browser leaves for Meta.
          loading: start.isPending || start.isSuccess,
        },
    // The step stays to do; the go-live step sends the owner back here.
    secondary: connected ? null : { label: t('setup_history.later'), onClick: goNext },
  });

  const showHelp = !connected && (failed !== null || start.isError);
  // Connected: whether the chats are (being) read, once that's known.
  const reads = connected ? !history.data || !!imp?.consent : consent;

  return (
    <>
      <StepTitle
        title={t('setup.step_instagram')}
        lead={failed && !connected ? undefined : t(reads ? 'setup_history.ig_lead' : 'setup_history.ig_lead_no_read')}
      />

      {start.isError && (
        <Alert tone="error" title={t('setup_launch.ig_error_start_title')}>
          {t('setup_launch.ig_error_start')}
        </Alert>
      )}
      {failed && (
        <Alert tone="error" title={t(`setup_launch.ig_error_${failed}_title`)}>
          {t(`setup_launch.ig_error_${failed}`)}
        </Alert>
      )}

      <Alert tone="info" icon={<ShieldCheck className="mt-px h-5 w-5 flex-none" aria-hidden="true" />} title={t('setup_history.ig_safe')}>
        {t('setup_history.ig_safe_text')}
      </Alert>

      {connected ? (
        <>
          <Alert tone="success" title={t('setup_launch.ig_connected')}>
            {status.store.instagram && `@${status.store.instagram}`}
          </Alert>
          {history.data && (
            <ImportLine imp={imp} offerRead={historyPhase(imp) === 'none' && (!imp?.consent || requestImport.isError)} />
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-[14px] border border-dm-line bg-white p-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium text-dm-ink">{t('setup_history.consent_title')}</span>
              <span className="text-sm text-dm-muted">{t('setup_history.consent_note')}</span>
            </div>
            <Switch checked={consent} onChange={setConsentPick} label={t('setup_history.consent_title')} />
          </div>
          {failed === 'multiple_accounts' ? <MetaAccountsExample shop={status.store.instagram ?? status.store.name} /> : <Preflight />}
        </>
      )}

      {showHelp && (
        <SetUpForMeButton
          look="inline"
          step="instagram"
          topic="instagram"
          lead={t('setup_launch.ig_help_lead')}
          label={t('setup_launch.ig_help')}
          className="self-start"
        />
      )}
    </>
  );
}

/**
 * The reading's progress under the connected account, in one line. With no
 * consent (connected before, or the switch was off), or after a failure, a
 * link starts it (again).
 */
function ImportLine({ imp, offerRead }: { imp: HistoryImport | null; offerRead: boolean }) {
  const { t } = useT();
  const read = useStartHistoryImport();
  const phase = historyPhase(imp);
  const link = (
    <div className="flex flex-col text-sm">
      <TextLink onClick={() => read.mutate()} disabled={read.isPending} className="inline-flex min-h-11 items-center self-start">
        {t('setup_history.read_link')}
      </TextLink>
      {read.isError && (
        <p role="alert" className="text-dm-red">
          {t('setup_history.read_failed')}
        </p>
      )}
    </div>
  );

  if (phase === 'none') return offerRead ? link : null;
  if (phase === 'reading') return <AiLearning title={t('setup_history.status_reading')} text={t('setup_history.status_reading_text')} />;

  const sections = factSections(imp);
  const doneKey =
    sections.includes('delivery') && sections.includes('payment')
      ? 'status_done_terms'
      : sections.includes('delivery')
        ? 'status_done_delivery'
        : sections.includes('payment')
          ? 'status_done_payment'
          : 'status_done_tone';
  const line: Record<Exclude<typeof phase, 'none' | 'reading'>, { icon: ReactNode; text: string }> = {
    done: { icon: <CheckCircle2 className="h-5 w-5 flex-none text-dm-green-icon" />, text: t(`setup_history.${doneKey}`) },
    limited: { icon: <Clock className="h-5 w-5 flex-none text-dm-muted" />, text: t('setup_history.status_limited') },
    waiting: { icon: <Clock className="h-5 w-5 flex-none text-dm-muted" />, text: t('setup_history.status_waiting') },
    empty: { icon: <Info className="h-5 w-5 flex-none text-dm-muted" />, text: t('setup_history.status_empty') },
    failed: { icon: <Info className="h-5 w-5 flex-none text-dm-muted" />, text: t('setup_history.status_failed') },
  };
  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="flex items-start gap-2.5 text-[15px] text-dm-ink2">
        <span aria-hidden="true" className="mt-px">
          {line[phase].icon}
        </span>
        {line[phase].text}
      </p>
      {phase === 'failed' && link}
    </div>
  );
}

type CheckKey = 'professional' | 'facebook' | 'single';

/** «Перед входом перевірте»: three things to have ready. The ticks are the owner's own checklist and block nothing. */
function Preflight() {
  const { t } = useT();
  const whyId = useId();
  const [ticked, setTicked] = useState<Record<CheckKey, boolean>>({ professional: false, facebook: false, single: false });
  const [whyOpen, setWhyOpen] = useState(false);
  const tick = (key: CheckKey) => (next: boolean) => setTicked((prev) => ({ ...prev, [key]: next }));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-dm-ink2">{t('setup_launch.ig_check_title')}</h2>
      <div className="rounded-2xl border border-dm-line bg-white p-1">
        <PreflightRow
          checked={ticked.professional}
          onChange={tick('professional')}
          title={t('setup_launch.ig_check_professional')}
          description={
            <span className="mt-1 rounded-[10px] bg-dm-bg px-3 py-2.5 text-sm text-dm-ink2">{t('setup_launch.ig_check_professional_how')}</span>
          }
        />
        <Divider />
        <PreflightRow
          checked={ticked.facebook}
          onChange={tick('facebook')}
          title={t('setup_launch.ig_check_facebook')}
          description={<span className="text-sm text-dm-muted">{t('setup_launch.ig_check_facebook_desc')}</span>}
          aside={
            <button
              type="button"
              aria-expanded={whyOpen}
              aria-controls={whyId}
              onClick={() => setWhyOpen((open) => !open)}
              className="-my-2.5 inline-flex h-11 flex-none items-center px-1 text-sm font-medium text-blue-800 underline decoration-1 underline-offset-[3px] hover:text-blue-700"
            >
              {t('setup_launch.ig_why')}
            </button>
          }
        />
        <p id={whyId} hidden={!whyOpen} className="mb-3 ml-12 mr-3 rounded-[10px] bg-dm-bg px-3 py-2.5 text-sm text-dm-ink2">
          {t('setup_launch.ig_why_text')}
        </p>
        <Divider />
        <PreflightRow
          checked={ticked.single}
          onChange={tick('single')}
          title={t('setup_launch.ig_check_single')}
          description={<span className="text-sm text-dm-muted">{t('setup_launch.ig_check_single_desc')}</span>}
        />
      </div>
      <p className="text-[13px] text-dm-muted">{t('setup_launch.ig_checks_note')}</p>
    </section>
  );
}

function PreflightRow({
  checked,
  onChange,
  title,
  description,
  aside,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: ReactNode;
  /** Sits outside the label, so pressing it doesn't toggle the tick. */
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 p-3">
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <CheckBox on={checked} className="peer-focus-visible:ring-4 peer-focus-visible:ring-blue-100" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="text-[15px] font-semibold text-dm-ink">{title}</b>
          {description}
        </span>
      </label>
      {aside}
    </div>
  );
}

function CheckBox({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-px grid h-6 w-6 flex-none place-items-center rounded-[7px] border-[1.5px] text-white',
        on ? 'border-blue-600 bg-blue-600' : 'border-dm-line2 bg-white',
        className,
      )}
    >
      {on && <CheckMark className="h-[15px] w-[15px]" />}
    </span>
  );
}

function Divider() {
  return <hr className="ml-12 h-px border-0 bg-dm-line" />;
}

/** m51: Meta's account picker with only the shop ticked. A picture, so it's hidden from screen readers; the note says it in words. */
function MetaAccountsExample({ shop }: { shop: string }) {
  const { t } = useT();
  const others = [t('setup_launch.ig_example_other'), t('setup_launch.ig_example_personal')];
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-dm-ink2">{t('setup_launch.ig_meta_example')}</h2>
      <div aria-hidden="true" className="rounded-2xl border border-dm-line bg-white p-1">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-blue-100 text-[13px] font-semibold text-blue-800">
            {storeInitial(shop)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-dm-ink">{shop}</span>
          <CheckBox on />
        </div>
        {others.map((name) => (
          <div key={name}>
            <hr className="ml-[58px] h-px border-0 bg-dm-line" />
            <div className="flex items-center gap-3 px-3.5 py-3">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-dm-bubble text-[13px] font-semibold text-dm-muted">
                {storeInitial(name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] text-dm-muted">{name}</span>
              <CheckBox on={false} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[13px] text-dm-muted">{t('setup_launch.ig_meta_example_note')}</p>
    </section>
  );
}
