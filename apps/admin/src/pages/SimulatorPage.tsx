import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Zap,
  Play,
  PlayCircle,
  Upload,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  MessageSquare,
  Brain,
  Image,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/cn';
import { useT } from '../i18n';

// --- Types -----------------------------------------------------------

interface AssertionResult {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  message?: string;
}

interface TurnLog {
  turnIndex: number;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  classification: {
    primaryIntent: string;
    recommendedAction: string;
    entities: Record<string, string>;
    slotAction: string;
    confidence: number;
  } | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  prefixReply?: string | null;
  secondaryReply?: string | null;
  imageUrls?: string[];
  state: Record<string, unknown>;
  assertions?: AssertionResult[];
}

interface Scenario {
  key: string;
  name: string;
  description: string;
  tenantId: string;
  turnCount: number;
}

interface ScenarioResult {
  scenarioKey: string;
  name: string;
  turns: TurnLog[];
}

// --- Helpers ---------------------------------------------------------

function confidenceColor(confidence: number): string {
  if (confidence > 0.9) return 'text-emerald-600';
  if (confidence > 0.7) return 'text-yellow-600';
  return 'text-red-600';
}

function decisionVariant(decision: string): 'success' | 'error' | 'active' | 'default' {
  if (decision === 'reply') return 'success';
  if (decision === 'handoff') return 'error';
  if (decision === 'create_draft_order') return 'active';
  return 'default';
}

function isHandoffScenario(key: string): boolean {
  return key.toLowerCase().includes('handoff') || key.toLowerCase().includes('escalat');
}

function turnAssertionFailures(turn: TurnLog): AssertionResult[] {
  return (turn.assertions ?? []).filter((a) => !a.pass);
}

function scenarioPassed(result: ScenarioResult): boolean {
  // If any turn has assertion data, the scenario passes iff all assertions pass.
  const hasAssertions = result.turns.some((t) => (t.assertions?.length ?? 0) > 0);
  if (hasAssertions) {
    return result.turns.every((t) => turnAssertionFailures(t).length === 0);
  }
  // Fallback: handoff-based heuristic for scenarios run through the live runner without assertions
  const hasHandoff = result.turns.some((t) => t.decision === 'handoff');
  if (isHandoffScenario(result.scenarioKey)) return true;
  return !hasHandoff;
}

// --- Classification panel --------------------------------------------

