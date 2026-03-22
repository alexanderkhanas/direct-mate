import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Instagram, Plug } from 'lucide-react';
import { api } from '../lib/api';
import { Connection } from '../types';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';

type BadgeVariant = 'connected' | 'disconnected' | 'error' | 'pending';

function statusVariant(status: string): BadgeVariant {
  if (status === 'connected') return 'connected';
  if (status === 'error') return 'error';
  if (status === 'pending') return 'pending';
  return 'disconnected';
}

function ConnectInstagramForm({ onSuccess }: { onSuccess: () => void }) {
  const [pageId, setPageId] = useState('');
  const [token, setToken] = useState('');
  const [accountName, setAccountName] = useState('');
  const [error, setError] = useState('');

  const connect = useMutation({
    mutationFn: () =>
      api.post('/connections/instagram', { pageId, accessToken: token, accountName }),
    onSuccess: () => {
      setPageId('');
      setToken('');
      setAccountName('');
      onSuccess();
    },
    onError: () => setError('Failed to connect — check the page ID and token'),
  });

  return (
    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
      <p className="text-sm font-medium text-gray-700">Connect Instagram account</p>
      <Input
        label="Instagram Page ID"
        value={pageId}
        onChange={(e) => setPageId(e.target.value)}
        placeholder="e.g. 123456789"
      />
      <Input
        label="Page Access Token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="EAABwzLix…"
        type="password"
      />
      <Input
        label="Account name (optional)"
        value={accountName}
        onChange={(e) => setAccountName(e.target.value)}
        placeholder="e.g. My Store"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => connect.mutate()}
          loading={connect.isPending}
          disabled={!pageId || !token}
        >
          Connect
        </Button>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [showConnectForm, setShowConnectForm] = useState(false);

  const { data, isLoading } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api.post(`/connections/${id}/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const hasInstagram = data.some(
    (c) => c.type === 'instagram' && c.status === 'connected',
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Connections</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your integrations</p>
        </div>
        {!hasInstagram && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowConnectForm((v) => !v)}
          >
            <Instagram className="h-4 w-4" />
            Connect Instagram
          </Button>
        )}
      </div>

      {showConnectForm && (
        <ConnectInstagramForm
          onSuccess={() => {
            setShowConnectForm(false);
            qc.invalidateQueries({ queryKey: ['connections'] });
          }}
        />
      )}

      {isLoading ? (
        <LoadingState />
      ) : (
        <Card padding={false}>
          {data.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No connections"
              description="Connect your Instagram account to get started"
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {data.map((conn) => (
                <div key={conn.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Instagram className="h-4 w-4 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 capitalize">
                        {conn.metadata?.accountName ?? conn.type}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {conn.externalAccountId
                          ? `ID: ${conn.externalAccountId}`
                          : conn.type}
                        {conn.lastSyncAt
                          ? ` · Last sync: ${new Date(conn.lastSyncAt).toLocaleString()}`
                          : ' · Never synced'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant(conn.status)}>{conn.status}</Badge>
                    {conn.status === 'connected' && (
                      <button
                        onClick={() => disconnect.mutate(conn.id)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                      >
                        Disconnect
                      </button>
                    )}
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
