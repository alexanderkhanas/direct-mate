import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle, ExternalLink, Trash2, Telegram } from '../icons';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';

/** Link the Telegram chats that get handoff notifications. Used on Connections and in setup. */
export function TelegramConnectSection() {
  const { t } = useT();
  const [polling, setPolling] = useState(false);
  const [deepLink, setDeepLink] = useState('');
  const [error, setError] = useState('');

  const { data: status, refetch } = useQuery<{ connected: boolean; chatIds: string[] }>({
    queryKey: ['telegram-status'],
    queryFn: () => api.get('/connections/telegram/status').then(r => r.data),
    refetchInterval: polling ? 3000 : false,
  });

  const connect = useMutation({
    mutationFn: () => api.post('/connections/telegram/connect'),
    onSuccess: (res: any) => {
      setDeepLink(res.data.deepLink);
      setPolling(true);
      setError('');
    },
    onError: () => setError(t('connections_ext.failed_generate_link')),
  });

  useEffect(() => {
    if (status?.connected && polling) {
      setPolling(false);
      setDeepLink('');
    }
  }, [status?.connected, polling]);

  const removeTg = useMutation({
    mutationFn: (chatId: string) => api.delete(`/connections/telegram/${chatId}`),
    onSuccess: () => refetch(),
  });

  if (status?.connected) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[#26A5E4]/10 flex items-center justify-center">
              <Telegram className="h-6 w-6 text-[#26A5E4]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{t('connections.telegram')}</p>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-xs text-gray-400">{status.chatIds.length} {status.chatIds.length === 1 ? t('connections_ext.connection') : t('connections_ext.connections_count')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="connected">{t('connections.connected')}</Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => connect.mutate()}
              loading={connect.isPending}
            >
              + {t('common.add')}
            </Button>
          </div>
        </div>
        {status.chatIds.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            {status.chatIds.map((id: string) => (
              <div key={id} className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-500 font-mono">Chat ID: {id}</span>
                <button
                  onClick={() => {
                    if (confirm(t('connections_ext.remove_connection', { name: `Telegram ${id}` }))) {
                      removeTg.mutate(id);
                    }
                  }}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // Show deep link if just generated while already connected
  if (deepLink) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[#26A5E4]/10 flex items-center justify-center">
              <Telegram className="h-6 w-6 text-[#26A5E4]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900">{t('connections.telegram')}</p>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-xs text-gray-400">{status?.chatIds?.length ?? 0} {t('connections_ext.connections_count')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {polling && <span className="text-xs text-gray-400 animate-pulse">{t('connections_ext.waiting')}</span>}
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              {t('connections_ext.open_telegram')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#26A5E4]/10 flex items-center justify-center">
            <Telegram className="h-6 w-6 text-[#26A5E4]" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{t('connections.telegram')}</p>
            <p className="text-xs text-gray-400">{t('connections_ext.manager_notifications')}</p>
          </div>
        </div>
        {!deepLink ? (
          <Button
            size="sm"
            onClick={() => connect.mutate()}
            loading={connect.isPending}
          >
            {t('connections_ext.link_telegram')}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {polling && (
              <span className="text-xs text-gray-400 animate-pulse">{t('connections_ext.waiting_for_connection')}</span>
            )}
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              {t('connections_ext.open_telegram')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </Card>
  );
}
