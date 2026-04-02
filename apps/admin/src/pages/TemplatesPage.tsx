import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { ResponseTemplate, PhraseBlock, FaqItem } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Textarea';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { useT } from '../i18n';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { cn } from '../lib/cn';

// --- Constants ---

const SCENARIO_LABELS: Record<string, string> = {
  greeting: 'Привітання',
  show_products: 'Показ товарів',
  show_price: 'Показ ціни',
  recommend_product: 'Рекомендація товару',
  ask_recommendation_from_shown: 'Рекомендація зі списку',
  confirm_selection: 'Підтвердження вибору',
  collect_checkout_info: 'Збір даних для замовлення',
  confirm_order: 'Підтвердження замовлення',
  order_confirmed_ask_delivery: 'Запит даних доставки',
  answer_delivery: 'Відповідь про доставку',
  answer_payment: 'Відповідь про оплату',
  out_of_stock: 'Немає в наявності',
  ask_variant_choice: 'Вибір варіанту',
};

const STAGE_OPTIONS = [
  'greeting',
  'need_discovery',
  'product_discovery',
  'showing_options',
  'selection_help',
  'product_selected',
  'checkout_started',
  'collecting_customer_info',
  'order_confirmation',
  'post_order_support',
  'handoff_to_manager',
];

const PHRASE_TYPES = [
  'opener',
  'cta',
  'reassurance',
  'recommendation',
  'escalation',
  'closing',
];

const AVAILABLE_VARIABLES =
  '{product_name}, {category}, {color}, {size}, {price}, {product_list}, {variants}, {variant_type}, {variant_list}, {customer_name}, {phone}, {city}, {delivery_branch}, {order_summary}, {reason}';

const SCENARIO_COLORS: Record<string, string> = {
  greeting: 'bg-blue-100 text-blue-700',
  show_products: 'bg-purple-100 text-purple-700',
  show_price: 'bg-green-100 text-green-700',
  recommend_product: 'bg-amber-100 text-amber-700',
  ask_recommendation_from_shown: 'bg-orange-100 text-orange-700',
  confirm_selection: 'bg-cyan-100 text-cyan-700',
  collect_checkout_info: 'bg-indigo-100 text-indigo-700',
  confirm_order: 'bg-emerald-100 text-emerald-700',
  order_confirmed_ask_delivery: 'bg-teal-100 text-teal-700',
  answer_delivery: 'bg-sky-100 text-sky-700',
  answer_payment: 'bg-violet-100 text-violet-700',
  out_of_stock: 'bg-red-100 text-red-700',
  ask_variant_choice: 'bg-pink-100 text-pink-700',
};

// --- Templates Tab ---

