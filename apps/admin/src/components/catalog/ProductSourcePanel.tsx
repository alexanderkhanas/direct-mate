import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Download, Link2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { useT } from '../../i18n';

// Mirrors apps/api/src/modules/catalog-feeds/feed-sync.service.ts.
interface FeedWarning {
  code: string;
  count: number;
  examples?: string[];
}

interface FeedPreview {
  format: 'gmc' | 'yml' | 'sheet';
  products: number;
  variants: number;
  inStock: number;
  sample: Array<{
    title: string;
    category: string | null;
    price: number;
    currency: string;
    colors: string[];
    sizes: string[];
    image: string | null;
    inStock: boolean;
  }>;
  warnings: FeedWarning[];
}

interface FeedStatus {
  feed: {
    id: string;
    url: string;
    format: FeedPreview['format'] | null;
    status: 'connected' | 'error' | 'disconnected' | 'pending';
    lastSyncAt: string | null;
    products: number | null;
    warnings: FeedWarning[];
    lastError: { code: string; message: string } | null;
  } | null;
}

/** Google Sheet template; a CSV of it ships with the admin for owners who'd rather copy columns. */
const SHEET_TEMPLATE_URL = import.meta.env.VITE_SHEET_TEMPLATE_URL as string | undefined;

/** API errors arrive as `{ error: { code, message, details } }` (AllExceptionsFilter). */
function feedErrorCode(error: unknown): string {
  const err = (error as any)?.response?.data?.error;
  if (err?.details?.code) return err.details.code;
  return err?.code === 'VALIDATION_ERROR' ? 'invalid_url' : 'unreachable';
}

/**
 * Where the store's products come from: a feed link (Google Merchant, Prom,
 * Rozetka, Horoshop) or the Google Sheet template, previewed before import
 * and re-synced hourly afterwards. Used on the Catalog page and in setup.
 */
export function ProductSourcePanel({ onImported }: { onImported?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);

  const { data: status } = useQuery<FeedStatus>({
    queryKey: ['catalog-feed'],
    queryFn: () => api.get('/catalog/feeds').then((r) => r.data),
  });

  const preview = useMutation<FeedPreview>({
    mutationFn: () => api.post('/catalog/feeds/preview', { url }).then((r) => r.data),
  });
  const connect = useMutation({
    mutationFn: () => api.post('/catalog/feeds', { url }).then((r) => r.data),
    onSuccess: () => {
      setEditing(false);
      preview.reset();
      qc.invalidateQueries({ queryKey: ['catalog-feed'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onImported?.();
    },
  });
  const resync = useMutation({
    mutationFn: (id: string) => api.post(`/catalog/feeds/${id}/sync`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog-feed'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const feed = status?.feed;
  if (feed && !editing) {
    return (
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">{t('feeds.connected_title')}</h2>
              <Badge variant={feed.status === 'connected' ? 'connected' : 'error'}>
                {t(`feeds.format_${feed.format ?? 'unknown'}`)}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-1 truncate">{feed.url}</p>
            <p className="text-xs text-gray-500 mt-1">
              {feed.products !== null && t('feeds.products_count', { count: feed.products })}
              {feed.lastSyncAt && ` · ${t('feeds.synced_at', { date: new Date(feed.lastSyncAt).toLocaleString() })}`}
              {` · ${t('feeds.hourly')}`}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="secondary" loading={resync.isPending} onClick={() => resync.mutate(feed.id)}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('feeds.sync_now')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setUrl(feed.url); setEditing(true); }}>
              {t('feeds.change_link')}
            </Button>
          </div>
        </div>
        {feed.lastError && (
          <p className="text-xs text-red-600 mt-3 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {t(`feeds.error_${feed.lastError.code}`)}
          </p>
        )}
        <Warnings warnings={feed.warnings} />
      </Card>
    );
  }

  const p = preview.data;
  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900">{t('feeds.title')}</h2>
      <p className="text-xs text-gray-500 mt-1 mb-4">{t('feeds.subtitle')}</p>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => { setUrl(e.target.value); preview.reset(); }}
          placeholder="https://…/feed.xml"
          className="flex-1"
        />
        <Button onClick={() => preview.mutate()} loading={preview.isPending} disabled={!url.trim()}>
          <Link2 className="h-4 w-4" />
          {t('feeds.preview')}
        </Button>
      </div>
      {preview.isError && (
        <p className="text-xs text-red-600 mt-2">{t(`feeds.error_${feedErrorCode(preview.error)}`)}</p>
      )}

      <div className="mt-3 space-y-1 text-xs text-gray-500">
        <p>{t('feeds.hint_website')}</p>
        <p>
          {t('feeds.hint_sheet')}{' '}
          {SHEET_TEMPLATE_URL && (
            <a href={SHEET_TEMPLATE_URL} target="_blank" rel="noreferrer" className="text-gray-900 underline">
              {t('feeds.sheet_template')}
            </a>
          )}{' '}
          <a href="/templates/directmate-products.csv" download className="inline-flex items-center gap-1 text-gray-900 underline">
            <Download className="h-3 w-3" />
            {t('feeds.sheet_csv')}
          </a>
        </p>
        <p>
          {t('feeds.hint_shopify')}{' '}
          <Link to="/connections" className="text-gray-900 underline">{t('feeds.shopify_link')}</Link>
        </p>
      </div>

      {p && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-900">
            <Check className="inline h-4 w-4 text-emerald-600 mr-1" />
            {t('feeds.found', { products: p.products, variants: p.variants, inStock: p.inStock })}
            <span className="text-gray-400"> · {t(`feeds.format_${p.format}`)}</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
            {p.sample.map((s) => (
              <div key={s.title} className="rounded-lg border border-gray-100 p-2">
                {s.image ? (
                  <img src={s.image} alt="" className="h-28 w-full object-cover rounded-md bg-gray-100" />
                ) : (
                  <div className="h-28 w-full rounded-md bg-gray-100" />
                )}
                <p className="text-xs font-medium text-gray-900 mt-2 line-clamp-2">{s.title}</p>
                <p className="text-xs text-gray-500">
                  {s.price} {s.currency === 'UAH' ? 'грн' : s.currency}
                  {!s.inStock && <span className="text-red-500"> · {t('feeds.out_of_stock')}</span>}
                </p>
                {s.colors.length > 0 && <p className="text-[11px] text-gray-400 truncate">{s.colors.join(', ')}</p>}
                {s.sizes.length > 0 && <p className="text-[11px] text-gray-400 truncate">{s.sizes.join(', ')}</p>}
              </div>
            ))}
          </div>
          <Warnings warnings={p.warnings} />
          <div className="flex items-center gap-3 mt-4">
            <Button onClick={() => connect.mutate()} loading={connect.isPending}>
              {t('feeds.import')}
            </Button>
            {feed && (
              <Button variant="ghost" onClick={() => { setEditing(false); preview.reset(); }}>
                {t('common.cancel')}
              </Button>
            )}
            {connect.isError && (
              <span className="text-xs text-red-600">{t(`feeds.error_${feedErrorCode(connect.error)}`)}</span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Warnings({ warnings }: { warnings: FeedWarning[] }) {
  const { t } = useT();
  if (warnings.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1">
      {warnings.map((w) => (
        <li key={w.code} className="text-xs text-amber-700 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t(`feeds.warning_${w.code}`, { count: w.count })}
            {w.examples && w.examples.length > 0 && (
              <span className="text-amber-600/70"> — {w.examples.slice(0, 3).join(', ')}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
