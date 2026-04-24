import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/ui/Spinner';

interface AdminAnalytics {
  totalTenants: number;
  activeTenants: number;
  totalConversations: number;
  totalOrders: number;
  totalRevenue: number;
  automationRate: number;
  handoffRate: number;
  planDistribution: Record<string, { active: number; pastDue: number; cancelled: number; expired: number }>;
  recentSignups: Array<{ id: string; name: string; slug: string; createdAt: string }>;
  topTenants: Array<{ id: string; name: string; slug: string; conversation_count: string; order_count: string; plan_type: string | null; plan_status: string | null }>;
  dailyConversations: Array<{ date: string; count: string }>;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </Card>
  );
}

const PLAN_COLORS: Record<string, string> = {
  trial: 'bg-amber-50 text-amber-700',
  starter: 'bg-blue-50 text-blue-700',
  professional: 'bg-indigo-50 text-indigo-700',
  business: 'bg-emerald-50 text-emerald-700',
};

export default function StatsPage() {
  const { data, isLoading } = useQuery<AdminAnalytics>({
    queryKey: ['admin-analytics'],
    queryFn: () => api.get('/admin/analytics').then(r => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return null;

  const planDist = data.planDistribution ?? {};
  const totalOnTrial = planDist.trial?.active ?? 0;
  const totalPaid = Object.entries(planDist)
    .filter(([k]) => k !== 'trial')
    .reduce((sum, [, v]) => sum + v.active, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Platform Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">SaaS metrics across all stores</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Stores" value={data.totalTenants} sub={`${data.activeTenants} active`} />
        <StatCard label="On Trial" value={totalOnTrial} sub={`${totalPaid} paid`} />
        <StatCard label="Total Orders" value={data.totalOrders} />
        <StatCard label="Revenue" value={`${data.totalRevenue.toFixed(0)} UAH`} />
      </div>

      {/* Plan distribution */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Plan Distribution</h2>
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(planDist).map(([planType, counts]) => (
            <div key={planType} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLORS[planType] ?? 'bg-gray-100 text-gray-600'}`}>
                  {planType}
                </span>
              </div>
              <p className="text-xl font-semibold text-gray-900">{counts.active}</p>
              <p className="text-xs text-gray-400">active</p>
              {(counts.pastDue > 0 || counts.cancelled > 0 || counts.expired > 0) && (
                <div className="flex gap-2 mt-1.5 text-xs text-gray-400">
                  {counts.pastDue > 0 && <span className="text-red-500">{counts.pastDue} past due</span>}
                  {counts.cancelled > 0 && <span>{counts.cancelled} cancelled</span>}
                  {counts.expired > 0 && <span>{counts.expired} expired</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Automation + Handoff rates */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Automation Rate</p>
          <p className="text-3xl font-semibold text-gray-900 mt-2">
            {(data.automationRate * 100).toFixed(1)}%
          </p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: `${data.automationRate * 100}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">Conversations handled without handoff</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Handoff Rate</p>
          <p className="text-3xl font-semibold text-gray-900 mt-2">
            {(data.handoffRate * 100).toFixed(1)}%
          </p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${data.handoffRate * 100}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">Conversations requiring human intervention</p>
        </Card>
      </div>

      {/* Top tenants */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Top Stores by Activity</h2>
        <div className="divide-y divide-gray-100">
          {data.topTenants?.map((t, i) => (
            <Link
              key={t.id}
              to={`/admin/stores/${t.id}`}
              className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-4 px-4 rounded transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-400 w-5">{i + 1}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-gray-500">{t.conversation_count} convs</span>
                <span className="text-xs text-gray-500">{t.order_count} orders</span>
                {t.plan_type && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLORS[t.plan_type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {t.plan_type}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </Card>

      {/* Recent signups */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Signups (30 days)</h2>
        {data.recentSignups?.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No recent signups</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.recentSignups?.map(t => (
              <Link
                key={t.id}
                to={`/admin/stores/${t.id}`}
                className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-4 px-4 rounded transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.slug}</p>
                </div>
                <span className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