function TemplateCard({ template }: { template: ResponseTemplate }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [blocks, setBlocks] = useState(template.blocks.join('\n'));
  const [requiredVars, setRequiredVars] = useState(template.requiredVariables.join(', '));
  const [priority, setPriority] = useState(template.priority);
  const [active, setActive] = useState(template.active);

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/engine/templates/${template.id}`, {
        blocks: blocks.split('\n').filter((b) => b.trim()),
        requiredVariables: requiredVars
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        priority,
        active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      setExpanded(false);
    },
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/engine/templates/${template.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const handleDelete = () => {
    if (window.confirm('Delete this template?')) del.mutate();
  };

  const colorClass = SCENARIO_COLORS[template.scenario] || 'bg-gray-100 text-gray-600';
  const preview = template.blocks[0]
    ? template.blocks[0].length > 80
      ? template.blocks[0].slice(0, 80) + '...'
      : template.blocks[0]
    : '(empty)';

  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors rounded-lg"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
            colorClass,
          )}
        >
          {SCENARIO_LABELS[template.scenario] || template.scenario}
        </span>
        {template.stage && (
          <Badge variant="default">{template.stage}</Badge>
        )}
        <span className="text-sm text-gray-600 truncate flex-1">{preview}</span>
        <span className="text-xs text-gray-400 shrink-0">P{template.priority}</span>
        <Badge variant={template.active ? 'active' : 'closed'}>
          {template.active ? t('templates.active') : t('templates.inactive')}
        </Badge>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
          <Textarea
            label="Blocks (one per line)"
            rows={4}
            value={blocks}
            onChange={(e) => setBlocks(e.target.value)}
          />
          <p className="text-xs text-gray-400">
            Available variables: {AVAILABLE_VARIABLES}
          </p>
          <Input
            label="Required variables (comma-separated)"
            value={requiredVars}
            onChange={(e) => setRequiredVars(e.target.value)}
          />
          <Input
            label="Priority"
            type="number"
            min={0}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="max-w-xs"
          />
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">{t('templates.active')}</span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => update.mutate()} loading={update.isPending}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="danger" onClick={handleDelete} loading={del.isPending}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddTemplateForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [scenario, setScenario] = useState('greeting');
  const [stage, setStage] = useState('');
  const [blocks, setBlocks] = useState('');
  const [requiredVars, setRequiredVars] = useState('');
  const [priority, setPriority] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      api.post('/engine/templates', {
        scenario,
        stage: stage || null,
        blocks: blocks.split('\n').filter((b) => b.trim()),
        requiredVariables: requiredVars
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        priority,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
  });

  return (
    <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {Object.entries(SCENARIO_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Select label="Stage (optional)" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">-- none --</option>
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <Textarea
        label="Blocks (one per line)"
        rows={4}
        value={blocks}
        onChange={(e) => setBlocks(e.target.value)}
        placeholder="Template text blocks..."
      />
      <p className="text-xs text-gray-400">Available variables: {AVAILABLE_VARIABLES}</p>
      <Input
        label="Required variables (comma-separated)"
        value={requiredVars}
        onChange={(e) => setRequiredVars(e.target.value)}
        placeholder="product_name, price"
      />
      <Input
        label="Priority"
        type="number"
        min={0}
        value={priority}
        onChange={(e) => setPriority(Number(e.target.value))}
        className="max-w-xs"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={!blocks.trim()}
        >
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { t } = useT();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery<ResponseTemplate[]>({
    queryKey: ['templates'],
    queryFn: () => api.get('/engine/templates').then((r) => r.data),
  });

  if (isLoading) return <LoadingState message="Loading templates..." />;

  // Group by scenario
  const grouped: Record<string, ResponseTemplate[]> = {};
  for (const t of data ?? []) {
    if (!grouped[t.scenario]) grouped[t.scenario] = [];
    grouped[t.scenario].push(t);
  }
  // Sort within groups by priority desc
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => b.priority - a.priority);
  }

  const scenarioKeys = Object.keys(SCENARIO_LABELS);
  const sortedGroups = Object.entries(grouped).sort(
    ([a], [b]) => (scenarioKeys.indexOf(a) === -1 ? 999 : scenarioKeys.indexOf(a)) - (scenarioKeys.indexOf(b) === -1 ? 999 : scenarioKeys.indexOf(b)),
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          {t('templates.add_template')}
        </Button>
      </div>

      {showForm && <AddTemplateForm onClose={() => setShowForm(false)} />}

      {sortedGroups.length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-8">
          No templates yet — add one to get started
        </p>
      )}

      {sortedGroups.map(([scenario, templates]) => (
        <div key={scenario}>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {SCENARIO_LABELS[scenario] || scenario} ({templates.length})
          </h3>
          <div className="space-y-2">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Phrase Blocks Tab ---

function AddPhraseBlockForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState('opener');
  const [text, setText] = useState('');
  const [scenarioTags, setScenarioTags] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post('/engine/phrase-blocks', {
        type,
        text,
        scenarioTags: scenarioTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phrase-blocks'] });
      onClose();
    },
  });

  return (
    <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
      <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
        {PHRASE_TYPES.map((pt) => (
          <option key={pt} value={pt}>
            {pt}
          </option>
        ))}
      </Select>
      <Input
        label="Text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Phrase text..."
      />
      <Input
        label="Scenario tags (comma-separated)"
        value={scenarioTags}
        onChange={(e) => setScenarioTags(e.target.value)}
        placeholder="greeting, show_products"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={!text.trim()}
        >
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PhraseBlocksTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery<PhraseBlock[]>({
    queryKey: ['phrase-blocks'],
    queryFn: () => api.get('/engine/phrase-blocks').then((r) => r.data),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/engine/phrase-blocks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['phrase-blocks'] }),
  });

  if (isLoading) return <LoadingState message="Loading phrase blocks..." />;

  // Group by type
  const grouped: Record<string, PhraseBlock[]> = {};
  for (const pb of data ?? []) {
    if (!grouped[pb.type]) grouped[pb.type] = [];
    grouped[pb.type].push(pb);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          Add Phrase Block
        </Button>
      </div>

      {showForm && <AddPhraseBlockForm onClose={() => setShowForm(false)} />}

      {Object.keys(grouped).length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-8">
          No phrase blocks yet — add one to get started
        </p>
      )}

      {Object.entries(grouped).map(([type, phrases]) => (
        <div key={type}>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {type} ({phrases.length})
          </h3>
          <div className="space-y-2">
            {phrases.map((pb) => (
              <div
                key={pb.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200"
              >
                <Badge variant="default">{pb.type}</Badge>
                <span className="text-sm text-gray-700 flex-1">{pb.text}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {pb.scenarioTags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (window.confirm('Delete this phrase block?')) del.mutate(pb.id);
                  }}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- FAQ Tab ---

function FaqCard({ item }: { item: FaqItem }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(item.questionTags.join(', '));
  const [answer, setAnswer] = useState(item.answerTemplate);
  const [active, setActive] = useState(item.active);

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/engine/faq/${item.id}`, {
        questionTags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        answerTemplate: answer,
        active,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['faq'] });
      setEditing(false);
    },
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/engine/faq/${item.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['faq'] }),
  });

  if (editing) {
    return (
      <div className="p-4 rounded-lg border border-gray-200 space-y-3">
        <Input
          label="Question tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <Textarea
          label="Answer template"
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          <span className="text-sm text-gray-700">{t('templates.active')}</span>
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => update.mutate()} loading={update.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm('Delete this FAQ item?')) del.mutate();
            }}
            loading={del.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
    >
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.questionTags.map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
          {!item.active && <Badge variant="closed">Inactive</Badge>}
        </div>
        <p className="text-sm text-gray-700">{item.answerTemplate}</p>
      </div>
    </div>
  );
}

function AddFaqForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [tags, setTags] = useState('');
  const [answer, setAnswer] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post('/engine/faq', {
        questionTags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        answerTemplate: answer,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['faq'] });
      onClose();
    },
  });

  return (
    <div className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
      <Input
        label="Question tags (comma-separated)"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="delivery, shipping"
      />
      <Textarea
        label="Answer template"
        rows={3}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Answer text..."
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={!tags.trim() || !answer.trim()}
        >
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FaqTab() {
  const { t } = useT();
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery<FaqItem[]>({
    queryKey: ['faq'],
    queryFn: () => api.get('/engine/faq').then((r) => r.data),
  });

  if (isLoading) return <LoadingState message={t('common.loading')} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
          {t('templates.add_faq')}
        </Button>
      </div>

      {showForm && <AddFaqForm onClose={() => setShowForm(false)} />}

      {(data ?? []).length === 0 && !showForm && (
        <p className="text-sm text-gray-400 text-center py-8">
          {t('templates.no_faq')}
        </p>
      )}

      <div className="space-y-2">
        {(data ?? []).map((item) => (
          <FaqCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

// --- Main Page ---

type Tab = 'templates' | 'phrases' | 'faq';

export default function TemplatesPage() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('templates');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'templates', label: t('templates.templates_tab') },
    { key: 'phrases', label: t('templates.phrases_tab') },
    { key: 'faq', label: t('templates.faq_tab') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('templates.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t('templates.subtitle')}
        </p>
      </div>

      <Card>
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 mb-4">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'phrases' && <PhraseBlocksTab />}
        {tab === 'faq' && <FaqTab />}
      </Card>
    </div>
  );
}
