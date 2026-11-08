import { Link } from 'react-router-dom';
import { Plus } from '../components/icons';
import { Alert, SetupButton } from '../components/setup/ui';
import { SizeChartFlowBody } from '../components/size-charts/SizeChartFlowBody';
import { useSizeChartFlow } from '../components/size-charts/useSizeChartFlow';
import { useT } from '../i18n';

/**
 * Size charts in the admin: every chart with its status (ready, draft,
 * picture only), products and counts; open one to edit its table; «Додати
 * сітку» runs the same upload → products → read → check flow as setup,
 * with its buttons inside the page.
 */
export default function SizeChartsPage() {
  const { t } = useT();
  const flow = useSizeChartFlow({ inSetup: false });
  const inFlow = flow.view !== 'list' && flow.view !== 'loading';
  const consult = flow.sizing?.advice === 'consult';

  return (
    <div className="mx-auto flex max-w-[816px] flex-col gap-4 text-[15px] leading-[1.45] text-dm-ink lg:gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold text-dm-ink">{t('setup_sizes.page_title')}</h1>
          <p className="text-sm text-dm-muted">{t('setup_sizes.page_lead')}</p>
        </div>
        {flow.view === 'list' && (
          <SetupButton onClick={flow.startNew}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('setup_sizes.page_add')}
          </SetupButton>
        )}
      </div>

      {consult && (
        <Alert
          tone="info"
          title={t('setup_sizes.consult_title')}
          action={
            <Link to="/settings" className="font-medium text-blue-800 underline underline-offset-[3px] decoration-1 hover:text-blue-700">
              {t('setup_sizes.consult_link')}
            </Link>
          }
        >
          {t('setup_sizes.consult_text')}
        </Alert>
      )}

      {inFlow ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-dm-line bg-white p-4 sm:p-5">
          <SizeChartFlowBody flow={flow} />
          <FlowButtons flow={flow} />
        </section>
      ) : (
        <SizeChartFlowBody flow={flow} />
      )}
    </div>
  );
}

/** The flow's «Назад» / «Скасувати» and its one primary action, under the panel. */
function FlowButtons({ flow }: { flow: ReturnType<typeof useSizeChartFlow> }) {
  const { t } = useT();
  // The start screen is the page's empty state when there are no charts yet: nothing to cancel back to.
  const canCancel = flow.charts.length > 0 && flow.view !== 'reading';
  if (!flow.primary && !flow.back && !canCancel) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-dm-line pt-4">
      {canCancel && (
        <SetupButton variant="ghost" onClick={flow.cancel} className="mr-auto">
          {t('setup_sizes.page_cancel')}
        </SetupButton>
      )}
      {flow.back && (flow.view === 'scope' || (flow.view === 'check' && flow.working?.from === 'new')) && (
        <SetupButton variant="secondary" onClick={flow.back}>
          {t('setup_sizes.back')}
        </SetupButton>
      )}
      {flow.primary && (
        <SetupButton onClick={flow.primary.onClick} loading={flow.primary.loading} disabled={flow.primary.disabled}>
          {flow.primary.label}
        </SetupButton>
      )}
    </div>
  );
}
