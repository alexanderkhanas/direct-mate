import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Plus, Trash2, Crown, ArrowRight, Check } from 'lucide-react';
import { api } from '../lib/api';
import { TenantSettings, ManagerExample } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Textarea';
import { Input } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Spinner';
import { useT } from '../i18n';

function BrandToneSection({ settings }: { settings: TenantSettings }) {
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
function KnowledgeSection() {
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

function SizingSection() {
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

function ExamplesSection() {
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

type OperatingMode = 'learning' | 'active' | 'paused';

interface StoreConfigData {
  operatingMode: OperatingMode;
  learningStartedAt: string | null;
}

function OperatingModeSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data: config } = useQuery<StoreConfigData>({
    queryKey: ['engine-config'],
    queryFn: () => api.get('/engine/config').then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (mode: OperatingMode) => api.patch('/engine/config', { operatingMode: mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engine-config'] }),
  });

  const currentMode: OperatingMode = config?.operatingMode ?? 'active';
  // The API refuses to turn the bot on until the store has what it needs to answer.
  const notReady: string[] = save.isError ? ((save.error as any)?.response?.data?.missing ?? []) : [];

  const modes: { value: OperatingMode; label: string; desc: string }[] = [
    { value: 'learning', label: t('operating_mode.learning'), desc: t('operating_mode.learning_desc') },
    { value: 'active', label: t('operating_mode.active'), desc: t('operating_mode.active_desc') },
    { value: 'paused', label: t('operating_mode.paused'), desc: t('operating_mode.paused_desc') },
  ];

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('operating_mode.title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('operating_mode.subtitle')}</p>
      <div className="space-y-2">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              if (m.value === 'active' && currentMode === 'learning') {
                if (!window.confirm(t('operating_mode.go_live_confirm'))) return;
              }
              save.mutate(m.value);
            }}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              currentMode === m.value
                ? 'border-amber-400 bg-amber-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">{m.label}</span>
              {currentMode === m.value && (
                <span className="w-2 h-2 rounded-full bg-amber-400" />
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
          </button>
        ))}
      </div>
      {currentMode === 'learning' && config?.learningStartedAt && (
        <p className="text-xs text-gray-400 mt-3">
          {t('operating_mode.learning_since', {
            date: new Date(config.learningStartedAt).toLocaleDateString(),
          })}
        </p>
      )}
      {save.isSuccess && (
        <p className="text-xs text-emerald-600 mt-2">{t('operating_mode.saved')}</p>
      )}
      {notReady.length > 0 && (
        <p className="text-xs text-red-600 mt-2">
          {t('operating_mode.not_ready')}{' '}
          {notReady.map((m) => t(`operating_mode.requirement_${m}`)).join(', ')}.
        </p>
      )}
    </Card>
  );
}

function SubscriptionSection() {
  const { t } = useT();
  const qc = useQueryClient();

  const { data: planData } = useQuery<{
    plan: { planType: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
    usage: { used: number; limit: number | null; percentUsed: number | null };
    planConfig: { displayName: string; price: number; conversationLimit: number | null } | null;
    trialDaysRemaining: number | null;
  }>({
    queryKey: ['subscription-plan'],
    queryFn: () => api.get('/subscriptions/plan').then(r => r.data),
  });

  const { data: configs } = useQuery<Array<{
    planType: string; displayName: string; price: number; conversationLimit: number | null; igAccountsLimit: number;
  }>>({
    queryKey: ['available-plans'],
    queryFn: () => api.get('/subscriptions/plans').then(r => r.data),
  });

  const upgrade = useMutation({
    mutationFn: (planType: string) => api.post('/subscriptions/upgrade', { planType }).then(r => r.data),
    onSuccess: (data: { pageUrl: string }) => {
      window.location.href = data.pageUrl;
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post('/subscriptions/cancel'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription-plan'] }),
  });

  const plan = planData?.plan;
  const usage = planData?.usage;
  const trialDays = planData?.trialDaysRemaining;

  const statusColor = !plan ? 'bg-gray-100 text-gray-500'
    : plan.status === 'active' && plan.planType === 'trial' ? 'bg-amber-50 text-amber-700'
    : plan.status === 'active' ? 'bg-emerald-50 text-emerald-700'
    : plan.status === 'past_due' ? 'bg-red-50 text-red-700'
    : 'bg-gray-100 text-gray-500';

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Crown className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-gray-900">{t('settings_ext.subscription_title')}</h2>
        {plan && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${statusColor}`}>
            {plan.planType === 'trial' ? 'Trial' : planData?.planConfig?.displayName ?? plan.planType} · {plan.status}
          </span>
        )}
      </div>

      {/* Trial countdown */}
      {plan?.planType === 'trial' && trialDays != null && (
        <div className={`rounded-lg p-3 mb-4 ${trialDays <= 3 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <p className={`text-sm font-medium ${trialDays <= 3 ? 'text-red-700' : 'text-amber-700'}`}>
            {trialDays > 0 ? `${trialDays} ${t('settings_ext.trial_days_left')}` : t('settings_ext.trial_expired')}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{t('settings_ext.trial_upgrade_hint')}</p>
        </div>
      )}

      {/* Usage bar */}
      {usage && usage.limit && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{t('settings_ext.conversations_this_month')}</span>
            <span>{usage.used} / {usage.limit}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${(usage.percentUsed ?? 0) > 100 ? 'bg-red-500' : (usage.percentUsed ?? 0) > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(usage.percentUsed ?? 0, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Current period */}
      {plan?.currentPeriodEnd && plan.planType !== 'trial' && (
        <p className="text-xs text-gray-400 mb-4">
          {t('settings_ext.next_billing')}: {new Date(plan.currentPeriodEnd).toLocaleDateString()}
        </p>
      )}

      {/* Plan cards */}
      {configs && configs.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-xs font-medium text-gray-600">{plan?.planType === 'trial' ? t('settings_ext.choose_plan') : t('settings_ext.change_plan')}</p>
          <div className="grid grid-cols-3 gap-2">
            {configs.map(cfg => {
              const isCurrent = plan?.planType === cfg.planType;
              return (
                <button
                  key={cfg.planType}
                  onClick={() => !isCurrent && upgrade.mutate(cfg.planType)}
                  disabled={isCurrent || upgrade.isPending}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">{cfg.displayName}</p>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  </div>
                  <p className="text-lg font-bold text-gray-900 mt-1">{(cfg.price / 100).toFixed(0)} <span className="text-xs font-normal text-gray-400">UAH/mo</span></p>
                  <p className="text-xs text-gray-400 mt-1">
                    {cfg.conversationLimit ? `${cfg.conversationLimit} convs` : 'Unlimited'} · {cfg.igAccountsLimit} IG
                  </p>
                  {!isCurrent && (
                    <span className="text-xs text-indigo-600 font-medium mt-2 inline-flex items-center gap-1">
                      {t('settings_ext.upgrade_button')} <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancel */}
      {plan && plan.planType !== 'trial' && plan.status === 'active' && (
        <button
          onClick={() => { if (window.confirm(t('settings_ext.cancel_confirm'))) cancel.mutate(); }}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          {t('settings_ext.cancel_subscription')}
        </button>
      )}
      {cancel.isSuccess && <p className="text-xs text-gray-500 mt-1">{t('settings_ext.cancel_success')}</p>}
    </Card>
  );
}

function DeleteAccountSection() {
  const { t } = useT();
  const [confirmText, setConfirmText] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/auth/account'),
    onSuccess: () => {
      localStorage.removeItem('accessToken');
      window.location.href = '/welcome';
    },
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-red-600 mb-1">{t('settings_ext.delete_account_title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings_ext.delete_account_desc')}</p>

      {!showConfirm ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowConfirm(true)}
          className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('settings_ext.delete_account_button')}
        </Button>
      ) : (
        <div className="p-4 bg-red-50 rounded-lg border border-red-200 space-y-3">
          <p className="text-sm text-red-700">{t('settings_ext.delete_account_warning')}</p>
          <Input
            label={t('settings_ext.delete_account_confirm_label')}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => deleteAccount.mutate()}
              loading={deleteAccount.isPending}
              disabled={confirmText !== 'DELETE'}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {t('settings_ext.delete_account_confirm')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowConfirm(false); setConfirmText(''); }}>
              {t('common.cancel')}
            </Button>
          </div>
          {deleteAccount.isError && (
            <p className="text-xs text-red-600">{t('settings_ext.delete_account_error')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useT();
  const { data, isLoading } = useQuery<TenantSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('settings_ext.configure_subtitle')}</p>
      </div>
      <OperatingModeSection />
      <BrandToneSection settings={data} />
      <KnowledgeSection />
      <SizingSection />
      <ExamplesSection />
      <SubscriptionSection />
      <DeleteAccountSection />
    </div>
  );
}
