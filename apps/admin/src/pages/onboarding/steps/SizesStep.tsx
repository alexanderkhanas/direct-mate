import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Ruler, Trash2 } from '../../../components/icons';
import { api } from '../../../lib/api';
import { useT } from '../../../i18n';
import { Alert, ChoiceCard, IconButton, SectionTitle, SetupButton, Skeleton, StepTitle, Switch } from '../../../components/setup/ui';
import { useSetup, useSetupStep } from '../SetupContext';

/*
 * Interim sizes step: today's sizing controls (Settings → Sizes) in the setup's
 * look. The chart-reading flow from the design (m30–m34) replaces it later.
 */

type Advice = 'recommend' | 'consult';

/** One size of the height/weight table, as edited: strings, so the inputs stay controlled. */
interface SizeRow {
  size: string;
  heightMin: string;
  heightMax: string;
  weightMin: string;
  weightMax: string;
}

const NUMBER_FIELDS = ['heightMin', 'heightMax', 'weightMin', 'weightMax'] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];
const CELL_LABEL: Record<NumberField, string> = {
  heightMin: 'setup_bot.sizes_cell_height_min',
  heightMax: 'setup_bot.sizes_cell_height_max',
  weightMin: 'setup_bot.sizes_cell_weight_min',
  weightMax: 'setup_bot.sizes_cell_weight_max',
};
const EMPTY_ROW: SizeRow = { size: '', heightMin: '', heightMax: '', weightMin: '', weightMax: '' };

interface StoreConfig {
  flowConfig?: { sizing?: { advice?: Advice; askMeasurementsFirst?: boolean }; sizeChart?: unknown } | null;
}

// Same conversions as SizingSection (Settings).
function sizeChartToRows(chart: unknown): SizeRow[] {
  if (!chart || typeof chart !== 'object') return [];
  return Object.entries(chart as Record<string, any>).map(([size, r]) => ({
    size,
    heightMin: r?.heightMin != null ? String(r.heightMin) : '',
    heightMax: r?.heightMax != null ? String(r.heightMax) : '',
    weightMin: r?.weightMin != null ? String(r.weightMin) : '',
    weightMax: r?.weightMax != null ? String(r.weightMax) : '',
  }));
}

function rowsToSizeChart(rows: SizeRow[]): Record<string, unknown> | undefined {
  const chart: Record<string, unknown> = {};
  for (const r of rows) {
    const size = r.size.trim();
    if (!size) continue;
    chart[size] = {
      heightMin: Number(r.heightMin) || 0,
      heightMax: Number(r.heightMax) || 0,
      weightMin: Number(r.weightMin) || 0,
      weightMax: Number(r.weightMax) || 0,
    };
  }
  return Object.keys(chart).length > 0 ? chart : undefined;
}

interface SizingForm {
  advice: Advice;
  askFirst: boolean;
  rows: SizeRow[];
}

function formFrom(config: StoreConfig): SizingForm {
  const fc = config.flowConfig ?? {};
  const rows = sizeChartToRows(fc.sizeChart);
  return {
    advice: fc.sizing?.advice === 'consult' ? 'consult' : 'recommend',
    askFirst: fc.sizing?.askMeasurementsFirst === true,
    // An empty table starts with one blank row to fill in.
    rows: rows.length > 0 ? rows : [EMPTY_ROW],
  };
}

