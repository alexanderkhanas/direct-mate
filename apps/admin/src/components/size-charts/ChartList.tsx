import { Pencil, Plus, Trash2 } from '../icons';
import { Alert, Badge, Card, IconButton, SectionTitle, SetupButton } from '../setup/ui';
import { useT } from '../../i18n';
import { usePlural } from '../../lib/plural';
import { chartImageUrl, chartScope, useCoverage, type SizeChart, type SizeChartTable } from './api';
import { ChartThumb, ScopeChips, capitalize, useJoinNames, useMeasurementName } from './parts';
import { ReadErrorAlert } from './ReadErrorAlert';
import type { SizeChartFlow } from './useSizeChartFlow';

/**
 * The saved charts (m34): «Сітку збережено» right after a save, a card per
 * chart, the old image-only charts with «Прочитати», how many products
 * still have no chart, and what the customer will see. On the Size charts
 * page (`canDelete`) every card also shows its status and a delete button.
 */
export function ChartList({ flow, canDelete }: { flow: SizeChartFlow; canDelete?: boolean }) {
  const { t } = useT();
  const plural = usePlural();
  const read = flow.charts.filter((c) => c.status !== 'image' && c.table);
  const old = flow.charts.filter((c) => c.status === 'image' || !c.table);
  const saved = flow.justSaved;
  const preview = saved?.table ? saved : read.find((c) => c.status === 'ready');

  return (
    <>
      {saved && (
        <Alert tone="success" title={t('setup_sizes.saved_title')}>
          {plural(saved.productCount, saved.sendImage ? 'setup_sizes.saved_text' : 'setup_sizes.saved_text_noimage')}
        </Alert>
      )}
      {flow.readError && <ReadErrorAlert reason={flow.readError} />}

      {read.map((chart) => (
        <ChartCard key={chart.id} chart={chart} flow={flow} canDelete={canDelete} />
      ))}

      <CoverageCard onAdd={flow.startNew} />

      {old.length > 0 && <OldCharts charts={old} flow={flow} canDelete={canDelete} />}

      {preview?.table && <CustomerPreview table={preview.table} imagePath={preview.sendImage ? preview.imagePath : null} />}
    </>
  );
}

/** One read chart: picture, name, products, «23 товари · XS–XL · груди, талія, стегна», edit. */
function ChartCard({ chart, flow, canDelete }: { chart: SizeChart; flow: SizeChartFlow; canDelete?: boolean }) {
  const { t } = useT();
  const plural = usePlural();
  const nameOf = useMeasurementName();
  const table = chart.table!;
  const sizes = table.rows.length > 1 ? `${table.rows[0].size}–${table.rows[table.rows.length - 1].size}` : table.rows[0]?.size;
  const meta = [plural(chart.productCount, 'setup_shell.products'), sizes, table.measurements.map(nameOf).join(', ')].filter(Boolean);
  return (
    <Card>
      <div className="flex items-start gap-3">
        <ChartThumb imagePath={chart.imagePath} className="h-[54px] w-11" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[15px] font-semibold text-dm-ink">{chart.name}</b>
            {(canDelete || chart.status === 'draft') && (
              <Badge tone={chart.status === 'ready' ? 'ok' : 'neutral'}>{t(`setup_sizes.status_${chart.status}`)}</Badge>
            )}
          </div>
          <ScopeChips scope={chartScope(chart, flow.options)} />
          <span className="text-[13px] tabular-nums text-dm-muted">{meta.join(' · ')}</span>
        </div>
        <div className="-mr-1.5 -mt-1.5 flex flex-none flex-col">
          <IconButton label={t(chart.status === 'draft' ? 'setup_sizes.check_draft' : 'setup_sizes.edit_chart')} onClick={() => flow.openChart(chart)}>
            <Pencil className="h-5 w-5" />
          </IconButton>
          {canDelete && <DeleteButton chart={chart} flow={flow} />}
        </div>
      </div>
    </Card>
  );
}

function DeleteButton({ chart, flow }: { chart: SizeChart; flow: SizeChartFlow }) {
  const { t } = useT();
  return (
    <IconButton
      label={t('setup_sizes.delete', { name: chart.name })}
      disabled={flow.removing === chart.id}
      onClick={() => {
        if (window.confirm(t('setup_sizes.delete_confirm'))) flow.remove(chart);
      }}
    >
      <Trash2 className="h-5 w-5 text-dm-red" />
    </IconButton>
  );
}

