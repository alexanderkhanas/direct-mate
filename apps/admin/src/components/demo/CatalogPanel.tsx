import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { publicApi } from '../../lib/publicApi';

interface CatalogProduct {
  id: string;
  title: string;
  category: string | null;
  imageUrl: string | null;
  priceFrom: number | null;
  currency: string;
  colors: string[];
  sizes: string[];
}

interface CatalogResponse {
  products: CatalogProduct[];
}

interface CatalogPanelProps {
  tenantSlug: string;
  onClose: () => void;
}

const catalogCache = new Map<string, CatalogProduct[]>();

const formatPrice = (n: number | null, currency: string): string => {
  if (n == null) return '';
  const symbol = currency === 'UAH' ? 'грн' : currency;
  return `від ${Math.round(n)} ${symbol}`;
};

export function CatalogPanel({ tenantSlug, onClose }: CatalogPanelProps) {
  const [products, setProducts] = useState<CatalogProduct[] | null>(
    catalogCache.get(tenantSlug) ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (catalogCache.has(tenantSlug)) {
      setProducts(catalogCache.get(tenantSlug)!);
      return;
    }
    let cancelled = false;
    setError(null);
    publicApi
      .get<CatalogResponse>('/demo/catalog', { params: { tenantSlug } })
      .then(({ data }) => {
        if (cancelled) return;
        catalogCache.set(tenantSlug, data.products);
        setProducts(data.products);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Не вдалось завантажити каталог');
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Каталог товарів"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-white w-full max-w-[640px] max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Каталог товарів</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрити каталог"
          className="text-gray-400 hover:text-gray-900 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3">
        {error && (
          <p className="text-xs text-red-500 text-center py-6">{error}</p>
        )}
        {!error && products === null && (
          <p className="text-xs text-gray-400 text-center py-6">Завантаження…</p>
        )}
        {!error && products && products.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">Товарів немає</p>
        )}
        {!error && products && products.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            {products.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-gray-100 overflow-hidden bg-white"
              >
                <div className="aspect-[3/4] bg-gray-50">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <div className="px-2.5 py-2 space-y-1">
                  <p className="text-[12px] font-medium text-gray-900 leading-tight line-clamp-2">
                    {p.title}
                  </p>
                  {p.priceFrom != null && (
                    <p className="text-[11px] text-gray-500">
                      {formatPrice(p.priceFrom, p.currency)}
                    </p>
                  )}
                  {(p.colors.length > 0 || p.sizes.length > 0) && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {p.colors.slice(0, 3).map((c) => (
                        <span
                          key={`c-${c}`}
                          className="text-[10px] text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5"
                        >
                          {c}
                        </span>
                      ))}
                      {p.sizes.slice(0, 4).map((s) => (
                        <span
                          key={`s-${s}`}
                          className="text-[10px] text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
