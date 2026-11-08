import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';

export type HelpTopic = 'other_platform' | 'shopify' | 'instagram' | 'feed';

interface Props {
  /** The setup step the owner is on; goes into the pre-written message. */
  step?: string;
  /** What they want help with (adds a line; `other_platform` leaves it for them to finish). */
  topic?: HelpTopic;
  /** pill: the top bar · card: the intro screen · inline: a link inside an alert or a sheet. */
  look?: 'pill' | 'card' | 'inline';
  /** Inline only: plain text before the link («Застрягли?»). */
  lead?: string;
  /** Overrides the default wording of the pill or the inline link. */
  label?: string;
  /** Pill only: a shorter label at 1024–1279 px, where the desktop top bar is tight. */
  short?: boolean;
  /** Pass when known; otherwise read from the onboarding status. */
  available?: boolean;
  className?: string;
}

/**
 * Opens the founder's Telegram chat with the message already written. For a
 * custom trigger (the «Інша платформа» source card); `failed` is set when no
 * link could be made.
 */
export function useRequestHelp() {
  const [failed, setFailed] = useState(false);
  const open = async (step?: string, topic?: HelpTopic) => {
    setFailed(false);
    // Opened inside the click so popup blockers allow it; pointed at Telegram once the link is ready.
    const tab = window.open('', '_blank');
    // Telegram's page must not be able to navigate this tab (reverse tabnabbing).
    if (tab) tab.opener = null;
    try {
      const { data } = await api.post<{ url: string | null }>('/onboarding/help', { step, topic });
      if (data.url && tab) tab.location.href = data.url;
      else if (data.url) window.location.href = data.url;
      else {
        tab?.close();
        setFailed(true);
      }
    } catch {
      tab?.close();
      setFailed(true);
    }
  };
  return { open, failed };
}

/**
 * «Налаштуйте за мене безкоштовно»: opens a Telegram chat with the founder,
 * the message already written (store, email, Instagram, the step). The owner
 * presses send. Hidden when no support username is configured.
 */
export function SetUpForMeButton({ step, topic, look = 'pill', lead, label, short, available, className }: Props) {
  const { t } = useT();
  const help = useRequestHelp();
  const { data } = useQuery<{ supportAvailable: boolean }>({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get('/onboarding/status').then((r) => r.data),
    staleTime: 30_000,
    enabled: available === undefined,
  });
  if (!(available ?? data?.supportAvailable)) return null;

  const open = () => help.open(step, topic);

  const error = help.failed && (
    <span role="alert" className="text-[13px] text-dm-red">
      {t('setup_shell.help_failed')}
    </span>
  );

  if (look === 'card') {
    return (
      <div className={cn('flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4', className)}>
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-white text-blue-600" aria-hidden="true">
          <LifeBuoy className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <b className="text-[15px] font-semibold text-dm-ink">{t('setup_shell.help_card_title')}</b>
          <p className="text-sm text-dm-ink2">{t('setup_shell.help_card_text')}</p>
          <button
            type="button"
            onClick={open}
            className="mt-1 self-start text-sm font-medium text-blue-800 underline decoration-1 underline-offset-[3px] hover:text-blue-700"
          >
            {label ?? t('setup_shell.help_card_link')}
          </button>
          {error}
        </div>
      </div>
    );
  }

  if (look === 'inline') {
    return (
      <span className={cn('inline-flex flex-col gap-1', className)}>
        <button type="button" onClick={open} className="inline-flex min-h-11 items-center gap-1.5 text-left text-sm text-dm-ink2">
          <LifeBuoy className="h-4 w-4 flex-none text-blue-600" aria-hidden="true" />
          <span>
            {lead && <>{lead} </>}
            <span className="font-medium text-blue-800 underline decoration-1 underline-offset-[3px]">{label ?? t('setup_shell.help_inline')}</span>
          </span>
        </button>
        {error}
      </span>
    );
  }

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        type="button"
        onClick={open}
        className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-blue-200 bg-blue-50 pl-3 pr-4 text-[13px] font-medium text-blue-800 transition-colors hover:bg-blue-100 lg:h-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
      >
        <LifeBuoy className="h-4 w-4 flex-none" aria-hidden="true" />
        {short && !label ? (
          <>
            <span className="lg:hidden xl:inline">{t('setup_shell.help_pill')}</span>
            <span className="hidden lg:inline xl:hidden">{t('setup_shell.help_pill_short')}</span>
          </>
        ) : (
          (label ?? t('setup_shell.help_pill'))
        )}
      </button>
      {help.failed && <span className="absolute right-0 top-full mt-1 w-60 rounded-lg bg-white p-2 shadow-dm">{error}</span>}
    </span>
  );
}
