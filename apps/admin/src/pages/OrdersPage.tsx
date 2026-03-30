import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  Package,
  User,
  Phone,
  MapPin,
  Building2,
  ExternalLink,
} from 'lucide-react';
import { api } from '../lib/api';
import { Order } from '../types';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

type BadgeVariant =
  | 'active'
  | 'handoff'
  | 'closed'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'pending'
  | 'success'
  | 'default';

const statusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'default' },
  awaiting_manager_confirmation: { label: 'Awaiting confirmation', variant: 'pending' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  shipped: { label: 'Shipped', variant: 'active' },
  delivered: { label: 'Delivered', variant: 'connected' },
  cancelled: { label: 'Cancelled', variant: 'error' },
};

const syncStatusConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  none: { label: 'Not synced', variant: 'closed' },
  pending: { label: 'Syncing...', variant: 'pending' },
  synced: { label: 'Synced', variant: 'success' },
  failed: { label: 'Sync failed', variant: 'error' },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number | null, currency: string) {
  if (amount === null) return '--';
  return `${Number(amount).toFixed(2)} ${currency}`;
}

function OrderRow({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/orders/${order.id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const retrySyncMutation = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/retry-sync`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const status = statusConfig[order.status] ?? { label: order.status, variant: 'default' as const };
  const syncStatus = syncStatusConfig[order.externalSyncStatus] ?? {
    label: order.externalSyncStatus,
    variant: 'default' as const,
  };

  const customerName = order.customer?.fullName || 'Unknown';
  const productSummary =
    order.items.length > 0
      ? order.items
          .map((i) => {
            const parts = [i.productTitle ?? 'Product'];
            if (i.variantTitle) parts.push(`(${i.variantTitle})`);
            if (i.qty > 1) parts.push(`x${i.qty}`);
            return parts.join(' ');
          })
          .join(', ')
      : '--';

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors flex items-center gap-4"
      >
        <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_100px_120px_100px_140px] gap-4 items-center">
          {/* Customer */}
          <div className="truncate">
            <p className="text-sm font-medium text-gray-900 truncate">{customerName}</p>
            {order.customer?.phone && (
              <p className="text-xs text-gray-400 truncate">{order.customer.phone}</p>
            )}
          </div>

          {/* Products */}
          <p className="text-sm text-gray-600 truncate">{productSummary}</p>

          {/* Total */}
          <p className="text-sm font-medium text-gray-900 text-right">
            {formatCurrency(order.totalAmount, order.currency)}
          </p>

          {/* Status */}
          <div>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>

          {/* Sync */}
          <div className="flex items-center gap-1.5">
            <Badge variant={syncStatus.variant}>{syncStatus.label}</Badge>
            {order.externalSyncStatus === 'failed' && (
              <button
                onClick={(e) => { e.stopPropagation(); retrySyncMutation.mutate(); }}
                className="text-[10px] text-blue-500 hover:text-blue-700"
              >
                {retrySyncMutation.isPending ? '...' : 'Retry'}
              </button>
            )}
          </div>

          {/* Date */}
          <p className="text-xs text-gray-400 text-right">{formatDate(order.createdAt)}</p>
        </div>

        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 bg-gray-50/50">
          <div className="grid grid-cols-2 gap-6">
            {/* Customer info */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Customer
              </h4>
              <div className="space-y-2">
                {order.customer?.fullName && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <User className="h-3.5 w-3.5 text-gray-400" />
                    {order.customer.fullName}
                  </div>
                )}
                {order.customer?.phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Phone className="h-3.5 w-3.5 text-gray-400" />
                    {order.customer.phone}
                  </div>
                )}
                {order.customer?.city && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <MapPin className="h-3.5 w-3.5 text-gray-400" />
                    {order.customer.city}
                  </div>
                )}
                {order.customer?.branch && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Building2 className="h-3.5 w-3.5 text-gray-400" />
                    {order.customer.branch}
                  </div>
                )}
                {!order.customer && (
                  <p className="text-sm text-gray-400 italic">No customer info</p>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Items
              </h4>
              {order.items.length > 0 ? (
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Package className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                        <span className="text-gray-700 truncate">
                          {item.productTitle ?? 'Product'}
                          {item.variantTitle && (
                            <span className="text-gray-400 ml-1">({item.variantTitle})</span>
                          )}
                        </span>
                        {item.qty > 1 && (
                          <span className="text-gray-400">x{item.qty}</span>
                        )}
                      </div>
                      <span className="text-gray-900 font-medium shrink-0 ml-3">
                        {formatCurrency(item.unitPrice, item.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No items</p>
              )}
            </div>
          </div>

          {/* Metadata row */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>Source: {order.source}</span>
              <span>ID: {order.id.slice(0, 8)}...</span>
              {order.externalOrderId && (
                <span className="flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  External: {order.externalOrderId}
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {order.status === 'awaiting_manager_confirmation' && (
                <Button
                  size="sm"
                  variant="primary"
                  loading={statusMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    statusMutation.mutate('confirmed');
                  }}
                >
                  Confirm Order
                </Button>
              )}
              {order.status === 'confirmed' && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={statusMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    statusMutation.mutate('shipped');
                  }}
                >
                  Mark as Shipped
                </Button>
              )}
              {order.status === 'shipped' && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={statusMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    statusMutation.mutate('delivered');
                  }}
                >
                  Mark as Delivered
                </Button>
              )}
              {order.status !== 'cancelled' && order.status !== 'delivered' && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={statusMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    statusMutation.mutate('cancelled');
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => api.get('/orders').then((r) => r.data),
  });

  const counts = orders
    ? {
        total: orders.length,
        awaiting: orders.filter((o) => o.status === 'awaiting_manager_confirmation').length,
        confirmed: orders.filter((o) => o.status === 'confirmed').length,
      }
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Orders</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage orders created from Instagram DM conversations
        </p>
      </div>

      {/* Summary stats */}
      {counts && counts.total > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Total</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{counts.total}</p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              Awaiting confirmation
            </p>
            <p className="text-2xl font-semibold text-yellow-600 mt-1">{counts.awaiting}</p>
          </Card>
          <Card>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Confirmed</p>
            <p className="text-2xl font-semibold text-emerald-600 mt-1">{counts.confirmed}</p>
          </Card>
        </div>
      )}

      {/* Table header */}
      {!isLoading && orders && orders.length > 0 && (
        <Card padding={false}>
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/80 rounded-t-xl">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_100px_120px_100px_140px] gap-4 items-center pr-8">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Customer
              </span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Products
              </span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">
                Total
              </span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Status
              </span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Sync
              </span>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">
                Date
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </div>
        </Card>
      )}

      {isLoading && <LoadingState />}

      {!isLoading && orders && orders.length === 0 && (
        <Card padding={false}>
          <EmptyState
            icon={ShoppingCart}
            title="No orders yet"
            description="Orders will appear here when customers complete checkout via Instagram DM"
          />
        </Card>
      )}
    </div>
  );
}
