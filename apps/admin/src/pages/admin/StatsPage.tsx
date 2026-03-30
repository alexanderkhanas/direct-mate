import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/Spinner';

interface GlobalStats {
  totalTenants: number;
  activeTenants: number;
  totalConversations: number;
  totalOrders: number;
  totalRevenue: number;
  automationRate: number;
  handoffRate: number;
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

export default function StatsPage() {
  const { data, isLoading } = useQuery<GlobalStats>({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Cross-store platform statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Stores" value={data.totalTenants} sub={`${data.activeTenants} active`} />
        <StatCard label="Conversations" value={data.totalConversations} />
        <StatCard label="Orders" value={data.totalOrders} />
        <StatCard
          label="Revenue"
          value={`${data.totalRevenue.toFixed(2)} UAH`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Automation Rate</p>
          <p className="text-3xl font-semibold text-gray-900 mt-2">
            {(data.automationRate * 100).toFixed(1)}%
          </p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full"
              style={{ width: `${data.automationRate * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">Conversations handled without handoff</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Handoff Rate</p>
          <p className="text-3xl font-semibold text-gray-900 mt-2">
            {(data.handoffRate * 100).toFixed(1)}%
          </p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{ width: `${data.handoffRate * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">Conversations requiring human intervention</p>
        </Card>
      </div>
    </div>
  );
}
