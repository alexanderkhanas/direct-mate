import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Instagram, ShoppingBag, Plug, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { useT } from '../i18n';
import { TelegramConnectSection } from '../components/connections/TelegramConnectSection';
import { InstagramConnectButton, useInstagramOAuthResult } from '../components/connections/InstagramConnect';

type BadgeVariant = 'connected' | 'disconnected' | 'error' | 'pending';

function statusVariant(status: string): BadgeVariant {
  if (status === 'connected') return 'connected';
  if (status === 'error') return 'error';
  if (status === 'pending') return 'pending';
  return 'disconnected';
}

function ConnectInstagramForm({ onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { t } = useT();
  return (
    <Card>
      <p className="text-sm font-medium text-gray-700 mb-3">{t('connections_ext.connect_instagram_account')}</p>
      <InstagramConnectButton returnTo="connections" />
      <Button size="sm" variant="ghost" className="mt-2" onClick={onCancel}>{t('common.cancel')}</Button>
    </Card>
  );
}

function ConnectShopifyForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { t } = useT();
  const [shopDomain, setShopDomain] = useState('');
  const [token, setToken] = useState('');
  const [shopName, setShopName] = useState('');
  const [error, setError] = useState('');

  const connect = useMutation({
    mutationFn: () =>
      api.post('/connections/shopify', { shopDomain, accessToken: token, shopName }),
    onSuccess: () => {
      setShopDomain('');
      setToken('');
      setShopName('');
      onSuccess();
    },
    onError: () => setError(t('connections_ext.failed_connect')),
  });

  return (
    <Card>
      <p className="text-sm font-medium text-gray-700 mb-1">{t('connections_ext.connect_shopify_store')}</p>
      <p className="text-xs text-gray-500 mb-3">{t('connections_ext.shopify_token_help')}</p>
      <div className="space-y-3">
        <Input
          label={t('connections.shop_domain')}
          value={shopDomain}
          onChange={(e) => setShopDomain(e.target.value)}
          placeholder="my-store.myshopify.com"
        />
        <Input
          label={t('connections_ext.admin_api_token')}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="shpat_xxxxx"
          type="password"
        />
        <Input
          label={t('connections_ext.store_name_optional')}
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          placeholder="e.g. Beauty Store"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending} disabled={!shopDomain || !token}>
            {t('common.confirm')}
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Card>
  );
}

function ConnectionIcon({ type }: { type: string }) {
  if (type === 'instagram') return <Instagram className="h-4 w-4 text-pink-500" />;
  if (type === 'shopify') return <ShoppingBag className="h-4 w-4 text-green-600" />;
  return <Plug className="h-4 w-4 text-gray-500" />;
}

function connectionLabel(conn: any): string {
  if (conn.type === 'instagram') return conn.metadata?.accountName || 'Instagram';
  if (conn.type === 'shopify') return conn.metadata?.shopName || conn.metadata?.shopDomain || 'Shopify';
  return conn.type;
}

function connectionSubtext(conn: any): string {
  if (conn.type === 'shopify' && conn.metadata?.shopDomain) {
    return conn.metadata.shopDomain;
  }
  if (conn.externalAccountId) {
    return `ID: ${conn.externalAccountId}`;
  }
  return conn.type;
}

export default function ConnectionsPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState<'instagram' | 'shopify' | null>(null);
  const [oauthMessage, setOauthMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // After Meta sends the owner back: a plain-language result instead of a reason code.
  const oauthResult = useInstagramOAuthResult();
  useEffect(() => {
    if (!oauthResult) return;
    setOauthMessage({ type: oauthResult.ok ? 'success' : 'error', text: oauthResult.message });
    if (oauthResult.ok) qc.invalidateQueries({ queryKey: ['connections'] });
  }, [oauthResult, qc]);

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api.post(`/connections/${id}/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const deleteConn = useMutation({
    mutationFn: (id: string) => api.delete(`/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const connections = data ?? [];

  const handleSuccess = () => {
    setShowForm(null);
    qc.invalidateQueries({ queryKey: ['connections'] });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {oauthMessage && (
        <div className={`px-4 py-3 rounded-lg text-sm ${oauthMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {oauthMessage.text}
          <button onClick={() => setOauthMessage(null)} className="ml-2 text-xs opacity-60 hover:opacity-100">\u00d7</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('connections.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('connections.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm(showForm === 'instagram' ? null : 'instagram')}
          >
            <Instagram className="h-4 w-4" />
            {t('connections.instagram')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm(showForm === 'shopify' ? null : 'shopify')}
          >
            <ShoppingBag className="h-4 w-4" />
            {t('connections.shopify')}
          </Button>
        </div>
      </div>

      {showForm === 'instagram' && (
        <ConnectInstagramForm onSuccess={handleSuccess} onCancel={() => setShowForm(null)} />
      )}
      {showForm === 'shopify' && (
        <ConnectShopifyForm onSuccess={handleSuccess} onCancel={() => setShowForm(null)} />
      )}

      <TelegramConnectSection />

      {isLoading ? (
        <LoadingState />
      ) : (
        <Card padding={false}>
          {connections.length === 0 ? (
            <EmptyState
              icon={Plug}
              title={t('connections_ext.no_connections')}
              description={t('connections_ext.no_connections_desc')}
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {connections.map((conn: any) => (
                <div key={conn.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center">
                      <ConnectionIcon type={conn.type} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {connectionLabel(conn)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {connectionSubtext(conn)}
                        {conn.lastSyncAt
                          ? ` · ${t('connections_ext.last_sync')}: ${new Date(conn.lastSyncAt).toLocaleString()}`
                          : ` · ${t('connections.never_synced')}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant(conn.status)}>{conn.status}</Badge>
                    {conn.status === 'connected' && (
                      <button
                        onClick={() => disconnect.mutate(conn.id)}
                        className="text-xs text-gray-400 hover:text-orange-500 transition-colors"
                      >
                        {t('connections.disconnect')}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (confirm(t('connections_ext.remove_connection', { name: connectionLabel(conn) }))) {
                          deleteConn.mutate(conn.id);
                        }
                      }}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