/** «Розміри» (interim): how the bot helps with size, and the height/weight table it recommends from. */
export default function SizesStep() {
  const { t } = useT();
  const qc = useQueryClient();
  const { refresh, goNext } = useSetup();

  // `['store-config']`: the key SizingSection and the notes forms use for GET /engine/config.
  const config = useQuery<StoreConfig>({
    queryKey: ['store-config'],
    queryFn: () => api.get('/engine/config').then((r) => r.data),
  });
  // null until the owner edits: the form shows what's stored.
  const [edited, setEdited] = useState<SizingForm | null>(null);
  const form = edited ?? (config.data ? formFrom(config.data) : null);
  const [incomplete, setIncomplete] = useState(false);

  const update = (patch: Partial<SizingForm>) => {
    if (!form) return;
    setIncomplete(false);
    setEdited({ ...form, ...patch });
  };
  const updateRow = (i: number, patch: Partial<SizeRow>) => {
    if (form) update({ rows: form.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  };

  // The API shallow-merges flowConfig, so the keys this form doesn't model are kept.
  // `null` clears the table: an undefined key would be dropped from the JSON and the old table kept.
  const save = useMutation({
    mutationFn: (f: SizingForm) =>
      api.patch('/engine/config', {
        flowConfig: {
          sizing: { advice: f.advice, askMeasurementsFirst: f.askFirst },
          sizeChart: rowsToSizeChart(f.rows) ?? null,
        },
      }),
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: ['store-config'] });
      await refresh();
      goNext();
    },
  });

  const onSave = () => {
    if (!form) return;
    // A row is either blank (ignored) or complete: a size without numbers would be saved as 0–0.
    const missing =
      form.advice === 'recommend' &&
      form.rows.some((r) => {
        const cells = [r.size, ...NUMBER_FIELDS.map((f) => r[f])].map((v) => v.trim());
        return cells.some(Boolean) && !cells.every(Boolean);
      });
    setIncomplete(missing);
    if (!missing) save.mutate(form);
  };

  useSetupStep({
    primary: { label: t('setup_shell.save_next'), onClick: onSave, loading: save.isPending, disabled: !form },
  });

  return (
    <div className="flex flex-col gap-5">
      <StepTitle title={t('setup_bot.sizes_title')} lead={t('setup_bot.sizes_lead')} />

      {config.isError ? (
        <Alert tone="error" title={t('setup_bot.sizes_load_failed_title')}>
          {t('setup_bot.sizes_load_failed_text')}
        </Alert>
      ) : !form ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-20 rounded-[14px]" />
          <Skeleton className="h-20 rounded-[14px]" />
          <Skeleton className="h-40 rounded-[14px]" />
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label={t('setup_bot.sizes_mode_label')} className="flex flex-col gap-2.5">
            {(['recommend', 'consult'] as const).map((value) => (
              <ChoiceCard
                key={value}
                name="sizing-advice"
                value={value}
                selected={form.advice === value}
                onSelect={() => update({ advice: value })}
                title={t(`setup_bot.sizes_${value}`)}
                description={t(`setup_bot.sizes_${value}_desc`)}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 rounded-[14px] border border-dm-line bg-white p-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium text-dm-ink">{t('setup_bot.sizes_ask_first')}</span>
              <span className="text-sm text-dm-muted">{t('setup_bot.sizes_ask_first_desc')}</span>
            </div>
            <Switch checked={form.askFirst} onChange={(askFirst) => update({ askFirst })} label={t('setup_bot.sizes_ask_first')} />
          </div>

          {form.advice === 'recommend' && (
            <SizeTable rows={form.rows} onChange={updateRow} onRows={(rows) => update({ rows })} />
          )}

          {incomplete && (
            <Alert tone="error" title={t('setup_bot.sizes_incomplete_title')}>
              {t('setup_bot.sizes_incomplete_text')}
            </Alert>
          )}
          {save.isError && (
            <Alert tone="error" title={t('setup_bot.sizes_save_failed_title')}>
              {t('setup_bot.sizes_save_failed_text')}
            </Alert>
          )}
        </>
      )}

      <Link
        to="/size-charts"
        className="flex items-center gap-3 rounded-2xl border border-dm-line bg-dm-sunken p-4 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
      >
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-blue-50 text-blue-600" aria-hidden="true">
          <Ruler className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm text-dm-ink2">{t('setup_bot.sizes_charts')}</span>
          <span className="text-[15px] font-semibold text-blue-800">{t('setup_bot.sizes_charts_link')}</span>
        </span>
        <ChevronRight className="h-5 w-5 flex-none text-dm-muted" aria-hidden="true" />
      </Link>
    </div>
  );
}

const CELL =
  'h-11 w-full min-w-0 rounded-[10px] border border-dm-line2 bg-white px-2 text-base tabular-nums text-dm-ink placeholder:text-dm-faint outline-none ' +
  'transition-shadow focus:border-blue-600 focus:ring-[3px] focus:ring-blue-100';
const GRID = 'grid grid-cols-[minmax(0,0.9fr)_repeat(4,minmax(0,1fr))_2.75rem] items-center gap-1.5 lg:gap-2';

/** Size | height from–to | weight from–to, one row per size. */
function SizeTable({
  rows,
  onChange,
  onRows,
}: {
  rows: SizeRow[];
  onChange: (i: number, patch: Partial<SizeRow>) => void;
  onRows: (rows: SizeRow[]) => void;
}) {
  const { t } = useT();
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <SectionTitle>{t('setup_bot.sizes_table_title')}</SectionTitle>
        <p className="text-sm text-dm-muted">{t('setup_bot.sizes_table_note')}</p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-[14px] border border-dm-line bg-white p-2.5">
        {/* Visual column headings; each input carries its own label. */}
        <div aria-hidden="true" className={`${GRID} px-0.5 text-xs font-medium text-dm-muted`}>
          <span>{t('setup_bot.sizes_col_size')}</span>
          <span className="col-span-2">{t('setup_bot.sizes_col_height')}</span>
          <span className="col-span-2">{t('setup_bot.sizes_col_weight')}</span>
        </div>
        {rows.length === 0 && <p className="px-0.5 py-2 text-sm text-dm-muted">{t('setup_bot.sizes_empty')}</p>}
        {rows.map((row, i) => {
          const n = i + 1;
          return (
            <div key={i} className={GRID}>
              <input
                value={row.size}
                onChange={(e) => onChange(i, { size: e.target.value })}
                placeholder="M"
                aria-label={t('setup_bot.sizes_cell_size', { n })}
                className={`${CELL} font-semibold`}
              />
              {NUMBER_FIELDS.map((field) => (
                <input
                  key={field}
                  value={row[field]}
                  onChange={(e) => onChange(i, { [field]: e.target.value.replace(/[^\d]/g, '') })}
                  inputMode="numeric"
                  placeholder={t(field.endsWith('Min') ? 'setup_bot.sizes_from' : 'setup_bot.sizes_to')}
                  aria-label={t(CELL_LABEL[field], { n })}
                  className={CELL}
                />
              ))}
              <IconButton label={t('setup_bot.sizes_remove_row', { n })} onClick={() => onRows(rows.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          );
        })}
        <SetupButton variant="ghost" size="sm" onClick={() => onRows([...rows, EMPTY_ROW])} className="self-start">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('setup_bot.sizes_add_row')}
        </SetupButton>
      </div>
    </section>
  );
}
