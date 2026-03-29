import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MessageSquare, AlertTriangle, Bot, ShoppingBag } from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { Conversation } from '../types';

interface StatsData {
  total: number;
  items: Conversation[];
}

export default function DashboardPage() {
  const { data: all } = useQuery<StatsData>({
    queryKey: ['conversations', 'all'],
    queryFn: () => api.get('/conversations').then((r) => r.data),
  });

  const { data: handoffs } = useQuery<StatsData>({
    queryKey: ['conversations', 'handoffs'],
    queryFn: () => api.get('/conversations?needsHandoff=true').then((r) => r.data),
  });

  const { data: closed } = useQuery<StatsData>({
    queryKey: ['conversations', 'closed'],
    queryFn: () => api.get('/conversations?status=closed').then((r) => r.data),
  });

  const stats = [
    {
      label: 'Total conversations',
      value: all?.total ?? '—',
      icon: MessageSquare,
      color: 'text-blue-500',
      bg: 'bg-blue-50',
    },
    {
      label: 'Need handoff',
      value: handoffs?.total ?? '—',
      icon: AlertTriangle,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
    },
    {
      label: 'Auto-handled',
      value:
        all?.total != null && handoffs?.total != null ? all.total - handoffs.total : '—',
      icon: Bot,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Closed',
      value: closed?.total ?? '—',
      icon: ShoppingBag,
      color: 'text-gray-400',
      bg: 'bg-gray-50',
    },
  ];

  const needsAttention = handoffs?.items ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your store's conversations</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
                <p className="text-3xl font-semibold text-gray-900 mt-1">{s.value}</p>
              </div>
              <div className={`${s.bg} rounded-lg p-2`}>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Needs attention */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Needs attention
        </h2>
        <Card padding={false}>
          {needsAttention.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-400">All conversations are handled</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {needsAttention.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/conversations/${conv.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full bg-amber-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {conv.customer?.username ? `@${conv.customer.username}` : conv.customer?.fullName ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500">{conv.channel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="handoff">Needs handoff</Badge>
                    <span className="text-xs text-gray-400">
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
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
