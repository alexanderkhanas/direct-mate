import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, ShoppingCart, Store } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/ui/Spinner';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: tenant, isLoading: loadingTenant } = useQuery<any>({
    queryKey: ['admin-tenant', id],
    queryFn: () => api.get(`/admin/tenants/${id}`).then(r => r.data),
  });

  const { data: conversations } = useQuery<any>({
    queryKey: ['admin-tenant-conversations', id],
    queryFn: () => api.get(`/admin/tenants/${id}/conversations`).then(r => r.data),
  });

  const { data: orders } = useQuery<any>({
    queryKey: ['admin-tenant-orders', id],
    queryFn: () => api.get(`/admin/tenants/${id}/orders`).then(r => r.data),
  });

  if (loadingTenant) return <LoadingState />;
  if (!tenant) return <p className="text-gray-500">Tenant not found</p>;

  const convItems = conversations?.items ?? [];
  const orderItems = Array.isArray(orders) ? orders : orders?.items ?? [];

  return (
    <div className="space-y-6">
      <Link to="/admin/stores" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" /> Stores
      </Link>

      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Store className="h-6 w-6 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{tenant.name}</h1>
          <p className="text-sm text-gray-500">{tenant.slug} · {tenant.businessType}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Conversations</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{convItems.length}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Orders</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{orderItems.length}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connections</p>
          <div className="flex gap-2 mt-2">
            {tenant.connections?.map((c: any) => (
              <Badge key={c.id} variant={c.status === 'connected' ? 'connected' : 'disconnected'}>
                {c.type}
              </Badge>
            ))}
            {(!tenant.connections || tenant.connections.length === 0) && (
              <span className="text-sm text-gray-400">None</span>
            )}
          </div>
        </Card>
      </div>

      {/* Recent conversations */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Conversations</h2>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {convItems.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No conversations</div>
          ) : convItems.slice(0, 10).map((conv: any) => (
            <div key={conv.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-900">
                    {conv.customer?.username ? `@${conv.customer.username}` : conv.customer?.fullName ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-gray-400">{conv.channel}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {conv.needsHandoff && <Badge variant="handoff">Handoff</Badge>}
                <Badge variant={conv.status === 'active' ? 'connected' : 'pending'}>{conv.status}</Badge>
                <span className="text-xs text-gray-400">
                  {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString() : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent orders */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Orders</h2>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {orderItems.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No orders</div>
          ) : orderItems.slice(0, 10).map((order: any) => (
            <div key={order.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-900">{order.customer?.fullName ?? 'Unknown'}</p>
                  <p className="text-xs text-gray-400">
                    {order.items?.map((i: any) => i.productTitle).join(', ') || 'No items'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {order.totalAmount ? `${Number(order.totalAmount).toFixed(2)} ${order.currency}` : '—'}
                </span>
                <Badge variant={order.status === 'confirmed' ? 'connected' : 'pending'}>{order.status}</Badge>
                <span className="text-xs text-gray-400">
                  {new Date(order.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
