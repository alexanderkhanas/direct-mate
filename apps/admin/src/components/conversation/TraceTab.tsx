import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadingState } from '../ui/Spinner';

// Mirrors apps/api/src/modules/conversations/entities/conversation-trace.entity.ts.
// Kept inline because the surface is admin-only and the shape is allowed
// to evolve without a versioned contract.
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
  handoffReason: string | null;
  traceSteps: string[];
  /** `images`: customer photos the model saw with that message (agent turns). */
  recentMessages: Array<{ role: string; text: string | null; images?: string[] }> | null;
  outboundReply: string | null;
  error: { name: string; message: string; stack?: string; stage?: string } | null;
  model: string | null;
  usage: TraceUsage | null;
  guardResults: { attempts?: GuardAttempt[] } | null;
}

interface TraceUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

/** One draft of the reply and what the guards found in it; a second attempt means a retry. */
interface GuardAttempt {
  text: string;
  grounding: Array<{ kind: string; value?: string }>;
  style: Array<{ kind: string; value?: string }>;
}

function usageLine(t: ConversationTrace): string | null {
  const u = t.usage;
  if (!t.model && !u) return null;
  const parts = [t.model ?? 'model?'];
  if (u?.inputTokens != null) {
    parts.push(`in ${u.inputTokens}${u.cachedInputTokens ? ` (${u.cachedInputTokens} cached)` : ''}`);
  }
  if (u?.outputTokens != null) parts.push(`out ${u.outputTokens}`);
  return parts.join(' · ');
}

function guardFindings(t: ConversationTrace): string[] {
  return (t.guardResults?.attempts ?? []).flatMap((a, i) =>
    [...a.grounding, ...a.style].map((v) => `attempt ${i + 1}: ${v.kind}${v.value ? ` «${v.value}»` : ''}`),
  );
}

