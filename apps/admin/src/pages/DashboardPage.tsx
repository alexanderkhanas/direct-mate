import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  AlertTriangle,
  Bot,
  ShoppingBag,
  TrendingUp,
  Clock,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
  PieChart, Pie,
} from 'recharts';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { useT } from '../i18n';

interface DashboardData {
  period: { from: string; to: string };
  summary: {
    totalConversations: number;
    automationRate: number;
    totalOrders: number;
    totalRevenue: number;
    currency: string;
  };
  conversationsPerDay: Array<{ date: string; total: number; autoHandled: number }>;
  funnel: {
    started: number;
    productShown: number;
    variantSelected: number;
    orderCreated: number;
  };
  handoffReasons: Array<{ reason: string; count: number }>;
  avgResponseTimeMs: number;
  recentOrders: Array<{
    id: string;
    status: string;
    totalAmount: number;
    currency: string;
    customerName: string;
    createdAt: string;
  }>;
}

const FUNNEL_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'];
const PIE_COLORS = ['#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#6b7280'];

// REASON_LABELS moved to useT() below

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCurrency(amount: number, currency: string): string {
  return `${amount.toLocaleString('uk-UA')} ${currency}`;
}

function StatCard({ label, value, icon: Icon, color, bg }: {
  label: string; value: string | number; icon: typeof MessageSquare; color: string; bg: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-semibold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`${bg} rounded-lg p-2`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { t } = useT();
  const REASON_LABELS: Record<string, string> = {
    product_not_found: t('dashboard.reason_product_not_found'),
    low_confidence: t('dashboard.reason_low_confidence'),
    send_failed: t('dashboard.reason_send_failed'),
    ai_fallback_failure: t('dashboard.reason_ai_fallback'),
    unknown: t('dashboard.reason_unknown'),
  };
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then((r) => r.data),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <LoadingState />;

  const { summary, conversationsPerDay, funnel, handoffReasons, avgResponseTimeMs, recentOrders } = data;

  const funnelData = [
    { name: t('dashboard.funnel_started'), value: funnel.started },
    { name: t('dashboard.funnel_product_shown'), value: funnel.productShown },
    { name: t('dashboard.funnel_variant_selected'), value: funnel.variantSelected },
    { name: t('dashboard.funnel_order_created'), value: funnel.orderCreated },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('dashboard.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('dashboard.conversations')}
          value={summary.totalConversations}
          icon={MessageSquare}
          color="text-blue-500"
          bg="bg-blue-50"
        />
        <StatCard
          label={t('dashboard.automation_rate')}
          value={`${Math.round(summary.automationRate * 100)}%`}
          icon={Bot}
          color="text-emerald-500"
          bg="bg-emerald-50"
        />
        <StatCard
          label={t('dashboard.orders')}
          value={summary.totalOrders}
          icon={ShoppingBag}
          color="text-violet-500"
          bg="bg-violet-50"
        />
        <StatCard
          label={t('dashboard.revenue')}
          value={formatCurrency(summary.totalRevenue, summary.currency)}
          icon={TrendingUp}
          color="text-amber-500"
          bg="bg-amber-50"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversations per day */}
        <Card className="lg:col-span-2">
          <p className="text-sm font-semibold text-gray-700 mb-4">{t('dashboard.conversations_per_day')}</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={conversationsPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                labelFormatter={(d) => new Date(String(d)).toLocaleDateString('uk-UA')}
              />
              <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={false} name={t('dashboard.total')} />
              <Line type="monotone" dataKey="autoHandled" stroke="#10b981" strokeWidth={2} dot={false} name={t('dashboard.auto_handled')} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Handoff reasons */}
        <Card>
          <p className="text-sm font-semibold text-gray-700 mb-4">{t('dashboard.handoff_reasons')}</p>
          {handoffReasons.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
              {t('dashboard.no_handoffs')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={handoffReasons}
                  dataKey="count"
                  nameKey="reason"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  label={(props: any) =>
                    `${REASON_LABELS[props.reason] ?? props.reason} (${props.count})`
                  }
                >
                  {handoffReasons.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => [value, REASON_LABELS[name] ?? name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Funnel + response time row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversion funnel */}
        <Card className="lg:col-span-2">
          <p className="text-sm font-semibold text-gray-700 mb-4">{t('dashboard.conversion_funnel')}</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnelData} layout="vertical" barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12, fill: '#374151' }}
                width={120}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {funnelData.map((_, i) => (
                  <Cell key={i} fill={FUNNEL_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Avg response time */}
        <Card>
          <p className="text-sm font-semibold text-gray-700 mb-2">{t('dashboard.avg_response_time')}</p>
          <div className="flex items-center gap-3 mt-6">
            <div className="bg-blue-50 rounded-lg p-3">
              <Clock className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-3xl font-semibold text-gray-900">{formatMs(avgResponseTimeMs)}</p>
              <p className="text-xs text-gray-500 mt-1">{t('dashboard.response_time_desc')}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent orders */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          {t('dashboard.recent_orders')}
        </h2>
        <Card padding={false}>
          {recentOrders.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-400">{t('dashboard.no_orders')}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3 text-left font-medium">{t('dashboard.customer')}</th>
                  <th className="px-5 py-3 text-left font-medium">{t('common.status')}</th>
                  <th className="px-5 py-3 text-left font-medium">{t('dashboard.amount')}</th>
                  <th className="px-5 py-3 text-left font-medium">{t('common.date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-900 font-medium">
                      <Link to={`/orders`} className="hover:underline">
                        {order.customerName ?? 'Unknown'}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={order.status === 'confirmed' ? 'success' : order.status === 'cancelled' ? 'error' : 'pending'}>
                        {order.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {order.totalAmount ? formatCurrency(order.totalAmount, order.currency) : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-500">
                      {new Date(order.createdAt).toLocaleDateString('uk-UA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
