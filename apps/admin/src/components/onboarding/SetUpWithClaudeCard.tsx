import { Link, useLocation } from 'react-router-dom';
import { Claude } from '../icons';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { useConnector } from '../../pages/claude/SetupWithClaudePage';

/**
 * The setup's other road: answer Claude's questions in a chat and let it fill
 * these steps (the DirectMate connector). Links to the «how to connect» page,
 * whose back link returns here. Hidden while the connector is off.
 */
export function SetUpWithClaudeCard({ className }: { className?: string }) {
  const { t } = useT();
  const { pathname, search } = useLocation();
  const connector = useConnector();
  if (!connector.data?.enabled) return null;

  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border border-[#D97757]/25 bg-[#D97757]/[0.06] p-4', className)}>
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-white" aria-hidden="true">
        <Claude className="h-6 w-6 text-[#D97757]" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <b className="text-[15px] font-semibold text-dm-ink">{t('setup_claude.intro_card_title')}</b>
        <p className="text-sm text-dm-ink2">{t('setup_claude.intro_card_text')}</p>
        <Link
          to="/claude"
          state={{ back: `${pathname}${search}` }}
          className="mt-1 self-start text-sm font-medium text-[#B4573A] underline decoration-1 underline-offset-[3px] hover:text-[#9A4930]"
        >
          {t('setup_claude.intro_card_link')}
        </Link>
      </div>
    </div>
  );
}
