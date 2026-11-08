import type { ReactNode } from 'react';
import { ChevronRight, Globe, Package, Plug, RefreshCw, GoogleSheets, Shopify } from '../../icons';
import { useT } from '../../../i18n';
import { cn } from '../../../lib/cn';
import { Badge } from '../../setup/ui';
import { useRequestHelp } from '../../onboarding/SetUpForMeButton';
import type { SourcePick } from './useProductSource';

type IconKind = SourcePick | 'other' | 'catalog';

const ICONS: Record<IconKind, { Icon: typeof Globe; tint: string }> = {
  sheet: { Icon: GoogleSheets, tint: 'bg-dm-green-bg text-dm-green' },
  feed: { Icon: Globe, tint: 'bg-dm-bubble text-dm-ink2' },
  shopify: { Icon: Shopify, tint: 'bg-dm-bubble text-dm-ink2' },
  other: { Icon: Plug, tint: 'bg-blue-50 text-blue-600' },
  catalog: { Icon: Package, tint: 'bg-dm-bubble text-dm-ink2' },
};

/** The square icon of a product source (sheet, feed, Shopify…), 36 px or 32 px. */
export function SourceIcon({ kind, small }: { kind: IconKind; small?: boolean }) {
  const { Icon, tint } = ICONS[kind];
  return (
    <span aria-hidden="true" className={cn('grid flex-none place-items-center rounded-[10px]', small ? 'h-8 w-8' : 'h-9 w-9', tint)}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

/**
 * The four product sources, in the order the Handoff sets (§3a): Google Sheet
 * (no website needed), website feed, Shopify, and another platform, which
 * opens the free-setup chat with «Хочу підключити товари з …».
 */
export function SourceChoice({ onPick, supportAvailable, wide }: { onPick: (source: SourcePick) => void; supportAvailable: boolean; wide?: boolean }) {
  const { t } = useT();
  const help = useRequestHelp();
  return (
    <>
      <div className={cn('grid gap-2.5', wide && 'sm:grid-cols-2')}>
        <SourceCard
          icon="sheet"
          title={t('setup_products.source_sheet')}
          badge={<Badge tone="ok">{t('setup_products.source_sheet_badge')}</Badge>}
          description={t('setup_products.source_sheet_desc')}
          onClick={() => onPick('sheet')}
        />
        <SourceCard icon="feed" title={t('setup_products.source_feed')} description={t('setup_products.source_feed_desc')} onClick={() => onPick('feed')} />
        <SourceCard
          icon="shopify"
          title={t('setup_products.source_shopify')}
          description={t('setup_products.source_shopify_desc')}
          onClick={() => onPick('shopify')}
        />
        {supportAvailable && (
          <SourceCard
            icon="other"
            dashed
            title={t('setup_products.source_other')}
            description={t('setup_products.source_other_desc')}
            onClick={() => void help.open('products', 'other_platform')}
          />
        )}
      </div>
      {help.failed && (
        <p role="alert" className="text-[13px] text-dm-red">
          {t('setup_shell.help_failed')}
        </p>
      )}
      <p className="flex items-start gap-2 px-1 text-[13px] text-dm-muted">
        <RefreshCw className="mt-px h-4 w-4 flex-none" aria-hidden="true" />
        {t('setup_products.auto_update')}
      </p>
    </>
  );
}

function SourceCard({
  icon,
  title,
  badge,
  description,
  dashed,
  onClick,
}: {
  icon: IconKind;
  title: string;
  badge?: ReactNode;
  description: string;
  dashed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border bg-white p-3.5 text-left transition-colors',
        'hover:border-dm-faint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100',
        dashed ? 'border-dashed border-dm-line2' : 'border-dm-line',
      )}
    >
      <SourceIcon kind={icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-dm-ink">
          {title}
          {badge}
        </span>
        <span className="text-sm text-dm-muted">{description}</span>
      </span>
      <ChevronRight className="h-5 w-5 flex-none text-dm-muted" aria-hidden="true" />
    </button>
  );
}
