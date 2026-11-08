import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import { cn } from '../../../lib/cn';
import { Badge, SetupButton } from '../../setup/ui';
import { SetUpForMeButton } from '../../onboarding/SetUpForMeButton';
import { SourceIcon } from './SourceChoice';
import { FeedErrorAlert } from './FeedError';
import { FeedWarnings } from './FeedWarnings';
import { displayUrl, linkSourceOf, type ConnectedFeed, type StoreConnection } from './api';
import { syncedAt } from './format';
import type { ProductSourceFlow } from './useProductSource';

/**
 * Where the products come from once connected: the feed or sheet (with
 * «Оновити зараз»), Shopify, or, with neither, the catalog as it is.
 * Setup shows cards with «Змінити джерело» (m16); `compact` is the Catalog
 * page's rows, whose panel header holds «Змінити джерело» (x40).
 */
export function ConnectedSources({ flow, compact }: { flow: ProductSourceFlow; compact?: boolean }) {
  const { t } = useT();
  const plural = usePlural();
  const change = compact ? undefined : flow.chooseAgain;
  return (
    <div className={cn('flex flex-col', compact ? 'gap-4 [&>*+*]:border-t [&>*+*]:border-dm-line [&>*+*]:pt-4' : 'gap-3')}>
      {flow.feed && <FeedSource flow={flow} feed={flow.feed} compact={compact} onChange={flow.shopify ? undefined : change} />}
      {flow.shopify && <ShopifySource flow={flow} shopify={flow.shopify} compact={compact} onChange={change} />}
      {!flow.feed && !flow.shopify && (
        <SourceRow
          compact={compact}
          icon={<SourceIcon kind="catalog" />}
          name={t('setup_products.source_catalog')}
          meta={plural(flow.products.total, 'setup_products.products')}
          onChange={change}
        />
      )}
    </div>
  );
}

function FeedSource({ flow, feed, compact, onChange }: { flow: ProductSourceFlow; feed: ConnectedFeed; compact?: boolean; onChange?: () => void }) {
  const { t, lang } = useT();
  const plural = usePlural();
  const kind = linkSourceOf(feed.format);
  const meta = [
    plural(feed.products ?? flow.products.total, 'setup_products.products'),
    feed.lastSyncAt && syncedAt(feed.lastSyncAt, lang, t),
    t('setup_products.hourly'),
  ]
    .filter(Boolean)
    .join(' · ');

  const { resync } = flow;
  const outcome = resync.isPending
    ? null
    : resync.isError
      ? 'sync_failed'
      : resync.data && { imported: 'sync_imported', unchanged: 'sync_unchanged', already_running: 'sync_running', failed: 'sync_failed' }[resync.data.status];

  return (
    <SourceRow
      compact={compact}
      icon={<SourceIcon kind={kind} />}
      name={t(`setup_products.source_${kind}`)}
      link={displayUrl(feed.url)}
      badge={
        feed.status === 'error' ? (
          <Badge tone="err">{t('setup_products.sync_error_badge')}</Badge>
        ) : (
          <Badge tone="ok">{t('setup_products.connected')}</Badge>
        )
      }
      meta={meta}
      action={
        <SetupButton variant="secondary" size="sm" loading={resync.isPending} onClick={() => resync.mutate(feed.id)}>
          {!resync.isPending && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {t('setup_products.sync_now')}
        </SetupButton>
      }
      outcome={outcome ? t(`setup_products.${outcome}`) : null}
      onChange={onChange}
    >
      {feed.lastError && (
        <FeedErrorAlert
          code={feed.lastError.code}
          lastSync
          action={<SetUpForMeButton look="inline" step="products" topic="feed" available={flow.supportAvailable} />}
        />
      )}
      {compact && <FeedWarnings warnings={feed.warnings} kind={kind} look="inline" />}
    </SourceRow>
  );
}

function ShopifySource({ flow, shopify, compact, onChange }: { flow: ProductSourceFlow; shopify: StoreConnection; compact?: boolean; onChange?: () => void }) {
  const { t, lang } = useT();
  const plural = usePlural();
  const { total } = flow.products;
  const meta =
    total > 0
      ? [plural(total, 'setup_products.products'), shopify.lastSyncAt && syncedAt(shopify.lastSyncAt, lang, t)].filter(Boolean).join(' · ')
      : t('setup_products.shopify_waiting_meta');
  return (
    <SourceRow
      compact={compact}
      icon={<SourceIcon kind="shopify" />}
      name={t('setup_products.source_shopify')}
      link={shopify.metadata?.shopDomain}
      badge={<Badge tone="ok">{t('setup_products.connected')}</Badge>}
      meta={meta}
      onChange={onChange}
    />
  );
}

function SourceRow({
  compact,
  icon,
  name,
  link,
  badge,
  meta,
  action,
  outcome,
  onChange,
  children,
}: {
  compact?: boolean;
  icon: ReactNode;
  name: string;
  link?: string;
  badge?: ReactNode;
  meta: string;
  /** «Оновити зараз». */
  action?: ReactNode;
  /** What the last «Оновити зараз» did. */
  outcome?: string | null;
  /** «Змінити джерело» (setup cards only). */
  onChange?: () => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  const said = outcome && (
    <span role="status" className="text-[13px] text-dm-muted">
      {outcome}
    </span>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3.5">
          {icon}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-[15px] font-semibold text-dm-ink">{name}</b>
              {badge}
            </div>
            <span className="text-[13px] tabular-nums text-dm-muted">{meta}</span>
          </div>
          {said}
          {action}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dm-line bg-white p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="text-[15px] font-semibold text-dm-ink">{name}</b>
          {link && <span className="truncate text-[13px] text-dm-muted">{link}</span>}
        </div>
        {badge}
      </div>
      <p className="text-sm tabular-nums text-dm-muted">{meta}</p>
      {children}
      {(action || onChange) && (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {onChange && (
            <SetupButton variant="ghost" size="sm" onClick={onChange}>
              {t('setup_products.change_source')}
            </SetupButton>
          )}
          {said}
        </div>
      )}
    </div>
  );
}
