import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, ShoppingCart, Store, ExternalLink, Crown } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/Spinner';

const PLAN_TYPES = ['trial', 'starter', 'professional', 'business'];
const PLAN_STATUSES = ['active', 'past_due', 'cancelled', 'expired'];

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: tenant, isLoading: loadingTenant } = useQuery<any>({
    queryKey: ['admin-tenant', id],
    queryFn: () => api.get(`/admin/tenants/${id}`).then(r => r.data),
  });

  const { data: planData } = useQuery<any>({
    queryKey: ['admin-tenant-plan', id],
    queryFn: () => api.get(`/subscriptions/plan`).then(r => r.data).catch(() => null),
    enabled: false, // We'll get plan from tenant list endpoint instead
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

      {/* Actions */}
      <div className="flex gap-3">
        <ImpersonateButton tenantId={id!} />
      </div>

      {/* Subscription management */}
      <SubscriptionManager tenantId={id!} />

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

// ─── Impersonate button ────────────────────────────────────────

function ImpersonateButton({ tenantId }: { tenantId: string }) {
  const impersonate = useMutation({
    mutationFn: () => api.post(`/admin/tenants/${tenantId}/impersonate`).then(r => r.data),
    onSuccess: (data: { accessToken: string }) => {
      const url = `${window.location.origin}/login?impersonate=${data.accessToken}`;
      window.open(url, '_blank');
    },
  });

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => impersonate.mutate()}
      loading={impersonate.isPending}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Open as tenant
    </Button>
  );
}

// ─── Subscription manager ──────────────────────────────────────

function SubscriptionManager({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();

  const { data: tenant } = useQuery<any>({
    queryKey: ['admin-tenant', tenantId],
    queryFn: () => api.get(`/admin/tenants/${tenantId}`).then(r => r.data),
  });

  // Get subscription from tenant list (includes subscription data)
  const { data: tenants } = useQuery<any[]>({
    queryKey: ['admin-tenants'],
    queryFn: () => api.get('/admin/tenants').then(r => r.data),
  });

  const sub = tenants?.find((t: any) => t.id === tenantId)?.subscription;

  const [planType, setPlanType] = useState('');
  const [status, setStatus] = useState('');
  const [convLimit, setConvLimit] = useState('');

  // Sync form with loaded data
  const initialized = planType || status;
  if (!initialized && sub) {
    setPlanType(sub.planType);
    setStatus(sub.status);
    setConvLimit(sub.conversationLimit?.toString() ?? '');
  }

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/tenants/${tenantId}/subscription`, {
      planType: planType || undefined,
      status: status || undefined,
      conversationLimit: convLimit === '' ? null : parseInt(convLimit, 10),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      qc.invalidateQueries({ queryKey: ['admin-tenant', tenantId] });
    },
  });

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Crown className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-gray-900">Subscription</h2>
        {sub && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${
            sub.status === 'active'
              ? sub.planType === 'trial' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
              : sub.status === 'past_due' ? 'bg-red-50 text-red-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {sub.planType} · {sub.status}
          </span>
        )}
      </div>

      {sub?.trialEndsAt && (
        <p className="text-xs text-gray-500 mb-3">
          Trial ends: {new Date(sub.trialEndsAt).toLocaleDateString()}
          {sub.currentPeriodEnd && ` · Period ends: ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Plan</label>
          <select
            value={planType}
            onChange={e => setPlanType(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {PLAN_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {PLAN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Conv. limit</label>
          <input
            type="number"
            value={convLimit}
            onChange={e => setConvLimit(e.target.value)}
            placeholder="unlimited"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          Save
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}