function ClassificationPanel({ classification }: { classification: TurnLog['classification'] }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  if (!classification) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        <Brain className="h-2.5 w-2.5" />
        {t('simulator.classification')}
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-[11px] space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-16 shrink-0">{t('simulator.intent')}</span>
            <span className="font-medium text-gray-700">{classification.primaryIntent}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-16 shrink-0">{t('simulator.action')}</span>
            <span className="font-medium text-gray-700">{classification.recommendedAction}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-16 shrink-0">{t('simulator.slot_action')}</span>
            <span className="font-medium text-gray-700">{classification.slotAction}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 w-16 shrink-0">{t('simulator.confidence')}</span>
            <span className={cn('font-medium', confidenceColor(classification.confidence))}>
              {(classification.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-gray-400 w-16 shrink-0">{t('simulator.entities')}</span>
            <pre className="font-mono text-gray-600 whitespace-pre-wrap break-all">
              {JSON.stringify(classification.entities, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// --- State panel -----------------------------------------------------

function StatePanel({ state }: { state: Record<string, unknown> }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  const keys = Object.keys(state);
  if (keys.length === 0) return null;

  const highlights = [
    'selectionState',
    'lastAction',
    'selectedProductId',
    'selectedVariantName',
  ].filter((k) => state[k] !== undefined && state[k] !== null);

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 transition-colors"
      >
        <span className="font-medium">{t('simulator.state')}</span>
        {highlights.map((k) => (
          <span key={k} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
            {k}={truncateValue(state[k])}
          </span>
        ))}
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 p-2.5 rounded-lg bg-blue-50/50 border border-blue-100 text-[11px] space-y-1">
          {renderStateKV(state, t)}
        </div>
      )}
    </div>
  );
}

function truncateValue(val: unknown): string {
  const s = String(val);
  if (s.length > 20) return s.slice(0, 17) + '...';
  return s;
}

function renderStateKV(state: Record<string, unknown>, _t: ReturnType<typeof useT>['t']) {
  const important = [
    'selectionState',
    'selectedProductId',
    'selectedVariantName',
    'cartItems',
    'lastAction',
    'preQualifyCollected',
    'recommendedSize',
    'orderCreated',
  ];

  return important
    .filter((k) => state[k] !== undefined && state[k] !== null)
    .map((k) => {
      let display: string;
      if (k === 'selectedProductId' && typeof state[k] === 'string') {
        display = (state[k] as string).slice(0, 8) + '...';
      } else if (k === 'cartItems' && Array.isArray(state[k])) {
        display = `${(state[k] as unknown[]).length} item(s)`;
      } else if (typeof state[k] === 'object') {
        display = JSON.stringify(state[k]);
      } else {
        display = String(state[k]);
      }
      return (
        <div key={k} className="flex items-center gap-2">
          <span className="text-gray-400 w-36 shrink-0">{k}</span>
          <span className="font-medium text-gray-700 break-all">{display}</span>
        </div>
      );
    });
}

// --- Assertion failures panel ---------------------------------------

function AssertionPanel({ assertions }: { assertions: AssertionResult[] }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(true);

  if (assertions.length === 0) return null;

  const failures = assertions.filter((a) => !a.pass);

  const formatValue = (v: unknown): string => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'string') return v.length > 80 ? v.slice(0, 77) + '...' : v;
    return JSON.stringify(v);
  };

  // All passed — green summary
  if (failures.length === 0) {
    return (
      <div className="mt-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
          <CheckCircle2 className="h-2.5 w-2.5" />
          {assertions.length}/{assertions.length} {t('simulator.assertions_passed')}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((x) => !x)}
        className="inline-flex items-center gap-1 text-[10px] text-red-600 hover:text-red-800 transition-colors font-medium"
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        {failures.length} {t('simulator.assertions_failed')}
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 p-2.5 rounded-lg bg-red-50 border border-red-200 text-[11px] space-y-2">
          {failures.map((f, i) => (
            <div key={i} className="space-y-0.5">
              <div className="font-mono font-medium text-red-700">{f.field}</div>
              {f.message && (
                <div className="text-red-600 italic">{f.message}</div>
              )}
              <div className="flex items-start gap-2">
                <span className="text-gray-400 w-16 shrink-0">expected</span>
                <span className="font-mono text-emerald-700 break-all">{formatValue(f.expected)}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-gray-400 w-16 shrink-0">actual</span>
                <span className="font-mono text-red-700 break-all">{formatValue(f.actual)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Turn view -------------------------------------------------------

function TurnView({ turn }: { turn: TurnLog }) {
  const { t } = useT();

  return (
    <div className="space-y-2">
      {/* Customer message — LEFT */}
      <div className="flex justify-start">
        <div className="max-w-[75%]">
          <p className="text-[10px] text-gray-400 mb-0.5">{t('simulator.customer')}</p>
          <div className="bg-gray-100 text-gray-900 px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed">
            {turn.message}
          </div>
          {turn.mediaReference && (
            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
              [{turn.mediaReference.type}]
            </span>
          )}
        </div>
      </div>

      {/* Prefix reply — RIGHT, lighter */}
      {turn.prefixReply && (
        <div className="flex justify-end">
          <div className="max-w-[75%]">
            <div className="bg-gray-700 text-gray-200 px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed italic">
              {turn.prefixReply}
            </div>
            <p className="text-[10px] text-gray-400 text-right mt-0.5">
              {t('simulator.size_recommendation')}
            </p>
          </div>
        </div>
      )}

      {/* Bot reply — RIGHT */}
      {turn.replyText && (
        <div className="flex justify-end">
          <div className="max-w-[75%]">
            <p className="text-[10px] text-gray-400 text-right mb-0.5">{t('simulator.bot')}</p>
            <div className="bg-gray-900 text-white px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed">
              {turn.replyText}
            </div>

            {/* Image badge */}
            {turn.imageUrls && turn.imageUrls.length > 0 && (
              <div className="flex justify-end mt-1">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                  <Image className="h-2.5 w-2.5" />
                  {turn.imageUrls.length} image(s)
                </span>
              </div>
            )}

            {/* Decision + scenario badges */}
            <div className="flex justify-end gap-1 mt-1 flex-wrap">
              <Badge variant={decisionVariant(turn.decision)}>
                {turn.decision}
              </Badge>
              {turn.scenario && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                  {turn.scenario}
                </span>
              )}
            </div>

            {/* Classification */}
            <div className="flex justify-end">
              <ClassificationPanel classification={turn.classification} />
            </div>

            {/* State */}
            <div className="flex justify-end">
              <StatePanel state={turn.state} />
            </div>

            {/* Assertions */}
            <div className="flex justify-end">
              <AssertionPanel assertions={turn.assertions ?? []} />
            </div>
          </div>
        </div>
      )}

      {/* Secondary reply (cross-sell) — RIGHT, different shade */}
      {turn.secondaryReply && (
        <div className="flex justify-end">
          <div className="max-w-[75%]">
            <div className="bg-indigo-900 text-indigo-100 px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed">
              {turn.secondaryReply}
            </div>
            <p className="text-[10px] text-gray-400 text-right mt-0.5">
              {t('simulator.cross_sell')}
            </p>
          </div>
        </div>
      )}

      {/* No reply case */}
      {!turn.replyText && turn.decision === 'handoff' && (
        <div className="flex justify-end">
          <div className="max-w-[75%]">
            <div className="bg-red-50 text-red-700 px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm border border-red-200">
              Handoff to manager
            </div>
            <div className="flex justify-end gap-1 mt-1">
              <Badge variant="error">handoff</Badge>
            </div>
            <div className="flex justify-end">
              <ClassificationPanel classification={turn.classification} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Single scenario result ------------------------------------------

function ScenarioResultView({ result }: { result: ScenarioResult }) {
  const { t } = useT();

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-gray-400" />
          <p className="text-sm font-medium text-gray-900">{result.name}</p>
        </div>
        <span className="text-xs text-gray-400">
          {result.turns.length} {t('simulator.turns')}
        </span>
      </div>
      <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
        {result.turns.map((turn) => (
          <TurnView key={turn.turnIndex} turn={turn} />
        ))}
      </div>
    </Card>
  );
}

// --- Run All result card (expandable) --------------------------------

function RunAllScenarioCard({ result }: { result: ScenarioResult }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const passed = scenarioPassed(result);

  const allAssertions = result.turns.flatMap((t) => t.assertions ?? []);
  const assertionPassCount = allAssertions.filter((a) => a.pass).length;
  const assertionTotal = allAssertions.length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
        )}
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">
          {result.name}
        </span>
        <span className="text-xs text-gray-400 shrink-0">
          {result.turns.length} {t('simulator.turns')}
        </span>
        {assertionTotal > 0 && (
          <span className={cn(
            'text-xs font-medium shrink-0',
            assertionPassCount === assertionTotal ? 'text-emerald-600' : 'text-red-600',
          )}>
            {assertionPassCount}/{assertionTotal}
          </span>
        )}
        <Badge variant={passed ? 'success' : 'error'}>
          {passed ? t('simulator.passed') : t('simulator.failed')}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-white">
          {result.turns.map((turn) => (
            <TurnView key={turn.turnIndex} turn={turn} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main page -------------------------------------------------------

export default function SimulatorPage() {
  const { t } = useT();
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [singleResult, setSingleResult] = useState<ScenarioResult | null>(null);
  const [allResults, setAllResults] = useState<ScenarioResult[] | null>(null);
  const [mode, setMode] = useState<'single' | 'all' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Normalize uploaded scenarios — the simulator JSON output uses `scenario`
  // as the top-level key, while the live runner uses `scenarioKey`. Map both.
  const normalizeScenario = (raw: any): ScenarioResult => ({
    scenarioKey: raw.scenarioKey ?? raw.scenario ?? raw.name ?? 'unknown',
    name: raw.name ?? raw.scenarioKey ?? raw.scenario ?? 'Unnamed scenario',
    turns: Array.isArray(raw.turns) ? raw.turns : [],
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // reset the input so selecting the same file again still fires onChange
    if (e.target) e.target.value = '';
    if (!file) return;

    setUploadError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawList = Array.isArray(parsed) ? parsed : [parsed];
      const normalized = rawList.map(normalizeScenario).filter((s) => s.turns.length > 0);
      if (normalized.length === 0) {
        setUploadError(t('simulator.upload_empty'));
        return;
      }
      setAllResults(normalized);
      setSingleResult(null);
      setMode('all');
    } catch (err) {
      setUploadError((err as Error).message || t('simulator.upload_invalid'));
    }
  };

  // Fetch scenario list
  const { data: scenarios, isLoading: scenariosLoading } = useQuery<Scenario[]>({
    queryKey: ['simulator-scenarios'],
    queryFn: () => api.get('/testing/simulator/scenarios').then((r) => r.data),
  });

  // Run single scenario
  const runSingle = useMutation({
    mutationFn: (scenarioKey: string) =>
      api.post('/testing/simulator/run', { scenarioKey }).then((r) => r.data as ScenarioResult),
    onSuccess: (data) => {
      setSingleResult(data);
      setAllResults(null);
      setMode('single');
    },
  });

  // Run all scenarios
  const runAll = useMutation({
    mutationFn: () =>
      api.post('/testing/simulator/run-all').then((r) => r.data as ScenarioResult[]),
    onSuccess: (data) => {
      setAllResults(data);
      setSingleResult(null);
      setMode('all');
    },
  });

  const isRunning = runSingle.isPending || runAll.isPending;

  // Run All summary
  const passedCount = allResults?.filter(scenarioPassed).length ?? 0;
  const totalCount = allResults?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Zap className="h-6 w-6" />
          {t('simulator.title')}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t('simulator.subtitle')}</p>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex items-end gap-3">
          {/* Scenario selector */}
          <div className="flex-1 max-w-md">
            <label className="text-sm font-medium text-gray-700 block mb-1">
              {t('simulator.select_scenario')}
            </label>
            {scenariosLoading ? (
              <div className="text-xs text-gray-400">{t('common.loading')}</div>
            ) : (
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              >
                <option value="">{t('simulator.select_scenario')}</option>
                {scenarios?.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name} ({s.turnCount} {t('simulator.turns')})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Buttons */}
          <Button
            onClick={() => selectedKey && runSingle.mutate(selectedKey)}
            disabled={!selectedKey || isRunning}
            loading={runSingle.isPending}
          >
            <Play className="h-4 w-4" />
            {t('simulator.run')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => runAll.mutate()}
            disabled={isRunning}
            loading={runAll.isPending}
          >
            <PlayCircle className="h-4 w-4" />
            {t('simulator.run_all')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRunning}
          >
            <Upload className="h-4 w-4" />
            {t('simulator.upload_json')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
        {uploadError && (
          <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {uploadError}
          </div>
        )}
      </Card>

      {/* Loading state */}
      {isRunning && (
        <Card>
          <div className="flex items-center justify-center py-12 gap-3 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t('simulator.running')}</span>
          </div>
        </Card>
      )}

      {/* Error state */}
      {(runSingle.isError || runAll.isError) && (
        <Card>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {runSingle.error?.message || runAll.error?.message || 'An error occurred'}
          </div>
        </Card>
      )}

      {/* Empty state */}
      {!isRunning && !singleResult && !allResults && (
        <Card>
          <EmptyState
            icon={MessageSquare}
            title={t('simulator.no_results')}
          />
        </Card>
      )}

      {/* Single scenario result */}
      {mode === 'single' && singleResult && !isRunning && (
        <ScenarioResultView result={singleResult} />
      )}

      {/* Run All results */}
      {mode === 'all' && allResults && !isRunning && (
        <div className="space-y-4">
          {/* Summary */}
          <Card className="flex items-center gap-4">
            <MessageSquare className="h-5 w-5 text-gray-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">
                {t('simulator.summary')}:{' '}
                <span className={cn(passedCount === totalCount ? 'text-emerald-600' : 'text-red-600')}>
                  {passedCount}/{totalCount} {t('simulator.passed')}
                </span>
              </p>
              {totalCount - passedCount > 0 && (
                <p className="text-xs text-red-500">
                  {totalCount - passedCount} {t('simulator.failed')}
                </p>
              )}
            </div>
            <Badge variant={passedCount === totalCount ? 'success' : 'error'}>
              {passedCount === totalCount ? t('simulator.passed') : t('simulator.failed')}
            </Badge>
          </Card>

          {/* Scenario list */}
          <div className="space-y-2">
            {allResults.map((result) => (
              <RunAllScenarioCard key={result.scenarioKey} result={result} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