/** Charts from before Nov 2026: a picture the bot sends, nothing it reads. «Прочитати» reads one now. */
export function OldCharts({ charts, flow, canDelete }: { charts: SizeChart[]; flow: SizeChartFlow; canDelete?: boolean }) {
  const { t } = useT();
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <SectionTitle>{t('setup_sizes.old_title')}</SectionTitle>
        <p className="text-sm text-dm-muted">{t('setup_sizes.old_text')}</p>
      </div>
      <div className="flex flex-col rounded-2xl border border-dm-line bg-white">
        {charts.map((chart, i) => (
          <div key={chart.id} className={`flex items-center gap-3 p-3 ${i > 0 ? 'border-t border-dm-line' : ''}`}>
            <ChartThumb imagePath={chart.imagePath} className="h-[54px] w-11" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <b className="truncate text-[15px] font-semibold text-dm-ink">{chart.name}</b>
              <ScopeChips scope={chartScope(chart, flow.options)} />
            </div>
            <SetupButton variant="secondary" size="sm" onClick={() => flow.readChart(chart)}>
              {t('setup_sizes.read_old')}
            </SetupButton>
            {canDelete && <DeleteButton chart={chart} flow={flow} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** «Ще 41 товар без сітки: штани, топи та бренди Linen Lab і Monte…» and «Додати ще сітку». */
function CoverageCard({ onAdd }: { onAdd: () => void }) {
  const { t } = useT();
  const plural = usePlural();
  const join = useJoinNames();
  const coverage = useCoverage().data;
  const addButton = (
    <SetupButton variant="secondary" block onClick={onAdd}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      {t('setup_sizes.add_another')}
    </SetupButton>
  );
  if (!coverage || coverage.uncovered === 0) return addButton;

  const list = (names: string[], max: number) => {
    const shown = names.slice(0, max);
    if (names.length > max) shown.push(t('setup_sizes.coverage_more'));
    return join(shown);
  };
  const categories = coverage.uncoveredCategories.length > 0 ? list(coverage.uncoveredCategories.map((c) => c.toLocaleLowerCase()), 4) : '';
  const brands = coverage.uncoveredBrands.length > 0 ? t('setup_sizes.coverage_brands', { list: list(coverage.uncoveredBrands, 3) }) : '';
  const what = categories && brands ? t('setup_sizes.coverage_and', { a: categories, b: brands }) : categories || brands;

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-dm-amber-line bg-[#FFFCF5] p-4">
      <div className="flex flex-col gap-1">
        <b className="text-[15px] font-semibold tabular-nums text-dm-ink">{plural(coverage.uncovered, 'setup_sizes.coverage_title')}</b>
        <span className="text-sm text-dm-muted">
          {what && `${capitalize(what)}. `}
          {t('setup_sizes.coverage_text')}
        </span>
      </div>
      {addButton}
    </div>
  );
}

/**
 * «Так це побачить клієнт»: a static exchange built from the chart — the
 * second size's middle measurements as the question, that size as the
 * answer, and the picture when the store sends it.
 */
function CustomerPreview({ table, imagePath }: { table: SizeChartTable; imagePath: string | null }) {
  const { t } = useT();
  const nameOf = useMeasurementName();
  const row = table.rows[1] ?? table.rows[0];
  if (!row) return null;
  const given = table.measurements.flatMap((m) => {
    const range = row.values[m.key];
    return m.key !== 'other' && range ? [`${nameOf(m)} ${Math.round((range.min + range.max) / 2)}`] : [];
  });
  if (given.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <span className="text-sm font-medium text-dm-ink2">{t('setup_sizes.preview_title')}</span>
      <div className="flex flex-col gap-1.5 rounded-[18px] border border-dm-line bg-white p-3">
        <span className="max-w-[80%] self-end rounded-[20px] rounded-br-md bg-blue-600 px-[13px] py-[9px] text-[15px] leading-[1.38] text-white">
          {t('setup_sizes.preview_question', { measurements: capitalize(given.join(', ')) })}
        </span>
        <span className="max-w-[80%] self-start rounded-[20px] rounded-bl-md bg-dm-bubble px-[13px] py-[9px] text-[15px] leading-[1.38] text-dm-ink">
          {t(imagePath ? 'setup_sizes.preview_answer' : 'setup_sizes.preview_answer_noimage', { size: row.size })}
        </span>
        {imagePath && (
          <img
            src={chartImageUrl(imagePath)}
            alt={t('setup_sizes.chart_image')}
            className="h-[110px] w-[150px] self-start rounded-[14px] border border-dm-line object-cover lg:h-[120px] lg:w-[170px]"
          />
        )}
      </div>
    </section>
  );
}
