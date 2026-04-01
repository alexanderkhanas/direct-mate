import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { TenantSettings, ManagerExample } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Textarea';
import { Input } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Spinner';

function BrandToneSection({ settings }: { settings: TenantSettings }) {
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
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Brand tone</h2>
      <Textarea
        value={brandTone}
        onChange={(e) => setBrandTone(e.target.value)}
        rows={4}
        placeholder="e.g. Warm, concise, friendly manager. Never invent facts about stock or pricing."
      />
      <div className="flex items-center gap-3 mt-3">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          Save
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}

function HandoffRulesSection({ settings }: { settings: TenantSettings }) {
  const qc = useQueryClient();
  const [maxFailed, setMaxFailed] = useState(
    settings.handoffRules?.maxFailedTurns ?? 2,
  );
  const [freshness, setFreshness] = useState(
    settings.handoffRules?.stockFreshnessMinutes ?? 10,
  );
  const [sentiment, setSentiment] = useState(
    settings.handoffRules?.negativeSentimentEscalation ?? true,
  );

  const save = useMutation({
    mutationFn: () =>
      api.patch('/settings', {
        handoffRules: {
          maxFailedTurns: maxFailed,
          stockFreshnessMinutes: freshness,
          negativeSentimentEscalation: sentiment,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Handoff rules</h2>
      <div className="space-y-4">
        <Input
          label="Max failed turns before handoff"
          type="number"
          min={1}
          max={10}
          value={maxFailed}
          onChange={(e) => setMaxFailed(Number(e.target.value))}
          className="max-w-xs"
        />
        <Input
          label="Stock freshness (minutes)"
          type="number"
          min={1}
          value={freshness}
          onChange={(e) => setFreshness(Number(e.target.value))}
          className="max-w-xs"
        />
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={sentiment}
            onChange={(e) => setSentiment(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          <span className="text-sm text-gray-700">Escalate on negative sentiment</span>
        </label>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          Save
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}

function FlowConfigSection() {
  const qc = useQueryClient();

  const { data: config } = useQuery<any>({
    queryKey: ['store-config'],
    queryFn: () => api.get('/engine/config').then(r => r.data),
  });

  const flowConfig = (config?.flowConfig ?? {}) as any;
  const [preQualifyEnabled, setPreQualifyEnabled] = useState(false);
  const [preQualifyPrompt, setPreQualifyPrompt] = useState('');
  const [preQualifyFields, setPreQualifyFields] = useState<string[]>([]);
  const [variantMode, setVariantMode] = useState('single');

  useEffect(() => {
    if (config) {
      const fc = (config.flowConfig ?? {}) as any;
      setPreQualifyEnabled(fc.preQualify?.enabled ?? false);
      setPreQualifyPrompt(fc.preQualify?.prompt ?? '');
      setPreQualifyFields(fc.preQualify?.fields ?? []);
      setVariantMode(fc.variants?.askSequence?.length > 1 ? 'two_step' : 'single');
    }
  }, [config]);

  const save = useMutation({
    mutationFn: () => api.patch('/engine/config', {
      flowConfig: {
        preQualify: {
          enabled: preQualifyEnabled,
          prompt: preQualifyPrompt || undefined,
          fields: preQualifyFields.length > 0 ? preQualifyFields : undefined,
        },
        variants: variantMode === 'two_step' ? {
          primaryOption: 'color',
          secondaryOption: 'size',
          askSequence: ['color', 'size'],
        } : undefined,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-config'] }),
  });

  const FIELD_OPTIONS = [
    { value: 'height', label: 'Height' },
    { value: 'weight', label: 'Weight' },
    { value: 'skin_type', label: 'Skin type' },
    { value: 'age', label: 'Age' },
  ];

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Conversation flow</h2>
      <div className="space-y-5">
        {/* Pre-qualification */}
        <div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={preQualifyEnabled}
              onChange={e => setPreQualifyEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">Ask customer info before showing products</span>
          </label>

          {preQualifyEnabled && (
            <div className="mt-3 ml-6 space-y-3">
              <Input
                label="Pre-qualify prompt"
                value={preQualifyPrompt}
                onChange={e => setPreQualifyPrompt(e.target.value)}
                placeholder="Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛"
              />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Fields to collect</label>
                <div className="flex flex-wrap gap-2">
                  {FIELD_OPTIONS.map(f => (
                    <label key={f.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preQualifyFields.includes(f.value)}
                        onChange={e => {
                          if (e.target.checked) setPreQualifyFields([...preQualifyFields, f.value]);
                          else setPreQualifyFields(preQualifyFields.filter(x => x !== f.value));
                        }}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span className="text-sm text-gray-600">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Variant selection mode */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Variant selection mode</label>
          <select
            value={variantMode}
            onChange={e => setVariantMode(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 max-w-xs"
          >
            <option value="single">Single step (ask all at once)</option>
            <option value="two_step">Color then size (two steps)</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">For products with both color and size options</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          Save
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}

function ExamplesSection() {
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
        <h2 className="text-sm font-semibold text-gray-900">Manager examples</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add example
        </Button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
          <Textarea
            label="Customer message"
            rows={2}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="What the customer asks…"
          />
          <Textarea
            label="Manager reply"
            rows={2}
            value={manager}
            onChange={(e) => setManager(e.target.value)}
            placeholder="How the manager responds…"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => add.mutate()}
              loading={add.isPending}
              disabled={!customer || !manager}
            >
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <LoadingState message="Loading examples…" />
      ) : (
        <div className="space-y-3">
          {data?.map((ex) => (
            <div
              key={ex.id}
              className="flex items-start gap-3 p-3 rounded-lg border border-gray-100"
            >
              <div className="flex-1 space-y-1.5">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Customer</p>
                  <p className="text-sm text-gray-700">{ex.customerMessage}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Manager</p>
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
              No examples yet — add some to improve AI responses
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { data, isLoading } = useQuery<TenantSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure AI behavior and handoff rules</p>
      </div>
      <BrandToneSection settings={data} />
      <FlowConfigSection />
      <HandoffRulesSection settings={data} />
      <ExamplesSection />
    </div>
  );
}
