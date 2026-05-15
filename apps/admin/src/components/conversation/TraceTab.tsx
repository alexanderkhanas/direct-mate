import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { LoadingState } from '../ui/Spinner';

// Mirrors apps/api/src/modules/conversations/entities/conversation-trace.entity.ts.
// Kept inline here rather than in a shared package because the surface is
// admin-only and the trace shape is allowed to evolve without a versioned
// contract.
interface OpenAiCall {
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  requestId?: string | null;
  source?: string;
}

interface ConversationTrace {
  id: string;
  traceId: string;
  conversationId: string | null;
  inboundMessageText: string | null;
  inboundMediaRef: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  decision: 'reply' | 'handoff' | 'create_draft_order' | 'error';
  templateScenario: string | null;
  handoffReason: string | null;
  traceSteps: string[];
  stageTimings: Record<string, number | undefined>;
  classifierOutput: Record<string, unknown> | null;
  openaiRequestIds: string[] | null;
  error: { name: string; message: string; stack?: string; stage?: string } | null;
}

function decisionVariant(d: ConversationTrace['decision']): 'active' | 'closed' | 'default' {
  if (d === 'error') return 'default'; // styled red below; default badge here
  if (d === 'reply') return 'active';
  if (d === 'create_draft_order') return 'active';
  return 'closed'; // handoff
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString([], { day: '2-digit', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
}

function copyTo(text: string) {
  void navigator.clipboard?.writeText(text);
}

interface StageBarProps {
  timings: Record<string, number | undefined>;
  totalMs: number | null;
}

function StageBar({ timings, totalMs }: StageBarProps) {
  // Pull the ms-suffixed keys; pretty-print the stage name.
  const stages = Object.entries(timings)
    .filter(([k, v]) => k.endsWith('_ms') && typeof v === 'number' && v > 0)
    .map(([k, v]) => ({ name: k.replace(/_ms$/, ''), ms: v as number }));
  if (stages.length === 0) return null;
  const measuredTotal = stages.reduce((s, x) => s + x.ms, 0);
  // Use the larger of measured stage sum and total turn duration so bar
  // widths reflect proportion correctly even if some stages weren't timed.
  const denom = Math.max(measuredTotal, totalMs ?? 0, 1);
  return (
    <div className="space-y-1.5">
      <div className="flex w-full h-2 rounded-full overflow-hidden bg-gray-100">
        {stages.map((s, i) => {
          const pct = (s.ms / denom) * 100;
          const palette = [
            'bg-violet-500',
            'bg-sky-500',
            'bg-emerald-500',
            'bg-amber-500',
            'bg-rose-500',
          ];
          return (
            <div
              key={s.name}
              className={`${palette[i % palette.length]}`}
              style={{ width: `${pct}%` }}
              title={`${s.name}: ${fmtMs(s.ms)}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {stages.map((s) => (
          <span key={s.name}>
            <span className="font-medium text-gray-700">{s.name}</span> {fmtMs(s.ms)}
          </span>
        ))}
        {totalMs != null && (
          <span className="ml-auto">
            <span className="font-medium text-gray-700">total</span> {fmtMs(totalMs)}
          </span>
        )}
      </div>
    </div>
  );
}

interface CollapseProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}

function Collapse({ title, children, defaultOpen, badge }: CollapseProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide hover:bg-gray-50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>{title}</span>
        {badge && <span className="ml-2">{badge}</span>}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

interface TraceCardProps {
  trace: ConversationTrace;
}

function TraceCard({ trace }: TraceCardProps) {
  const hasError = trace.decision === 'error' && trace.error;
  return (
    <Card padding={false} className={hasError ? 'border-red-200 ring-1 ring-red-100' : undefined}>
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={decisionVariant(trace.decision)}>{trace.decision}</Badge>
            {trace.templateScenario && (
              <span className="text-xs text-gray-500">
                template:{' '}
                <span className="font-medium text-gray-700">{trace.templateScenario}</span>
              </span>
            )}
            {trace.handoffReason && (
              <span className="text-xs text-gray-500">
                handoff:{' '}
                <span className="font-medium text-gray-700">{trace.handoffReason}</span>
              </span>
            )}
          </div>
          {trace.inboundMessageText && (
            <p className="mt-1.5 text-sm text-gray-900 line-clamp-2">
              <span className="text-gray-400">› </span>
              {trace.inboundMessageText}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-500">{fmtTime(trace.startedAt)}</p>
          <button
            type="button"
            onClick={() => copyTo(trace.traceId)}
            className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-gray-400 hover:text-gray-700"
            title="Copy trace ID"
          >
            <Copy className="h-3 w-3" />
            {trace.traceId.slice(0, 8)}
          </button>
        </div>
      </div>

      {/* Error banner — only when decision='error' */}
      {hasError && trace.error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-100">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-900">
                {trace.error.name}: {trace.error.message}
              </p>
              {trace.error.stage && (
                <p className="text-xs text-red-700 mt-1">
                  last stage:{' '}
                  <span className="font-mono">{trace.error.stage}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stage timings */}
      <div className="px-4 py-3 border-b border-gray-100">
        <StageBar timings={trace.stageTimings} totalMs={trace.durationMs} />
      </div>

      {/* Collapsible sections */}
      <Collapse
        title="Trace steps"
        defaultOpen
        badge={
          <span className="text-[10px] text-gray-400 font-normal normal-case tracking-normal">
            ({trace.traceSteps.length})
          </span>
        }
      >
        {trace.traceSteps.length === 0 ? (
          <p className="text-xs text-gray-400 italic">no steps captured</p>
        ) : (
          <ol className="space-y-0.5 font-mono text-[11px] text-gray-700">
            {trace.traceSteps.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-400 select-none w-5 text-right">{i + 1}</span>
                <span className="whitespace-pre-wrap break-words flex-1">{step}</span>
              </li>
            ))}
          </ol>
        )}
      </Collapse>

      {trace.classifierOutput && (
        <Collapse title="Classifier output">
          <pre className="text-[11px] font-mono text-gray-700 bg-gray-50 rounded-md p-2.5 overflow-x-auto">
            {JSON.stringify(trace.classifierOutput, null, 2)}
          </pre>
        </Collapse>
      )}

      {(trace.stageTimings?.openai_call_count ?? 0) > 0 && (
        <Collapse
          title="OpenAI calls"
          badge={
            <span className="text-[10px] text-gray-400 font-normal normal-case tracking-normal">
              (tokens: {trace.stageTimings?.openai_total_tokens ?? 0})
            </span>
          }
        >
          {trace.openaiRequestIds && trace.openaiRequestIds.length > 0 ? (
            <ul className="space-y-1 text-xs text-gray-600 font-mono">
              {trace.openaiRequestIds.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="text-gray-400">req-id:</span>
                  <span>{id}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400 italic">
              request ids not captured for this turn
            </p>
          )}
        </Collapse>
      )}

      {hasError && trace.error?.stack && (
        <Collapse title="Stack trace">
          <pre className="text-[11px] font-mono text-red-800 bg-red-50 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
            {trace.error.stack}
          </pre>
        </Collapse>
      )}
    </Card>
  );
}

export function TraceTab({ conversationId }: { conversationId: string }) {
  const { data, isLoading, error } = useQuery<ConversationTrace[]>({
    queryKey: ['conversation-traces', conversationId],
    queryFn: () =>
      api.get(`/conversations/${conversationId}/traces`).then((r) => r.data),
    refetchInterval: 10_000,
  });

  if (isLoading) return <LoadingState />;
  if (error)
    return (
      <p className="text-sm text-red-500">
        Failed to load traces: {(error as Error).message}
      </p>
    );
  if (!data || data.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500">
          No trace rows yet. Traces start being captured at the next inbound
          message after the tracing feature ships — older conversations don't
          have rows retroactively.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {data.map((t) => (
        <TraceCard key={t.id} trace={t} />
      ))}
    </div>
  );
}
