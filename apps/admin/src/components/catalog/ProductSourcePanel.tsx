import { useId } from 'react';
import { useT } from '../../i18n';
import { SetupButton, TextLink } from '../setup/ui';
import { ProductSourceBody } from './products/ProductSourceBody';
import { ConnectedSources } from './products/ConnectedSources';
import { useProductSource } from './products/useProductSource';

/**
 * Where the store's products come from, on the Catalog page (x40). Connected:
 * the «Джерело товарів» card with status, «Оновити зараз», the warnings and
 * «Змінити джерело». Nothing connected: the source choice inline, then the
 * same screens as the setup step, with the buttons inside the panel.
 */
export function ProductSourcePanel({ onImported }: { onImported?: () => void }) {
  const { t } = useT();
  const titleId = useId();
  const flow = useProductSource({ onImported });
  const settled = flow.view === 'done' || flow.view === 'waiting';

  const title = settled || flow.view === 'pending'
    ? t('setup_products.panel_connected_title')
    : flow.view === 'choose'
      ? t('setup_products.panel_title')
      : flow.heading.title;
  const lead = settled || flow.view === 'pending' ? undefined : flow.heading.lead;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3.5 rounded-2xl border border-dm-line bg-white p-4 text-dm-ink sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-[17px] font-semibold leading-[1.3]">
            {title}
          </h2>
          {lead && <p className="text-sm text-dm-muted">{lead}</p>}
        </div>
        {settled && (
          <TextLink onClick={flow.chooseAgain} className="-my-3 min-h-11 flex-none text-sm">
            {t('setup_products.change_source')}
          </TextLink>
        )}
      </div>

      {settled ? <ConnectedSources flow={flow} compact /> : <ProductSourceBody flow={flow} wide />}

      {(flow.primary || flow.back) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dm-line pt-4">
          {flow.back && (
            <SetupButton variant="ghost" onClick={flow.back}>
              {t(flow.view === 'choose' ? 'setup_products.cancel' : 'setup_products.back')}
            </SetupButton>
          )}
          {flow.primary && (
            <SetupButton onClick={flow.primary.onClick} loading={flow.primary.loading} disabled={flow.primary.disabled}>
              {flow.primary.label}
            </SetupButton>
          )}
        </div>
      )}
    </section>
  );
}
