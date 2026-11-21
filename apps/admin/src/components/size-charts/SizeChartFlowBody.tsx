import { useState, type ReactNode } from 'react';
import { ChevronRight, Loader2, Package, Upload } from '../icons';
import { Alert, Chip, Sheet, Skeleton, StepTitle, Switch, TextLink, Tick } from '../setup/ui';
import { SetUpForMeButton } from '../onboarding/SetUpForMeButton';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import { usePlural } from '../../lib/plural';
import { chartImageUrl, isWholeStore, type ChartScope } from './api';
import { ChartList, OldCharts } from './ChartList';
import { ChartTableEditor } from './ChartTableEditor';
import { ReadErrorAlert } from './ReadErrorAlert';
import { ChartThumb, ScopeChips, ToggleChip, useJoinNames } from './parts';
import type { SizeChartFlow } from './useSizeChartFlow';

/**
 * The size charts flow's screens (m30–m34, d30), without their buttons: the
 * setup step puts the primary action in its footer, the Size charts page
 * under the flow. Holds the one hidden file input both «Завантажити
 * сітку» and «Замінити» open.
 */
export function SizeChartFlowBody({ flow, onNoChart }: { flow: SizeChartFlow; onNoChart?: () => void }) {
  const fileInput = (
    <input
      ref={flow.fileInput}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) flow.onFile(file);
        e.target.value = '';
      }}
    />
  );
  let screen: ReactNode;
  switch (flow.view) {
    case 'loading':
      screen = (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-40" />
        </div>
      );
      break;
    case 'start':
      screen = <StartScreen flow={flow} onNoChart={onNoChart} />;
      break;
    case 'scope':
      screen = <ScopeScreen flow={flow} />;
      break;
    case 'reading':
      screen = <ReadingScreen flow={flow} />;
      break;
    case 'check':
      screen = <CheckScreen flow={flow} />;
      break;
    case 'list':
      screen = <ListScreen flow={flow} />;
      break;
  }
  return (
    <>
      {fileInput}
      {screen}
    </>
  );
}

/** A screen's heading: the step title in setup, a section heading inside the page's panel. */
function ScreenTitle({ flow, title, lead }: { flow: SizeChartFlow; title: ReactNode; lead?: ReactNode }) {
  if (flow.inSetup) return <StepTitle title={title} lead={lead} />;
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[17px] font-semibold leading-[1.3] text-dm-ink">{title}</h2>
      {lead && <p className="text-sm text-dm-muted">{lead}</p>}
    </div>
  );
}

// ─── m30 · Start ────────────────────────────────────────────

