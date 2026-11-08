import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles, X } from '../icons';
import { useT } from '../../i18n';
import { IconButton, Tick } from '../setup/ui';
import { apiState, type ApiStepKey, type OnboardingStatus } from '../../pages/onboarding/steps';
import { getTokenPayload } from '../../lib/auth';
import { useHistoryImport } from '../onboarding/historyImport';

/** Per store: a superadmin switching stores, or two stores in one browser, each get their own card. */
const dismissedKey = () => `dm-improve-bot-dismissed:${getTokenPayload()?.tenantId ?? 'store'}`;

// What setup let the owner skip, and where each is finished. A step the API doesn't report (sizes outside clothing) has no row.
const ITEMS: Array<{ step: ApiStepKey; label: string; to: string }> = [
  { step: 'tone', label: 'setup_outside.improve_tone', to: '/onboarding?step=test' },
  { step: 'sizes', label: 'setup_outside.improve_sizes', to: '/onboarding?step=sizes' },
  { step: 'telegram', label: 'setup_outside.improve_telegram', to: '/connections' },
];

function readDismissed(): boolean {
  try {
    return localStorage.getItem(dismissedKey()) === '1';
  } catch {
    return false;
  }
}

/**
 * «Зробіть AI-агента кращим»: after go-live, the Dashboard lists what was skipped
 * during setup. Hidden once everything is done or the owner dismisses it.
 */
export function ImproveBotCard({ status }: { status: OnboardingStatus }) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(readDismissed);
  const items = ITEMS.filter((item) => {
    const state = apiState(status, item.step);
    return state !== null && state !== 'done';
  });
  const toneOpen = !dismissed && items.some((item) => item.step === 'tone');
  // A tone read from the owner's chats is waiting for approval: say so on the tone row.
  const { data: history } = useHistoryImport({ enabled: toneOpen });
  const toneFromChats = history?.import?.status === 'done' && !history.import.applied;
  if (dismissed || items.length === 0) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissedKey(), '1');
    } catch {
      // Private mode: the card comes back on the next visit, which is harmless.
    }
    setDismissed(true);
  };

  return (
    <section aria-labelledby="improve-bot-title" className="flex flex-col gap-3 rounded-2xl border border-dm-line bg-white p-4 md:max-w-[560px]">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue-50 text-blue-600" aria-hidden="true">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="improve-bot-title" className="text-base font-semibold text-dm-ink">
            {t('setup_outside.improve_title')}
          </h2>
          <span className="text-[13px] text-dm-muted">{t('setup_outside.improve_lead')}</span>
        </div>
        <IconButton label={t('setup_outside.improve_hide')} onClick={dismiss}>
          <X className="h-5 w-5" />
        </IconButton>
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.step}>
            <Link to={item.to} className="flex min-h-11 items-center gap-3 rounded-xl px-2.5 text-sm text-dm-ink transition-colors hover:bg-dm-sunken">
              <Tick state="todo" />
              <span className="min-w-0 flex-1">{t(item.step === 'tone' && toneFromChats ? 'setup_history.improve_tone' : item.label)}</span>
              <ChevronRight className="h-4 w-4 flex-none text-dm-faint" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
