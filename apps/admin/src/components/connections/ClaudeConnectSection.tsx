import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Sparkles, Trash2 } from '../icons';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useT } from '../../i18n';
import { useConnector } from '../../pages/claude/SetupWithClaudePage';

interface Grant {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

/**
 * Claude's access to this store (the MCP connector): who was allowed, when it
 * was last used, and a way to take it back. Hidden while the connector is off.
 */
export function ClaudeConnectSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const connector = useConnector();
  const enabled = connector.data?.enabled === true;

  const grants = useQuery<Grant[]>({
    queryKey: ['claude-grants'],
    queryFn: () => api.get<Grant[]>('/claude/grants').then((r) => r.data),
    enabled,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/claude/grants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['claude-grants'] }),
  });

  if (!enabled) return null;
  const list = grants.data ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-orange-50 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900">{t('setup_claude.card_title')}</p>
              {list.length > 0 && <CheckCircle className="h-4 w-4 text-green-500" />}
            </div>
            {list.length === 0 && <p className="text-xs text-gray-400">{t('setup_claude.card_none')}</p>}
          </div>
        </div>
        {list.length > 0 ? (
          <Badge variant="connected">{t('connections.connected')}</Badge>
        ) : (
          <Link
            to="/claude"
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            {t('setup_claude.card_how')}
          </Link>
        )}
      </div>
      {list.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
          {list.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">{g.clientName}</span>
                {' · '}
                {t('setup_claude.card_since', { date: day(g.createdAt) })}
                {g.lastUsedAt && ` · ${t('setup_claude.card_last_used', { date: day(g.lastUsedAt) })}`}
              </span>
              <button
                onClick={() => {
                  if (confirm(t('setup_claude.card_revoke_confirm', { client: g.clientName }))) revoke.mutate(g.id);
                }}
                disabled={revoke.isPending}
                className="text-gray-300 hover:text-red-500 transition-colors"
                aria-label={t('setup_claude.card_revoke')}
                title={t('setup_claude.card_revoke')}
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
