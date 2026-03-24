import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  FlaskConical,
  Play,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  MessageSquare,
  Brain,
  Save,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  TestRun,
  TestRunScenario,
  TestStep,
  TestAssertion,
} from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { LoadingState } from '../components/ui/Spinner';
import { cn } from '../lib/cn';

// ─── Helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return '--';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Status badges ────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: TestRun['status'] }) {
  if (status === 'running')
    return (
      <Badge variant="pending" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </Badge>
    );
  if (status === 'completed') return <Badge variant="success">Completed</Badge>;
  return <Badge variant="error">Failed</Badge>;
}

function ScenarioStatusIcon({ status }: { status: TestRunScenario['status'] }) {
  if (status === 'passed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
  return <Clock className="h-4 w-4 text-gray-300" />;
}

function ReviewStatusBadge({
  status,
}: {
  status: TestRunScenario['reviewStatus'];
}) {
  if (status === 'approved') return <Badge variant="success">Approved</Badge>;
  if (status === 'needs_fix') return <Badge variant="error">Needs Fix</Badge>;
  return <Badge variant="default">Pending</Badge>;
}

// ─── Assertion badge ──────────────────────────────────────────────

function AssertionBadge({ assertion }: { assertion: TestAssertion }) {
  if (assertion.passed) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {assertion.type}={formatAssertionValue(assertion.expected)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700 border border-red-200">
      <XCircle className="h-2.5 w-2.5" />
      expected {assertion.type}={formatAssertionValue(assertion.expected)}, got{' '}
      {formatAssertionValue(assertion.actual)}
    </span>
  );
}

function formatAssertionValue(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (Array.isArray(val)) return `[${val.join(', ')}]`;
  return String(val);
}

// ─── Memory display ───────────────────────────────────────────────

function MemoryPanel({ memory }: { memory: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const keys = Object.keys(memory);
  if (keys.length === 0) return null;

  // Show key fields inline
  const highlights = ['selectionState', 'lastAction', 'selectedProduct', 'selectedVariant'].filter(
    (k) => memory[k] !== undefined && memory[k] !== null,
  );

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 transition-colors"
      >
        <Brain className="h-2.5 w-2.5" />
        {highlights.map((k) => (
          <span key={k} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
            {k}={String(memory[k])}
          </span>
        ))}
        {expanded ? (
          <ChevronDown className="h-2.5 w-2.5" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" />
        )}
      </button>
      {expanded && (
        <pre className="mt-1 p-2 rounded bg-gray-50 text-[10px] text-gray-600 overflow-x-auto max-h-40">
          {JSON.stringify(memory, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Conversation step view ───────────────────────────────────────

function StepView({ step }: { step: TestStep }) {
  return (
    <div className="space-y-2">
      {/* Customer message */}
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="bg-indigo-500 text-white px-3 py-2 rounded-2xl rounded-br-md text-sm">
            {step.customerMessage}
          </div>
          <p className="text-[10px] text-gray-400 text-right mt-0.5">
            Step {step.stepIndex + 1} &middot; Customer
          </p>
        </div>
      </div>

      {/* Bot reply */}
      {step.botReply && (
        <div className="flex justify-start">
          <div className="max-w-[75%]">
            <div
              className={cn(
                'px-3 py-2 rounded-2xl rounded-bl-md text-sm',
                step.passed
                  ? 'bg-gray-100 text-gray-800'
                  : 'bg-red-50 text-gray-800 border border-red-200',
              )}
            >
              {step.botReply}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {step.scenario && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                  scenario={step.scenario}
                </span>
              )}
              {step.templateId && step.templateId !== 'ai_fallback' && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                  template={step.templateId.slice(0, 8)}
                </span>
              )}
              {step.templateId === 'ai_fallback' && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
                  AI fallback
                </span>
              )}
            </div>
            {/* Assertions */}
            {step.assertions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {step.assertions.map((a, idx) => (
                  <AssertionBadge key={idx} assertion={a} />
                ))}
              </div>
            )}
            {/* Memory */}
            <MemoryPanel memory={step.memory} />
          </div>
        </div>
      )}

      {/* No reply (error or skipped) */}
      {!step.botReply && step.failReason && (
        <div className="flex justify-start">
          <div className="max-w-[75%]">
            <div className="px-3 py-2 rounded-2xl rounded-bl-md text-sm bg-red-50 text-red-700 border border-red-200">
              {step.failReason}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Scenario card ────────────────────────────────────────────────

function ScenarioCard({
  scenario,
  runId,
}: {
  scenario: TestRunScenario;
  runId: string;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [reviewStatus, setReviewStatus] = useState(scenario.reviewStatus);
  const [reviewComment, setReviewComment] = useState(scenario.reviewComment ?? '');

  // Sync local state if scenario prop updates
  useEffect(() => {
    setReviewStatus(scenario.reviewStatus);
    setReviewComment(scenario.reviewComment ?? '');
  }, [scenario.reviewStatus, scenario.reviewComment]);

  const updateReview = useMutation({
    mutationFn: () =>
      api.patch(`/testing/runs/${runId}/scenarios/${scenario.id}`, {
        reviewStatus,
        reviewComment: reviewComment || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-run', runId] });
    },
  });

  const stepsPassed = scenario.steps.filter((s) => s.passed).length;
  const stepsTotal = scenario.steps.length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        <ScenarioStatusIcon status={scenario.status} />
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">
          {scenario.scenarioName}
        </span>
        <span className="text-xs text-gray-400 shrink-0">
          {stepsPassed}/{stepsTotal} steps
        </span>
        {scenario.durationMs && (
          <span className="text-xs text-gray-400 shrink-0">
            {formatDuration(scenario.durationMs)}
          </span>
        )}
        <ReviewStatusBadge status={scenario.reviewStatus} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100">
          {/* Conversation view */}
          <div className="p-4 space-y-4 bg-white">
            {scenario.errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {scenario.errorMessage}
              </div>
            )}
            {scenario.steps.map((step) => (
              <StepView key={step.stepIndex} step={step} />
            ))}
          </div>

          {/* Review controls */}
          <div className="p-4 bg-gray-50 border-t border-gray-100 space-y-3">
            <div className="flex items-center gap-3">
              <Select
                label="Review Status"
                value={reviewStatus}
                onChange={(e) =>
                  setReviewStatus(
                    e.target.value as 'pending' | 'approved' | 'needs_fix',
                  )
                }
                className="max-w-xs"
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="needs_fix">Needs Fix</option>
              </Select>
            </div>
            <Textarea
              label="Comment"
              rows={2}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="Optional review notes..."
            />
            <Button
              size="sm"
              onClick={() => updateReview.mutate()}
              loading={updateReview.isPending}
            >
              <Save className="h-3.5 w-3.5" />
              Save Review
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Run card ─────────────────────────────────────────────────────

function RunCard({ run }: { run: TestRun }) {
  const [expanded, setExpanded] = useState(false);

  const { data: fullRun, isLoading } = useQuery<TestRun>({
    queryKey: ['test-run', run.id],
    queryFn: () => api.get(`/testing/runs/${run.id}`).then((r) => r.data),
    enabled: expanded,
    refetchInterval: run.status === 'running' ? 3000 : false,
  });

  const passRate =
    run.totalScenarios > 0
      ? `${run.passedScenarios}/${run.totalScenarios}`
      : '--';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Run header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        <RunStatusBadge status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {passRate} passed
            </span>
            {run.failedScenarios > 0 && (
              <span className="text-sm text-red-600">
                {run.failedScenarios} failed
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">{timeAgo(run.startedAt)}</p>
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {new Date(run.startedAt).toLocaleString()}
        </span>
      </button>

      {/* Expanded scenarios */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-2 bg-gray-50/50">
          {isLoading && <LoadingState message="Loading scenarios..." />}
          {fullRun?.scenarios
            ?.sort((a, b) => a.scenarioFile.localeCompare(b.scenarioFile))
            .map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} runId={run.id} />
            ))}
          {fullRun && (!fullRun.scenarios || fullRun.scenarios.length === 0) && (
            <p className="text-sm text-gray-400 text-center py-4">
              No scenarios found for this run.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────

export default function TestingPage() {
  const qc = useQueryClient();

  const { data: runs, isLoading } = useQuery<TestRun[]>({
    queryKey: ['test-runs'],
    queryFn: () => api.get('/testing/runs').then((r) => r.data),
    refetchInterval: 5000, // poll for new/running runs
  });

  const startRun = useMutation({
    mutationFn: () => api.post('/testing/run'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-runs'] });
    },
  });

  const latestRun = runs?.[0];
  const hasRunningRun = runs?.some((r) => r.status === 'running');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <FlaskConical className="h-6 w-6" />
            E2E Testing
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Run conversation test scenarios against the reply engine
          </p>
        </div>
        <Button
          onClick={() => startRun.mutate()}
          loading={startRun.isPending}
          disabled={!!hasRunningRun}
        >
          <Play className="h-4 w-4" />
          Run Tests
        </Button>
      </div>

      {/* Latest run summary */}
      {latestRun && (
        <Card className="flex items-center gap-4">
          <MessageSquare className="h-5 w-5 text-gray-400" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">
              Last run:{' '}
              <span
                className={cn(
                  latestRun.failedScenarios > 0 ? 'text-red-600' : 'text-emerald-600',
                )}
              >
                {latestRun.passedScenarios}/{latestRun.totalScenarios} passed
              </span>
            </p>
            <p className="text-xs text-gray-400">{timeAgo(latestRun.startedAt)}</p>
          </div>
          <RunStatusBadge status={latestRun.status} />
        </Card>
      )}

      {/* Run history */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Run History
        </h2>

        {isLoading && <LoadingState message="Loading test runs..." />}

        {!isLoading && (!runs || runs.length === 0) && (
          <Card>
            <div className="text-center py-12">
              <FlaskConical className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                No test runs yet. Click "Run Tests" to start.
              </p>
            </div>
          </Card>
        )}

        {runs?.map((run) => <RunCard key={run.id} run={run} />)}
      </div>
    </div>
  );
}
