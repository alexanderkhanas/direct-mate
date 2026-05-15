import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, MessageSquare, Activity } from 'lucide-react';
import { api } from '../lib/api';
import { ConversationDetail } from '../types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LoadingState } from '../components/ui/Spinner';
import { Tabs } from '../components/ui/Tabs';
import { TraceTab } from '../components/conversation/TraceTab';
import { cn } from '../lib/cn';

type DetailTab = 'messages' | 'trace';

function statusVariant(status: string): 'active' | 'closed' | 'default' {
  if (status === 'active' || status === 'human_in_control') return 'active';
  if (status === 'closed') return 'closed';
  return 'default';
}

function statusLabel(status: string): string {
  if (status === 'human_in_control') return 'Human control';
  return status.replace(/_/g, ' ');
}

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('messages');

  const { data, isLoading } = useQuery<ConversationDetail>({
    queryKey: ['conversations', id],
    queryFn: () => api.get(`/conversations/${id}`).then((r) => r.data),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length]);

  const takeover = useMutation({
    mutationFn: () =>
      api.post(`/conversations/${id}/takeover`, { managerUserId: 'current-user' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations', id] }),
  });

  const release = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/release`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations', id] }),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return <p className="text-sm text-red-500">Conversation not found</p>;

  const customerName = data.customer.username ?? data.customer.externalUserId;

  const sortedMessages = [...data.messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back */}
      <Link
        to="/conversations"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Conversations
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{customerName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusVariant(data.status)}>{statusLabel(data.status)}</Badge>
            <span className="text-xs text-gray-400 capitalize">{data.channel}</span>
          </div>
        </div>
        <div>
          {data.status !== 'human_in_control' ? (
            <Button
              onClick={() => takeover.mutate()}
              loading={takeover.isPending}
              size="sm"
            >
              Take over
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => release.mutate()}
              loading={release.isPending}
              size="sm"
            >
              Release
            </Button>
          )}
        </div>
      </div>

      {/* Handoff banner */}
      {data.needsHandoff && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">This conversation needs attention</p>
            </div>
        </div>
      )}

      <Tabs<DetailTab>
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Conversation view"
        options={[
          {
            value: 'messages',
            label: 'Messages',
            icon: <MessageSquare className="h-3.5 w-3.5" />,
          },
          {
            value: 'trace',
            label: 'Trace',
            icon: <Activity className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {activeTab === 'trace' ? (
        id ? <TraceTab conversationId={id} /> : null
      ) : (
      <div className="flex gap-4">
        {/* Chat thread */}
        <div className="flex-1">
          <Card padding={false} className="overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Messages</p>
            </div>
            <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
              {sortedMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.direction === 'outbound' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div className="max-w-xs space-y-1">
                    <p
                      className={cn(
                        'text-xs font-medium',
                        msg.direction === 'outbound' ? 'text-right text-gray-400' : 'text-gray-400',
                      )}
                    >
                      {msg.role === 'assistant' ? 'AI' : msg.role === 'manager' ? 'Manager' : 'Customer'}
                    </p>
                    <div
                      className={cn(
                        'text-sm px-3.5 py-2.5 rounded-2xl leading-relaxed',
                        msg.direction === 'outbound'
                          ? 'bg-gray-900 text-white rounded-br-sm'
                          : 'bg-gray-100 text-gray-900 rounded-bl-sm',
                      )}
                    >
                      {msg.text ?? <em className="opacity-50">empty</em>}
                    </div>
                    <p
                      className={cn(
                        'text-xs text-gray-400',
                        msg.direction === 'outbound' ? 'text-right' : '',
                      )}
                    >
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </Card>
        </div>

        {/* Right panel: state */}
        {data.state && (
          <div className="w-52 shrink-0">
            <Card>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                State
              </p>
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-gray-400">Status</dt>
                  <dd className="text-sm font-medium text-gray-900 capitalize">
                    {data.state.stateStatus?.replace(/_/g, ' ') ?? '—'}
                  </dd>
                </div>
                {data.state.selectedProductId && (
                  <div>
                    <dt className="text-xs text-gray-400">Product ID</dt>
                    <dd className="text-xs font-mono text-gray-700 break-all">
                      {data.state.selectedProductId.slice(0, 8)}…
                    </dd>
                  </div>
                )}
                {data.state.selectedVariantId && (
                  <div>
                    <dt className="text-xs text-gray-400">Variant ID</dt>
                    <dd className="text-xs font-mono text-gray-700 break-all">
                      {data.state.selectedVariantId.slice(0, 8)}…
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
