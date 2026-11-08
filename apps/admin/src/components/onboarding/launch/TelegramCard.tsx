import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, ExternalLink, Loader2, Plus, Telegram } from '../../icons';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import { Badge, Card, SetupButton, buttonClass } from '../../setup/ui';
import { useSetup } from '../../../pages/onboarding/SetupContext';
import { apiState } from '../../../pages/onboarding/steps';

/** Card actions: 48 px tall on phones (touch), the design's small button from `lg`. */
const CARD_BUTTON = 'lg:h-9 lg:rounded-[10px] lg:px-3 lg:text-[13px]';

/**
 * «Сповіщення менеджеру» inside the go-live step (m60, m61, d60): links the
 * Telegram chats that get handoff notifications. Pressing connect opens our
 * bot in Telegram and polls until a new chat shows up.
 */
export function TelegramCard() {
  const { t } = useT();
  const plural = usePlural();
  const { status, refresh } = useSetup();
  const [deepLink, setDeepLink] = useState<string | null>(null);
  // How many chats were linked when the owner pressed connect; the wait ends when there are more.
  const [waitingFrom, setWaitingFrom] = useState<number | null>(null);
  const waiting = waitingFrom !== null;

  const { data } = useQuery<{ connected: boolean; chatIds: string[] }>({
    queryKey: ['telegram-status'],
    queryFn: () => api.get('/connections/telegram/status').then((r) => r.data),
    refetchInterval: waiting ? 3000 : false,
  });
  const chats = data?.chatIds.length ?? 0;
  const connected = data ? data.connected : apiState(status, 'telegram') === 'done';

  useEffect(() => {
    if (waitingFrom !== null && chats > waitingFrom) {
      setWaitingFrom(null);
      setDeepLink(null);
      void refresh();
    }
  }, [chats, waitingFrom, refresh]);

  const connect = useMutation({
    mutationFn: () => api.post<{ deepLink: string }>('/connections/telegram/connect').then((r) => r.data),
  });

  const start = () => {
    // Opened inside the click so popup blockers allow it; pointed at Telegram once the link is ready.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    connect.mutate(undefined, {
      onSuccess: (res) => {
        setDeepLink(res.deepLink);
        setWaitingFrom(chats);
        if (tab) tab.location.href = res.deepLink;
      },
      onError: () => tab?.close(),
    });
  };

  const done = connected && !waiting;
  const subtitle = waiting
    ? t('setup_launch.tg_waiting_text')
    : !connected
      ? t('setup.step_telegram_desc')
      : data
        ? t('setup_launch.tg_connected_chats', { chats: plural(chats, 'setup_launch.tg_chats') })
        : t('setup_launch.tg_connected');

  return (
    <Card className={waiting ? 'lg:flex-row lg:items-center lg:gap-3.5' : undefined}>
      <div className={cn('flex gap-3 lg:flex-1', done ? 'items-center' : 'items-start')}>
        <span
          aria-hidden="true"
          className={cn(
            'grid h-9 w-9 flex-none place-items-center rounded-[10px]',
            done ? 'bg-dm-green-bg text-dm-green' : 'bg-dm-bubble text-dm-ink2',
          )}
        >
          <Bell className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[15px] font-semibold text-dm-ink">{t('setup.step_telegram')}</b>
          <span aria-live="polite" className="text-sm text-dm-muted">
            {subtitle}
          </span>
        </div>
        {done && <Badge tone="ok">{t('setup_launch.tg_ready')}</Badge>}
      </div>

      {waiting && deepLink ? (
        <div className="ml-12 flex flex-wrap items-center gap-x-4 gap-y-2 lg:ml-0 lg:flex-none">
          <span className="inline-flex items-center gap-2 text-sm text-dm-muted">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden="true" />
            {t('setup_launch.tg_waiting')}
          </span>
          <a href={deepLink} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md', CARD_BUTTON)}>
            {t('setup_launch.tg_open')}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : done ? (
        <SetupButton variant="ghost" onClick={start} loading={connect.isPending} className={cn('ml-9 self-start', CARD_BUTTON)}>
          {!connect.isPending && <Plus className="h-4 w-4" aria-hidden="true" />}
          {t('setup_launch.tg_add')}
        </SetupButton>
      ) : (
        <div className="ml-12 flex flex-col items-start gap-2.5">
          <SetupButton variant="secondary" onClick={start} loading={connect.isPending} className={CARD_BUTTON}>
            {!connect.isPending && <Telegram className="h-4 w-4" aria-hidden="true" />}
            {t('setup_launch.tg_connect')}
          </SetupButton>
          <p className="text-[13px] text-dm-amber">{t('setup_launch.tg_warning')}</p>
        </div>
      )}

      {connect.isError && (
        <p role="alert" className="ml-12 text-[13px] text-dm-red">
          {t('setup_launch.tg_failed')}
        </p>
      )}
    </Card>
  );
}