function StartScreen({ flow, onNoChart }: { flow: SizeChartFlow; onNoChart?: () => void }) {
  const { t } = useT();
  const [dragging, setDragging] = useState(false);
  const old = flow.charts.filter((c) => c.status === 'image');
  return (
    <>
      <ScreenTitle flow={flow} title={t('setup_sizes.start_title')} lead={t('setup_sizes.start_lead')} />
      <button
        type="button"
        onClick={flow.pickFile}
        disabled={flow.uploading}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) flow.onFile(file);
        }}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-blue-200 bg-white px-4 py-[22px] text-center transition-colors',
          'hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-default',
          dragging && 'border-blue-600 bg-blue-50',
        )}
      >
        <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-blue-50 text-blue-600" aria-hidden="true">
          {flow.uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
        </span>
        <b className="text-base font-semibold text-dm-ink">{flow.uploading ? t('setup_sizes.uploading') : t('setup_sizes.upload_title')}</b>
        <span className="text-sm text-dm-muted">{t('setup_sizes.upload_hint')}</span>
      </button>
      {flow.uploadFailed && (
        <Alert tone="error" title={t('setup_sizes.upload_failed_title')}>
          {t('setup_sizes.upload_failed_text')}
        </Alert>
      )}
      {flow.readError && <ReadErrorAlert reason={flow.readError} />}

      <ol className="flex flex-col gap-2.5">
        {(['how_1', 'how_2', 'how_3'] as const).map((key, i) => (
          <li key={key} className="flex items-start gap-2.5">
            <Tick state="todo" n={i + 1} />
            <span className="text-[15px] text-dm-ink">{t(`setup_sizes.${key}`)}</span>
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-dm-muted">{t('setup_sizes.several')}</p>

      {onNoChart && (
        <>
          <button
            type="button"
            onClick={onNoChart}
            disabled={flow.choosingNoChart}
            className="flex items-center gap-3 rounded-[14px] border border-dm-line bg-dm-sunken p-3.5 text-left transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <b className="text-[15px] font-semibold text-dm-ink">{t('setup_sizes.no_chart_title')}</b>
              <span className="text-sm text-dm-muted">{t('setup_sizes.no_chart_desc')}</span>
            </span>
            {flow.choosingNoChart ? (
              <Loader2 className="h-5 w-5 flex-none animate-spin text-dm-muted" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-5 w-5 flex-none text-dm-muted" aria-hidden="true" />
            )}
          </button>
          {flow.noChartFailed && (
            <Alert tone="error" title={t('setup_sizes.no_chart_failed')} action={<SetUpForMeButton look="inline" step="sizes" />} />
          )}
        </>
      )}

      {old.length > 0 && <OldCharts charts={old} flow={flow} />}
    </>
  );
}

// ─── m31 · Which products ───────────────────────────────────

/** «Lliana · сукні й сорочки», or «Усі товари магазину». */
function useScopeSummary() {
  const { t } = useT();
  const join = useJoinNames();
  return (scope: ChartScope) => {
    if (isWholeStore(scope)) return t('setup_sizes.scope_all_products');
    return [scope.brands.length > 0 && join(scope.brands), scope.categories.length > 0 && join(scope.categories.map((c) => c.toLocaleLowerCase()))]
      .filter(Boolean)
      .join(' · ');
  };
}

function ScopeScreen({ flow }: { flow: SizeChartFlow }) {
  const { t } = useT();
  const plural = usePlural();
  const summary = useScopeSummary();
  const working = flow.working;
  if (!working) return null;
  const { scope } = working;
  const toggle = (list: string[], name: string) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
  const none = !!flow.match && flow.match.total > 0 && flow.match.count === 0;

  return (
    <>
      <ScreenTitle flow={flow} title={t('setup_sizes.scope_title')} />
      <div className="flex items-center gap-3 rounded-[14px] border border-dm-line bg-white p-2.5">
        <ChartThumb imagePath={working.imagePath} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="truncate text-[15px] font-medium text-dm-ink">{working.fileName ?? t('setup_sizes.chart_image')}</b>
          <span className="text-[13px] text-dm-muted">{flow.uploading ? t('setup_sizes.uploading') : t('setup_sizes.chart_image')}</span>
        </div>
        <TextLink onClick={flow.pickFile} disabled={flow.uploading} className="min-h-11 px-1 text-sm">
          {t('setup_sizes.replace')}
        </TextLink>
      </div>
      {flow.uploadFailed && (
        <Alert tone="error" title={t('setup_sizes.upload_failed_title')}>
          {t('setup_sizes.upload_failed_text')}
        </Alert>
      )}
      {flow.readError && <ReadErrorAlert reason={flow.readError} />}

      {flow.options.brands.length > 0 && (
        <ChipGroup
          legend={t('setup_sizes.brands')}
          all={t('setup_sizes.all_brands')}
          options={flow.options.brands}
          selected={scope.brands}
          onChange={(brands) => flow.setScope({ ...scope, brands })}
          toggle={toggle}
        />
      )}
      {flow.options.categories.length > 0 && (
        <ChipGroup
          legend={t('setup_sizes.categories')}
          all={t('setup_sizes.all_categories')}
          options={flow.options.categories}
          selected={scope.categories}
          onChange={(categories) => flow.setScope({ ...scope, categories })}
          toggle={toggle}
        />
      )}

      <div className={cn('flex items-center gap-3 rounded-2xl border p-3.5', none ? 'border-dm-amber-line bg-dm-amber-bg' : 'border-dm-line bg-white')}>
        <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-blue-50 text-blue-600" aria-hidden="true">
          <Package className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5" aria-live="polite">
          <b className="text-base font-semibold tabular-nums text-dm-ink">
            {none ? t('setup_sizes.match_none') : flow.match ? plural(flow.match.count, 'setup_sizes.match') : '…'}
          </b>
          <span className="text-[13px] text-dm-muted">{none ? t('setup_sizes.match_none_text') : summary(scope)}</span>
        </div>
      </div>
      <p className="text-[13px] text-dm-muted">{t('setup_sizes.scope_hint')}</p>
    </>
  );
}

/** «Бренди» or «Категорії»: «Усі …» first, then the catalog's names; «Усі» clears the others. */
function ChipGroup({
  legend,
  all,
  options,
  selected,
  onChange,
  toggle,
}: {
  legend: string;
  all: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  toggle: (list: string[], name: string) => string[];
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-sm font-medium text-dm-ink2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        <ToggleChip pressed={selected.length === 0} onClick={() => onChange([])}>
          {all}
        </ToggleChip>
        {options.map((name) => (
          <ToggleChip key={name} pressed={selected.includes(name)} onClick={() => onChange(toggle(selected, name))}>
            {name}
          </ToggleChip>
        ))}
      </div>
    </fieldset>
  );
}

// ─── m32 · Reading ──────────────────────────────────────────

function ReadingScreen({ flow }: { flow: SizeChartFlow }) {
  const { t } = useT();
  return (
    <>
      <ScreenTitle flow={flow} title={t('setup_sizes.reading_title')} />
      {flow.working?.imagePath && (
        <img
          src={chartImageUrl(flow.working.imagePath)}
          alt={t('setup_sizes.chart_image')}
          className="max-h-72 w-full rounded-[14px] border border-dm-line bg-white object-contain"
        />
      )}
      <Alert tone="info" icon={<Loader2 className="mt-px h-5 w-5 flex-none animate-spin" aria-hidden="true" />} title={t('setup_sizes.reading_wait_title')}>
        {t('setup_sizes.reading_wait_text')}
      </Alert>
      <div aria-hidden="true" className="flex flex-col gap-2 rounded-[14px] border border-dm-line bg-white p-3.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-[72%]" />
      </div>
    </>
  );
}

// ─── m33 / d30 · Check ──────────────────────────────────────

function CheckScreen({ flow }: { flow: SizeChartFlow }) {
  const { t } = useT();
  const plural = usePlural();
  const [zoom, setZoom] = useState(false);
  const { working, edit } = flow;
  if (!working || !edit) return null;
  // A chart read in the Claude chat has only its table.
  const picture = working.imagePath;
  const productCount = flow.charts.find((c) => c.id === working.chartId)?.productCount;
  const asked = edit.columns.filter((c) => c.key !== 'other');
  const asksBodySize = asked.some((c) => c.key === 'height' || c.key === 'weight');
  const problems = flow.tableProblems;

  return (
    <>
      <ScreenTitle
        flow={flow}
        title={t('setup_sizes.check_title')}
        lead={
          <>
            <span className="lg:hidden">{t('setup_sizes.check_lead')}</span>
            <span className="hidden lg:inline">{t('setup_sizes.check_lead_wide')}</span>
          </>
        }
      />

      {/* Phone: picture, products and «Змінити» in one row. Desktop: products on one line; the picture sits beside the table. */}
      <div className="flex items-start gap-3 lg:items-center">
        {picture ? (
          <button
            type="button"
            onClick={() => setZoom(true)}
            aria-label={t('setup_sizes.open_image')}
            className="flex-none cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 lg:hidden"
          >
            <ChartThumb imagePath={picture} />
          </button>
        ) : (
          <ChartThumb imagePath={null} className="h-16 w-[52px] lg:hidden" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
          <span className="text-[13px] text-dm-muted">{t('setup_sizes.for_products')}</span>
          <ScopeChips scope={working.scope} />
          {productCount !== undefined && (
            <span className="hidden text-[13px] tabular-nums text-dm-muted lg:inline">· {plural(productCount, 'setup_shell.products')}</span>
          )}
        </div>
        <TextLink onClick={flow.editScope} className="min-h-11 flex-none text-sm">
          {t('setup_sizes.change')}
        </TextLink>
      </div>

      {edit.uncertain.length > 0 && (
        <Alert tone="warn">{plural(edit.uncertain.length, 'setup_sizes.uncertain')}</Alert>
      )}

      {!picture && <Alert tone="info">{t('setup_sizes.no_picture_text')}</Alert>}

      <div
        className={cn(
          'flex flex-col gap-3.5',
          picture && 'lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-6',
        )}
      >
        {picture && (
          <figure className="m-0 hidden lg:block">
            <img
              src={chartImageUrl(picture)}
              alt={t('setup_sizes.chart_image')}
              className="w-full rounded-2xl border border-dm-line bg-white object-contain"
            />
          </figure>
        )}
        <div className="flex min-w-0 flex-col gap-3.5">
          <ChartTableEditor table={edit} onChange={flow.setEdit} invalid={problems?.invalid} />
          {problems && (
            <Alert tone="error" title={t('setup_sizes.problems_title')}>
              <ul className="flex flex-col gap-0.5">
                {problems.problems.map((p) => (
                  <li key={p}>{t(`setup_sizes.problem_${p}`)}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="flex flex-col gap-3.5 lg:flex-row lg:items-stretch lg:gap-3">
            <div className="flex flex-col gap-2 rounded-2xl border border-dm-line bg-white p-4 lg:flex-1 lg:p-3.5">
              <b className="text-[15px] font-semibold text-dm-ink lg:text-sm">{t('setup_sizes.ask_title')}</b>
              <div className="flex flex-wrap gap-1.5">
                {asked.map((c) => (
                  <Chip key={c.key}>{c.label}</Chip>
                ))}
              </div>
              {!asksBodySize && <p className="text-sm text-dm-muted">{t('setup_sizes.ask_hint')}</p>}
            </div>
            {picture && (
              <label className="flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-[14px] border border-dm-line bg-white px-3.5 lg:flex-1 lg:rounded-2xl lg:py-3.5">
                <span className="text-[15px] text-dm-ink lg:text-sm">{t('setup_sizes.send_image')}</span>
                <Switch checked={flow.sendImage} onChange={flow.setSendImage} label={t('setup_sizes.send_image')} />
              </label>
            )}
          </div>
        </div>
      </div>

      {flow.saveFailed && (
        <Alert tone="error" title={t('setup_sizes.save_failed_title')} action={<SetUpForMeButton look="inline" step="sizes" />}>
          {t('setup_sizes.save_failed_text')}
        </Alert>
      )}

      {picture && (
        <Sheet open={zoom} onClose={() => setZoom(false)} title={t('setup_sizes.chart_image')} tall>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            <img src={chartImageUrl(picture)} alt={t('setup_sizes.chart_image')} className="w-full object-contain" />
          </div>
        </Sheet>
      )}
    </>
  );
}

// ─── m34 · Saved charts ─────────────────────────────────────

function ListScreen({ flow }: { flow: SizeChartFlow }) {
  const { t } = useT();
  return (
    <>
      {flow.inSetup && <StepTitle title={t('setup_sizes.done_title')} />}
      <ChartList flow={flow} canDelete={!flow.inSetup} />
    </>
  );
}
