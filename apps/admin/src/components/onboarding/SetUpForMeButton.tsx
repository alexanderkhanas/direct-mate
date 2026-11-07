import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';

/**
 * «Налаштуйте за мене»: opens a Telegram chat with the founder, the message
 * already written (store, email, Instagram, the step). The owner presses send.
 */
export function SetUpForMeButton({ step, available }: { step?: string; available: boolean }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  if (!available) return null;

  const open = async () => {
    setFailed(false);
    // Opened inside the click so popup blockers allow it; pointed at Telegram once the link is ready.
    const tab = window.open('', '_blank');
    try {
      const { data } = await api.post<{ url: string | null }>('/onboarding/help', { step });
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

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={open}>
        <LifeBuoy className="h-3.5 w-3.5" />
        {t('setup.set_up_for_me')}
      </Button>
      {failed && <span className="text-xs text-red-600">{t('setup.help_failed')}</span>}
    </span>
  );
}
