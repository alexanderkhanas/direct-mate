import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Store, Instagram, ShoppingBag, Send, MessageSquare, ShoppingCart, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  connections: Array<{ type: string; status: string }>;
  conversationCount: number;
  orderCount: number;
  subscription?: {
    planType: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    conversationLimit: number | null;
  } | null;
}

export default function TenantsPage() {
  const { data, isLoading } = useQuery<TenantRow[]>({
    queryKey: ['admin-tenants'],
    queryFn: () => api.get('/admin/tenants').then(r => r.data),
  });

  const tenants = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Stores</h1>
        <p className="text-sm text-gray-500 mt-1">{tenants.length} registered stores</p>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : tenants.length === 0 ? (
        <Card>
          <EmptyState icon={Store} title="No stores" description="No stores registered yet" />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {tenants.map(tenant => (
            <Link
              key={tenant.id}
              to={`/admin/stores/${tenant.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Store className="h-5 w-5 text-indigo-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{tenant.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    {tenant.connections?.some((c: any) => c.type === 'instagram') && (
                      <Instagram className={`h-3.5 w-3.5 ${tenant.connections.find((c: any) => c.type === 'instagram')?.status === 'connected' ? 'text-pink-500' : 'text-gray-300'}`} />
                    )}
                    {tenant.connections?.some((c: any) => c.type === 'shopify') && (
                      <ShoppingBag className={`h-3.5 w-3.5 ${tenant.connections.find((c: any) => c.type === 'shopify')?.status === 'connected' ? 'text-green-500' : 'text-gray-300'}`} />
                    )}
                    {tenant.connections?.some((c: any) => c.type === 'telegram') && (
                      <Send className="h-3.5 w-3.5 text-blue-500" />
                    )}
                    <span className="text-xs text-gray-400">
                      {tenant.slug}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {tenant.conversationCount}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {tenant.orderCount}
                </div>
                {tenant.subscription && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    tenant.subscription.status === 'active'
                      ? tenant.subscription.planType === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                      : tenant.subscription.status === 'past_due' ? 'bg-red-50 text-red-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {tenant.subscription.planType}{tenant.subscription.status !== 'active' ? ` · ${tenant.subscription.status}` : ''}
                  </span>
                )}
                <Badge variant={tenant.isActive ? 'connected' : 'disconnected'}>
                  {tenant.isActive ? 'Active' : 'Inactive'}
                </Badge>
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
