import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import type { FeedWarning, LinkSource } from './api';

// Mirrors FeedWarningCode in apps/api/src/modules/catalog-feeds/feed-normalize.ts.
const KNOWN = ['no_group_id', 'no_sizes', 'no_photos', 'skipped_no_price', 'duplicate_ids', 'duplicate_barcodes', 'no_article', 'over_limit', 'partial_feed'];

/**
 * A feed's warnings in ONE collapsible amber block, each with what it means
 * and a few examples. `block` (setup preview) opens on its own; `inline`
 * (the Catalog source card) is a closed line under the source.
 */
export function FeedWarnings({ warnings, kind, look = 'block' }: { warnings: FeedWarning[]; kind: LinkSource; look?: 'block' | 'inline' }) {
  const { t } = useT();
  const plural = usePlural();
  if (warnings.length === 0) return null;

  const list = (
    <div className="flex flex-col gap-2.5 text-sm text-dm-ink2">
      {look === 'block' && <p className="text-dm-muted">{t(`setup_products.warnings_fix_${kind}`)}</p>}
      {warnings.map((w) => (
        <WarningItem key={w.code} warning={w} />
      ))}
    </div>
  );

  if (look === 'inline') {
    return (
      <details className="group border-t border-dm-line pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-dm-amber [&::-webkit-details-marker]:hidden">
          <AlertTriangle className="h-4 w-4 flex-none" aria-hidden="true" />
          {plural(warnings.length, 'setup_products.warnings_last')}
          <ChevronDown className="h-4 w-4 flex-none transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="pb-1 pl-6">{list}</div>
      </details>
    );
  }

  return (
    <details open className="group rounded-[14px] border border-dm-amber-line bg-dm-amber-bg px-3.5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 py-1 text-[15px] font-semibold text-dm-amber [&::-webkit-details-marker]:hidden lg:min-h-12">
        <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {plural(warnings.length, 'setup_products.warnings')}
          <span className="font-normal text-dm-muted"> · {t('setup_products.warnings_still')}</span>
        </span>
        <ChevronDown className="h-4 w-4 flex-none text-dm-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="pb-3.5">{list}</div>
    </details>
  );
}

function WarningItem({ warning }: { warning: FeedWarning }) {
  const { t } = useT();
  const plural = usePlural();
  const known = KNOWN.includes(warning.code);
  const examples = warning.examples?.slice(0, 3).join(', ');
  return (
    <p className="flex flex-col">
      <b className="font-semibold text-dm-ink">
        {known
          ? plural(warning.count, `setup_products.warn_${warning.code}`)
          : t('setup_products.warn_other', { code: warning.code, n: warning.count })}
      </b>
      {known && <span>{t(`setup_products.warn_${warning.code}_text`)}</span>}
      {examples && <span className="text-dm-muted">{examples}</span>}
    </p>
  );
}
