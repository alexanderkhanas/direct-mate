import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import type { ProductRow } from '../types';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../lib/cn';
import { useT } from '../i18n';

function freshnessVariant(lastSyncedAt: string | null): 'success' | 'handoff' | 'error' {
  if (!lastSyncedAt) return 'error';
  const ageMinutes = (Date.now() - new Date(lastSyncedAt).getTime()) / 60_000;
  if (ageMinutes < 10) return 'success';
  if (ageMinutes < 60) return 'handoff';
  return 'error';
}

const freshnessColors = {
  success: 'bg-emerald-400',
  handoff: 'bg-amber-400',
  error: 'bg-red-400',
};

function ProductRow({ product }: { product: ProductRow }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  function freshnessLabel(lastSyncedAt: string | null): string {
    if (!lastSyncedAt) return t('catalog.never');
    const ageMinutes = Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60_000);
    if (ageMinutes < 1) return t('catalog.just_now');
    if (ageMinutes < 60) return t('catalog.minutes_ago', { count: ageMinutes });
    const hours = Math.round(ageMinutes / 60);
    return t('catalog.hours_ago', { count: hours });
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
          )}
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.title}
              className="h-10 w-10 rounded-lg object-cover shrink-0 bg-gray-100"
            />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
              <Package className="h-4 w-4 text-gray-300" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">{product.title}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {product.sku && <span className="font-mono text-gray-500">{product.sku}</span>}
              {product.sku && ' · '}
              {product.category ?? t('catalog.uncategorized')} · {product.variantCount}{' '}
              {product.variantCount !== 1 ? t('catalog.variants_plural') : t('catalog.variants')}
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          {t('catalog_ext.updated_date')}{' '}
          {new Date(product.lastSyncedAt ?? product.updatedAt).toLocaleDateString()}
        </p>
      </button>

      {expanded && (
        <div className="px-5 pb-4">
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 text-left font-medium w-12"></th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('catalog.sku')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('catalog.size')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('catalog.color')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('catalog.price')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('catalog.stock')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('catalog.freshness')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {product.variants.map((v) => {
                  const variant = freshnessVariant(v.lastSyncedAt);
                  return (
                    <tr key={v.id} className="bg-white">
                      <td className="px-4 py-2.5">
                        {v.imageUrl ? (
                          <img src={v.imageUrl} alt="" className="h-8 w-8 rounded object-cover bg-gray-100" />
                        ) : (
                          <div className="h-8 w-8 rounded bg-gray-50" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{v.sku ?? '\u2014'}</td>
                      <td className="px-4 py-2.5 text-gray-700">{v.size ?? '\u2014'}</td>
                      <td className="px-4 py-2.5 text-gray-700 capitalize">{v.color ?? '\u2014'}</td>
                      <td className="px-4 py-2.5 text-gray-700">
                        {v.price} {v.currency}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'font-semibold',
                            v.effectiveAvailable > 0 ? 'text-gray-900' : 'text-red-500',
                          )}
                        >
                          {v.effectiveAvailable}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div
                            className={cn(
                              'h-2 w-2 rounded-full',
                              freshnessColors[variant],
                            )}
                          />
                          <span className="text-xs text-gray-500">
                            {freshnessLabel(v.lastSyncedAt)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalogPage() {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery<ProductRow[]>({
    queryKey: ['products', q],
    queryFn: () =>
      api.get(`/products${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('catalog.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('catalog.subtitle')}</p>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder={t('catalog.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setQ(search)}
          className="max-w-xs"
        />
        <button
          onClick={() => setQ(search)}
          className="text-sm px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
        >
          {t('common.search')}
        </button>
        {q && (
          <button
            onClick={() => { setSearch(''); setQ(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            {t('common.clear')}
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : (
        <Card padding={false}>
          {data && data.length > 0 ? (
            data.map((product) => <ProductRow key={product.id} product={product} />)
          ) : (
            <EmptyState
              icon={Package}
              title={t('catalog.no_products')}
              description={t('catalog.no_products_desc')}
            />
          )}
        </Card>
      )}
    </div>
  );
}
