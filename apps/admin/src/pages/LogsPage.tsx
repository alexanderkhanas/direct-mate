import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { AuditLog } from '../types';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { useT } from '../i18n';

export default function LogsPage() {
  const { t } = useT();
  const [conversationId, setConversationId] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading } = useQuery<{ items: AuditLog[] }>({
    queryKey: ['logs', submitted],
    queryFn: () =>
      api.get(`/logs/conversation/${submitted}`).then((r) => ({
        items: r.data.items ?? r.data,
      })),
    enabled: !!submitted,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('logs.audit_logs')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('logs.view_by_conversation')}</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={conversationId}
          onChange={(e) => setConversationId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSubmitted(conversationId)}
          placeholder={t('logs.paste_conversation_id')}
          className="flex-1"
        />
        <Button onClick={() => setSubmitted(conversationId)} disabled={!conversationId}>
          {t('logs.load_logs')}
        </Button>
      </div>

      {isLoading && <LoadingState />}

      {data && (
        <Card padding={false}>
          {data.items.length === 0 ? (
            <EmptyState icon={ScrollText} title={t('logs.no_logs')} description={t('logs.no_events')} />
          ) : (
            <div className="divide-y divide-gray-100">
              {data.items.map((log) => (
                <div key={log.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {log.type.replace(/_/g, ' ')}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={log.status === 'success' ? 'success' : 'error'}>
                        {log.status}
                      </Badge>
                      <span className="text-xs text-gray-400">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {log.details && (
                    <pre className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
