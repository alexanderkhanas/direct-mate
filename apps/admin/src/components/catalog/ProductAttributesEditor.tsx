import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import type { ProductRow } from '../../types';
import { Badge, Button, Input, Select } from '../ui';
import { useT } from '../../i18n';

interface AttributeOption {
  key: string;
  label: string;
  /** null for free text (colour). */
  values: string[] | null;
}

/**
 * How a product looks — the attributes the bot reads when it recommends
 * products. Read from the main photo by AI; any of them can be corrected here,
 * and a corrected one is never overwritten by the next automatic read.
 */
export function ProductAttributesEditor({ product }: { product: ProductRow }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { data: options } = useQuery<AttributeOption[]>({
    queryKey: ['attribute-options'],
    queryFn: () => api.get('/products/attribute-options').then((r) => r.data),
    staleTime: Infinity,
  });

  const [draft, setDraft] = useState<Record<string, string>>(product.attributes);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(product.attributes), [product.attributes]);

  const changed = useMemo(
    () => (options ?? []).map((o) => o.key).filter((k) => (draft[k] ?? '') !== (product.attributes[k] ?? '')),
    [draft, product.attributes, options],
  );

  const onError = (err: any) =>
    setError(err?.response?.data?.error?.message ?? err?.response?.data?.message ?? err?.message ?? 'Request failed');
  const onSuccess = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/products/${product.id}/attributes`, {
        attributes: Object.fromEntries(changed.map((k) => [k, draft[k]?.trim() || null])),
      }),
    onSuccess,
    onError,
  });
  const reread = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/attributes/extract`, { overwriteManual: true }),
    onSuccess,
    onError,
  });

  const hasEdits = Object.values(product.attributeSources).includes('manual');
  const status = product.attributesExtractedAt
    ? t('catalog_ext.look_read_at', { date: new Date(product.attributesExtractedAt).toLocaleString() })
    : t('catalog_ext.look_not_read');

  function rereadFromPhoto() {
    if (hasEdits && !window.confirm(t('catalog_ext.reread_confirm'))) return;
    reread.mutate();
  }

  if (!options) return null;

  return (
    <div className="rounded-lg border border-gray-100 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{t('catalog_ext.look_title')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('catalog_ext.look_hint')}</p>
        </div>
        <span className="text-xs text-gray-400">{status}</span>
      </div>

      {product.attributesError && !product.attributesExtractedAt && (
        <p className="text-xs text-red-600">{t('catalog_ext.look_error', { error: product.attributesError })}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {options.map((o) => {
          const id = `attr-${product.id}-${o.key}`;
          const source = product.attributeSources[o.key];
          return (
            <div key={o.key} className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-xs font-medium text-gray-600">
                  {t(`catalog_ext.attr_${o.key}`)}
                </label>
                {source && (
                  <Badge variant={source === 'manual' ? 'pending' : 'default'}>
                    {source === 'manual' ? t('catalog_ext.source_manual') : t('catalog_ext.source_ai')}
                  </Badge>
                )}
              </div>
              {o.values ? (
                <Select
                  id={id}
                  value={draft[o.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [o.key]: e.target.value }))}
                >
                  <option value="">—</option>
                  {o.values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={id}
                  value={draft[o.key] ?? ''}
                  maxLength={40}
                  onChange={(e) => setDraft((d) => ({ ...d, [o.key]: e.target.value }))}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={changed.length === 0} loading={save.isPending} onClick={() => save.mutate()}>
          {t('catalog_ext.save')}
        </Button>
        <Button size="sm" variant="secondary" loading={reread.isPending} onClick={rereadFromPhoto}>
          {!reread.isPending && <RefreshCw className="h-3.5 w-3.5" />}
          {reread.isPending ? t('catalog_ext.reading') : t('catalog_ext.reread')}
        </Button>
      </div>
    </div>
  );
}