function decisionVariant(d: ConversationTrace['decision']): 'active' | 'closed' | 'default' {
  if (d === 'error') return 'default';
  if (d === 'reply') return 'active';
  if (d === 'create_draft_order') return 'active';
  return 'closed';
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

/**
 * Markdown rendering of a trace row for clipboard. Designed to paste
 * cleanly into a Claude chat — section headers + fenced code blocks
 * where the content is monospace-y (JSON, stack traces, recent messages).
 */
function traceToMarkdown(t: ConversationTrace): string {
  const lines: string[] = [];
  lines.push(`### Trace ${t.traceId.slice(0, 8)}  (${t.decision})`);
  lines.push('');
  lines.push(`- **started**: ${fmtTime(t.startedAt)}`);
  lines.push(`- **duration**: ${fmtMs(t.durationMs)}`);
  const usage = usageLine(t);
  if (usage) lines.push(`- **model**: ${usage}`);
  if (t.handoffReason) lines.push(`- **handoff_reason**: ${t.handoffReason}`);
  lines.push('');

  if (t.inboundMessageText) {
    lines.push('**Inbound message:**');
    lines.push('```');
    lines.push(t.inboundMessageText);
    lines.push('```');
  }
  if (t.inboundMediaRef) {
    lines.push('**Inbound media:**');
    lines.push('```json');
    lines.push(JSON.stringify(t.inboundMediaRef, null, 2));
    lines.push('```');
  }

  if (t.outboundReply) {
    lines.push('**Outbound reply:**');
    lines.push('```');
    lines.push(t.outboundReply);
    lines.push('```');
  }

  if (t.error) {
    lines.push(`**Error: ${t.error.name}: ${t.error.message}**`);
    if (t.error.stage) lines.push(`- last stage: \`${t.error.stage}\``);
    if (t.error.stack) {
      lines.push('```');
      lines.push(t.error.stack);
      lines.push('```');
    }
  }

  if (t.traceSteps.length) {
    lines.push('**Trace steps:**');
    lines.push('```');
    t.traceSteps.forEach((s, i) =>
      lines.push(`${String(i + 1).padStart(2, ' ')}. ${s}`),
    );
    lines.push('```');
  }

  if (t.recentMessages && t.recentMessages.length) {
    lines.push('**History given to the agent:**');
    lines.push('```');
    t.recentMessages.forEach((m) =>
      lines.push(`${m.role}: ${m.text ?? '(empty)'}${m.images?.length ? ` [photos: ${m.images.join(', ')}]` : ''}`),
    );
    lines.push('```');
  }

  const findings = guardFindings(t);
  if (findings.length) {
    lines.push('**Guard findings:**');
    lines.push('```');
    findings.forEach((f) => lines.push(f));
    lines.push('```');
  }

  return lines.join('\n');
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
  selected: boolean;
  onToggleSelect: () => void;
}

function TraceCard({ trace, selected, onToggleSelect }: TraceCardProps) {
  const hasError = trace.decision === 'error' && trace.error;
  return (
    <Card padding={false} className={hasError ? 'border-red-200 ring-1 ring-red-100' : undefined}>
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3 border-b border-gray-100">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer shrink-0"
            aria-label={`Select trace ${trace.traceId.slice(0, 8)}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={decisionVariant(trace.decision)}>{trace.decision}</Badge>
              {trace.handoffReason && (
                <span className="text-xs text-gray-500">
                  handoff:{' '}
                  <span className="font-medium text-gray-700">{trace.handoffReason}</span>
                </span>
              )}
            </div>
            {trace.inboundMessageText && (
              <p className="mt-1.5 text-sm text-gray-900 whitespace-pre-wrap break-words">
                <span className="text-gray-400">› </span>
                {trace.inboundMessageText}
              </p>
            )}
          </div>
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

      {usageLine(trace) && (
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-x-3 text-xs text-gray-500">
          <span>{usageLine(trace)}</span>
          <span className="ml-auto">
            <span className="font-medium text-gray-700">total</span> {fmtMs(trace.durationMs)}
          </span>
        </div>
      )}

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

      {trace.outboundReply && (
        <Collapse title="Outbound reply">
          <pre className="text-[11px] font-mono text-gray-700 bg-gray-50 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
            {trace.outboundReply}
          </pre>
        </Collapse>
      )}

      {trace.recentMessages && trace.recentMessages.length > 0 && (
        <Collapse
          title="History given to the agent"
          badge={
            <span className="text-[10px] text-gray-400 font-normal normal-case tracking-normal">
              ({trace.recentMessages.length})
            </span>
          }
        >
          <ul className="space-y-1 text-[11px] font-mono text-gray-700">
            {trace.recentMessages.map((m, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-400 w-16 shrink-0">{m.role}:</span>
                <span className="whitespace-pre-wrap break-words flex-1">
                  {m.text ?? <em className="opacity-50">empty</em>}
                  {m.images && m.images.length > 0 && (
                    <span className="mt-1 flex gap-1">
                      {m.images.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt="" className="h-12 w-12 rounded object-cover border border-gray-200" />
                        </a>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Collapse>
      )}

      {guardFindings(trace).length > 0 && (
        <Collapse title="Guard findings">
          <ul className="space-y-0.5 font-mono text-[11px] text-amber-800">
            {guardFindings(trace).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [justCopied, setJustCopied] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTraces = useMemo(
    () => (data ?? []).filter((t) => selected.has(t.id)),
    [data, selected],
  );

  const allSelected =
    !!data && data.length > 0 && data.every((t) => selected.has(t.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else if (data) {
      setSelected(new Set(data.map((t) => t.id)));
    }
  };

  const copySelected = () => {
    if (selectedTraces.length === 0) return;
    // Sort by startedAt asc so the pasted output reads chronologically,
    // matching how the original conversation unfolded.
    const sorted = [...selectedTraces].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
    const md = sorted.map(traceToMarkdown).join('\n\n---\n\n');
    void navigator.clipboard?.writeText(md);
    setJustCopied(true);
    window.setTimeout(() => setJustCopied(false), 1500);
  };

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
    <div className="space-y-3">
      {/* Sticky selection bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-white/95 backdrop-blur flex items-center gap-3 border-b border-gray-100">
        <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            aria-label="Select all traces"
          />
          {allSelected
            ? `All ${data.length} selected`
            : selected.size > 0
            ? `${selected.size} of ${data.length} selected`
            : `Select all (${data.length})`}
        </label>
        <div className="flex-1" />
        <Button
          size="sm"
          variant={selected.size > 0 ? 'primary' : 'secondary'}
          onClick={copySelected}
          disabled={selected.size === 0}
        >
          {justCopied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy {selected.size > 0 ? `${selected.size} ` : ''}as markdown
            </>
          )}
        </Button>
      </div>

      {data.map((t) => (
        <TraceCard
          key={t.id}
          trace={t}
          selected={selected.has(t.id)}
          onToggleSelect={() => toggle(t.id)}
        />
      ))}
    </div>
  );
}
