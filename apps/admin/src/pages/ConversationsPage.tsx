import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Conversation } from '../types';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { MessageSquare } from 'lucide-react';
import { cn } from '../lib/cn';

type Filter = 'all' | 'handoff' | 'active' | 'closed';

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'handoff', label: 'Needs handoff' },
  { key: 'active', label: 'Active' },
  { key: 'closed', label: 'Closed' },
];

function statusVariant(status: string): 'active' | 'closed' | 'default' {
  if (status === 'active' || status === 'human_in_control') return 'active';
  if (status === 'closed') return 'closed';
  return 'default';
}

function statusLabel(status: string): string {
  if (status === 'human_in_control') return 'Human control';
  return status.replace(/_/g, ' ');
}

export default function ConversationsPage() {
  const [filter, setFilter] = useState<Filter>('all');

  const queryParams =
    filter === 'handoff'
      ? '?needsHandoff=true'
      : filter === 'active'
        ? '?status=active'
        : filter === 'closed'
          ? '?status=closed'
          : '';

  const { data, isLoading } = useQuery<{ items: Conversation[]; total: number }>({
    queryKey: ['conversations', filter],
    queryFn: () => api.get(`/conversations${queryParams}`).then((r) => r.data),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Conversations</h1>
        <p className="text-sm text-gray-500 mt-1">
          {data?.total != null ? `${data.total} total` : ''}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filter === f.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {data?.items.map((conv) => (
            <Link
              key={conv.id}
              to={`/conversations/${conv.id}`}
              className={cn(
                'flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors',
                conv.needsHandoff && 'border-l-2 border-l-amber-400',
              )}
            >
              <div className="flex items-center gap-4">
                <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {conv.customerName ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 capitalize">{conv.channel}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {conv.needsHandoff && <Badge variant="handoff">Needs handoff</Badge>}
                <Badge variant={statusVariant(conv.status)}>{statusLabel(conv.status)}</Badge>
                <span className="text-xs text-gray-400 min-w-12 text-right">
                  {conv.lastMessageAt
                    ? new Date(conv.lastMessageAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </span>
              </div>
            </Link>
          ))}
          {data?.items.length === 0 && (
            <EmptyState
              icon={MessageSquare}
              title="No conversations"
              description="Conversations will appear here when customers message your store"
            />
          )}
        </div>
      )}
    </div>
  );
}
