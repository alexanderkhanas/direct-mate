import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { TenantSettings, ManagerExample } from '../../types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Input } from '../ui/Input';
import { LoadingState } from '../ui/Spinner';
import { useT } from '../../i18n';

/*
 * Store settings forms shared by the Settings page and the setup flow. Each
 * loads its own data and saves on its own, so either page can embed it.
 */

export function BrandToneSection({ settings }: { settings: TenantSettings }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [brandTone, setBrandTone] = useState(settings.brandTonePrompt ?? '');

  useEffect(() => {
    setBrandTone(settings.brandTonePrompt ?? '');
  }, [settings.brandTonePrompt]);

  const save = useMutation({
    mutationFn: () => api.patch('/settings', { brandTone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('settings.brand_tone')}</h2>
      <Textarea
        value={brandTone}
        onChange={(e) => setBrandTone(e.target.value)}
        rows={4}
        placeholder={t('settings_ext.brand_tone_placeholder')}
      />
      <div className="flex items-center gap-3 mt-3">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          {t('common.save')}
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">{t('settings.saved')}</span>}
      </div>
    </Card>
  );
}

/**
 * What the agent answers from besides the catalog, and the fixed lines it
 * sends. Each is stored on the store config; an empty field clears it.
 */
export function KnowledgeSection() {
  const { t } = useT();
  const qc = useQueryClient();

  const { data: config } = useQuery<any>({
    queryKey: ['store-config'],
    queryFn: () => api.get('/engine/config').then((r) => r.data),
  });

  const [notes, setNotes] = useState('');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [welcomeLine, setWelcomeLine] = useState('');
  const [handoffLine, setHandoffLine] = useState('');

  useEffect(() => {
    if (!config) return;
    setNotes(config.knowledgeDoc ?? '');
    setPaymentDetails(config.checkoutConfig?.paymentDetails ?? '');
    setWelcomeLine(config.brandConfig?.welcomeLine ?? '');
    setHandoffLine(config.handoffConfig?.announceText ?? '');
  }, [config]);

  // `null` clears a key: the API merges these objects, so an omitted key would be kept.
  const save = useMutation({
    mutationFn: () =>
      api.patch('/engine/config', {
        knowledgeDoc: notes,
        checkoutConfig: { paymentDetails: paymentDetails.trim() || null },
        brandConfig: { welcomeLine: welcomeLine.trim() || null },
        handoffConfig: { announceText: handoffLine.trim() || null },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-config'] }),
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('settings_ext.knowledge_title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings_ext.knowledge_desc')}</p>
      <div className="space-y-4">
        <div>
          <Textarea
            label={t('settings_ext.store_notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={12}
            placeholder={t('settings_ext.store_notes_placeholder')}
          />
          <p className="text-xs text-gray-400 mt-1">{t('settings_ext.store_notes_desc')}</p>
        </div>
        <div>
          <Textarea
            label={t('settings_ext.payment_details')}
            value={paymentDetails}
            onChange={(e) => setPaymentDetails(e.target.value)}
            rows={4}
          />
          <p className="text-xs text-gray-400 mt-1">{t('settings_ext.payment_details_desc')}</p>
        </div>
        <div>
          <Input
            label={t('settings_ext.welcome_line')}
            value={welcomeLine}
            onChange={(e) => setWelcomeLine(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">{t('settings_ext.welcome_line_desc')}</p>
        </div>
        <div>
          <Input
            label={t('settings_ext.handoff_line')}
            value={handoffLine}
            onChange={(e) => setHandoffLine(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">{t('settings_ext.handoff_line_desc')}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          {t('common.save')}
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">{t('settings.saved')}</span>}
      </div>
    </Card>
  );
}

/** Size ranges as edited in the form — one row per size, strings so inputs stay controlled. */
interface SizeRangeRow {
  size: string;
  heightMin: string;
  heightMax: string;
  weightMin: string;
  weightMax: string;
}

/** flow_config keys the form models. Everything else round-trips via the advanced editor. */
const KNOWN_FLOW_KEYS = ['sizing', 'sizeChart'];

function sizeChartToRows(chart: unknown): SizeRangeRow[] {
  if (!chart || typeof chart !== 'object') return [];
  return Object.entries(chart as Record<string, any>).map(([size, r]) => ({
    size,
    heightMin: r?.heightMin != null ? String(r.heightMin) : '',
    heightMax: r?.heightMax != null ? String(r.heightMax) : '',
    weightMin: r?.weightMin != null ? String(r.weightMin) : '',
    weightMax: r?.weightMax != null ? String(r.weightMax) : '',
  }));
}

function rowsToSizeChart(rows: SizeRangeRow[]): Record<string, unknown> | undefined {
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

/** `hideAdvanced`: no raw flow_config editor (the setup flow). */
export function SizingSection({ hideAdvanced = false }: { hideAdvanced?: boolean } = {}) {
  const { t } = useT();
  const qc = useQueryClient();

  const { data: config } = useQuery<any>({
    queryKey: ['store-config'],
    queryFn: () => api.get('/engine/config').then(r => r.data),
  });

  const [advice, setAdvice] = useState<'recommend' | 'consult'>('recommend');
  const [askFirst, setAskFirst] = useState(false);
  const [sizeRows, setSizeRows] = useState<SizeRangeRow[]>([]);
  const [advancedJson, setAdvancedJson] = useState('');
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      const fc = (config.flowConfig ?? {}) as any;
      setAdvice(fc.sizing?.advice === 'consult' ? 'consult' : 'recommend');
      setAskFirst(fc.sizing?.askMeasurementsFirst === true);
      setSizeRows(sizeChartToRows(fc.sizeChart));
      // Keys the form doesn't model (commentHandling, conversationIdleHours, …) stay
      // editable as raw JSON so a save can never silently drop them.
      const rest = Object.fromEntries(
        Object.entries(fc).filter(([k]) => !KNOWN_FLOW_KEYS.includes(k)),
      );
      setAdvancedJson(Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '');
    }
  }, [config]);

  const save = useMutation({
    mutationFn: () => {
      let advanced: Record<string, unknown> = {};
      if (advancedJson.trim()) advanced = JSON.parse(advancedJson);
      // A key DELETED from the advanced textarea has to be sent as an explicit
      // null, or the merge on the API side just keeps the stored value and the
      // deletion looks like it worked until the next reload.
      const storedFlow = (config?.flowConfig ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(storedFlow)) {
        if (KNOWN_FLOW_KEYS.includes(k)) continue;
        if (!(k in advanced)) advanced[k] = null;
      }
      // `null`, never `undefined`, for a cleared value. The API shallow-merges
      // flowConfig (so a form that models a subset of the keys can't destroy
      // the rest), and `JSON.stringify` drops undefined — so an undefined here
      // means "key absent from the patch", which the merge reads as "leave it
      // alone". Blanking a field in the UI would silently no-op. `null` is the
      // documented clear signal and the API deletes the key.
      return api.patch('/engine/config', {
        flowConfig: {
          ...advanced,
          sizing: { advice, askMeasurementsFirst: askFirst },
          sizeChart: rowsToSizeChart(sizeRows) ?? null,
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-config'] }),
  });

  const onSave = () => {
    if (advancedJson.trim()) {
      try {
        JSON.parse(advancedJson);
      } catch (e) {
        setAdvancedError((e as Error).message);
        return;
      }
    }
    setAdvancedError(null);
    save.mutate();
  };

  const updateRow = (i: number, patch: Partial<SizeRangeRow>) =>
    setSizeRows(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('settings_ext.sizing_title')}</h2>
      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('settings_ext.sizing_advice')}</label>
          <select
            value={advice}
            onChange={e => setAdvice(e.target.value as 'recommend' | 'consult')}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 max-w-xs"
          >
            <option value="recommend">{t('settings_ext.sizing_recommend')}</option>
            <option value="consult">{t('settings_ext.sizing_consult')}</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">{t('settings_ext.sizing_advice_desc')}</p>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={askFirst}
            onChange={e => setAskFirst(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          <span className="text-sm text-gray-700">{t('settings_ext.ask_measurements_first')}</span>
        </label>

        {/* Size ranges (height/weight → size) */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('settings_ext.size_chart_ranges')}</label>
          <p className="text-xs text-gray-400 mb-2">{t('settings_ext.size_chart_ranges_desc')}</p>
          {sizeRows.length === 0 && (
            <p className="text-xs text-gray-400 mb-2">{t('settings_ext.size_chart_empty')}</p>
          )}
          {sizeRows.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-[4rem_1fr_1fr_1.5rem] gap-2 text-xs text-gray-400">
                <span>{t('settings_ext.size_chart_size')}</span>
                <span>{t('settings_ext.size_chart_height')}</span>
                <span>{t('settings_ext.size_chart_weight')}</span>
                <span />
              </div>
              {sizeRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[4rem_1fr_1fr_1.5rem] gap-2 items-center">
                  <input
                    value={row.size}
                    onChange={e => updateRow(i, { size: e.target.value })}
                    placeholder="M"
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-full"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={row.heightMin}
                      onChange={e => updateRow(i, { heightMin: e.target.value })}
                      placeholder={t('settings_ext.size_chart_min')}
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-full"
                    />
                    <span className="text-gray-300">–</span>
                    <input
                      type="number"
                      value={row.heightMax}
                      onChange={e => updateRow(i, { heightMax: e.target.value })}
                      placeholder={t('settings_ext.size_chart_max')}
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-full"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={row.weightMin}
                      onChange={e => updateRow(i, { weightMin: e.target.value })}
                      placeholder={t('settings_ext.size_chart_min')}
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-full"
                    />
                    <span className="text-gray-300">–</span>
                    <input
                      type="number"
                      value={row.weightMax}
                      onChange={e => updateRow(i, { weightMax: e.target.value })}
                      placeholder={t('settings_ext.size_chart_max')}
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 w-full"
                    />
                  </div>
                  <button
                    onClick={() => setSizeRows(rows => rows.filter((_, idx) => idx !== i))}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                    aria-label="remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => setSizeRows(rows => [...rows, { size: '', heightMin: '', heightMax: '', weightMin: '', weightMax: '' }])}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('settings_ext.size_chart_add_row')}
          </Button>
        </div>

        {/* Advanced: any flow_config key the form above doesn't model */}
        {!hideAdvanced && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">{t('settings_ext.advanced_config')}</label>
            <p className="text-xs text-gray-400 mb-2">{t('settings_ext.advanced_config_desc')}</p>
            <Textarea
              value={advancedJson}
              onChange={e => setAdvancedJson(e.target.value)}
              rows={advancedJson ? 8 : 3}
              placeholder="{}"
              className="font-mono text-xs"
            />
            {advancedError && (
              <p className="text-xs text-red-600 mt-1">{advancedError}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={onSave} loading={save.isPending} size="sm">
          {t('common.save')}
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">{t('settings.saved')}</span>}
      </div>
    </Card>
  );
}

export function ExamplesSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [customer, setCustomer] = useState('');
  const [manager, setManager] = useState('');

  const { data, isLoading } = useQuery<ManagerExample[]>({
    queryKey: ['examples'],
    queryFn: () => api.get('/settings/examples').then((r) => r.data),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post('/settings/examples', { customerMessage: customer, managerReply: manager }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['examples'] });
      setCustomer('');
      setManager('');
      setShowForm(false);
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/examples/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['examples'] }),
  });

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">{t('settings.manager_examples')}</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('settings_ext.add_example')}
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
          <Textarea
            label={t('settings_ext.customer_message')}
            rows={2}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder={t('settings_ext.customer_asks_placeholder')}
          />
          <Textarea
            label={t('settings_ext.manager_reply')}
            rows={2}
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            placeholder={t('settings_ext.manager_responds_placeholder')}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => add.mutate()}
              loading={add.isPending}
              disabled={!customer || !manager}
            >
              {t('common.add')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState message={t('settings_ext.loading_examples')} />
      ) : (
        <div className="space-y-3">
          {data?.map((ex) => (
            <div
              key={ex.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-100"
            >
              <div className="flex-1 space-y-1.5">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{t('settings_ext.customer_message')}</p>
                  <p className="text-sm text-gray-700">{ex.customerMessage}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{t('settings_ext.manager_reply')}</p>
                  <p className="text-sm text-gray-700">{ex.managerReply}</p>
                </div>
              </div>
              <button
                onClick={() => del.mutate(ex.id)}
                className="text-gray-300 hover:text-red-500 transition-colors mt-0.5"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {data?.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              {t('settings_ext.no_examples')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];
type DayHours = { open: boolean; from: string; to: string };

/** Stored hours (`mon_fri`/`sat_sun` ranges or single days) → one row per day. */
function hoursToRows(raw: unknown): Record<Day, DayHours> {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const value = (day: Day): unknown =>
    stored[day] ?? (['mon', 'tue', 'wed', 'thu', 'fri'].includes(day) ? stored.mon_fri : stored.sat_sun);
  return Object.fromEntries(
    DAYS.map((day) => {
      const v = value(day);
      const m = typeof v === 'string' ? v.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/) : null;
      return [day, m ? { open: true, from: m[1], to: m[2] } : { open: false, from: '09:00', to: '18:00' }];
    }),
  ) as Record<Day, DayHours>;
}

/** When managers answer: the bot tells customers when a person will reply after a handoff. */
export function BusinessHoursSection({ settings }: { settings: TenantSettings }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<Day, DayHours>>(() => hoursToRows(settings.businessHours));
  useEffect(() => setRows(hoursToRows(settings.businessHours)), [settings.businessHours]);

  const save = useMutation({
    mutationFn: () =>
      api.patch('/settings', {
        businessHours: Object.fromEntries(
          DAYS.map((day) => [day, rows[day].open ? `${rows[day].from}-${rows[day].to}` : 'closed']),
        ),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const update = (day: Day, patch: Partial<DayHours>) => setRows((r) => ({ ...r, [day]: { ...r[day], ...patch } }));

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('settings_ext.hours_title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings_ext.hours_desc')}</p>
      <div className="space-y-2">
        {DAYS.map((day) => (
          <div key={day} className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2 w-28 cursor-pointer">
              <input
                type="checkbox"
                checked={rows[day].open}
                onChange={(e) => update(day, { open: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              />
              <span className="text-gray-700">{t(`settings_ext.day_${day}`)}</span>
            </label>
            {rows[day].open ? (
              <>
                <input type="time" value={rows[day].from} onChange={(e) => update(day, { from: e.target.value })}
                  className="px-2 py-1 text-sm border border-gray-200 rounded-lg" />
                <span className="text-gray-300">–</span>
                <input type="time" value={rows[day].to} onChange={(e) => update(day, { to: e.target.value })}
                  className="px-2 py-1 text-sm border border-gray-200 rounded-lg" />
              </>
            ) : (
              <span className="text-xs text-gray-400">{t('settings_ext.day_off')}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">{t('common.save')}</Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">{t('settings.saved')}</span>}
      </div>
    </Card>
  );
}

/** What the bot asks for before placing an order. Only these names mean anything to the order draft. */
const CHECKOUT_FIELDS = ['fullName', 'phone', 'city', 'novaPoshtaBranch', 'paymentMethod'] as const;
const DEFAULT_CHECKOUT_FIELDS = ['fullName', 'phone', 'city', 'novaPoshtaBranch'];

export function CheckoutFieldsSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data: config } = useQuery<any>({
    queryKey: ['store-config'],
    queryFn: () => api.get('/engine/config').then((r) => r.data),
  });
  const [fields, setFields] = useState<string[]>(DEFAULT_CHECKOUT_FIELDS);
  useEffect(() => {
    const stored = config?.checkoutConfig?.fields;
    if (Array.isArray(stored) && stored.length > 0) setFields(stored);
  }, [config]);

  const save = useMutation({
    mutationFn: () => api.patch('/engine/config', { checkoutConfig: { fields } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-config'] }),
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('settings_ext.checkout_title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings_ext.checkout_desc')}</p>
      <div className="space-y-2">
        {CHECKOUT_FIELDS.map((f) => (
          <label key={f} className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={fields.includes(f)}
              onChange={(e) => setFields((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">{t(`settings_ext.field_${f}`)}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm" disabled={fields.length === 0}>
          {t('common.save')}
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">{t('settings.saved')}</span>}
      </div>
    </Card>
  );
}

