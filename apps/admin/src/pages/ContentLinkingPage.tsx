import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Link2, Trash2, RefreshCw, Check, Image, Film, LayoutGrid, ExternalLink, Search, X, Package, Plus, Sparkles } from '../components/icons';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { useT } from '../i18n';

type LinkSource = 'manual' | 'caption_sku' | 'same_image' | 'conversation' | 'vision';

/** A product the content shows (`content_products`). Rejected ones never come back from the API. */
interface ContentProduct {
  id: string;
  productId: string;
  title: string;
  color: string | null;
  source: LinkSource;
  status: 'suggested' | 'confirmed';
  confidence: number | null;
  evidence: { picks?: Array<{ conversationId: string; orderId?: string }>; reason?: string };
  imageUrl: string | null;
}

interface ContentItem {
  id: string;
  instagramMediaId: string;
  mediaType: string;
  mediaProductType: string | null;
  caption: string | null;
  imageUrl: string | null;
  permalink: string | null;
  createdAt: string;
  products: ContentProduct[];
}

type Filter = 'review' | 'unlinked' | 'linked' | 'all';
type Counts = Record<Filter, number>;

const PAGE_SIZE = 50;

interface Product {
  id: string;
  title: string;
  category: string | null;
  sku: string | null;
  imageUrl: string | null;
  variants?: Array<{ id: string; color: string | null; size: string | null }>;
}

function MediaTypeIcon({ type }: { type: string }) {
  if (type === 'video') return <Film className="h-4 w-4 text-purple-500" />;
  if (type === 'carousel_album') return <LayoutGrid className="h-4 w-4 text-blue-500" />;
  return <Image className="h-4 w-4 text-pink-500" />;
}

/** «Сторіс», «Рілс», «Допис»… from Meta's type and product type. */
function typeLabel(item: Pick<ContentItem, 'mediaType' | 'mediaProductType'>, t: (key: string) => string): string {
  if (item.mediaProductType === 'REELS') return t('content.type_reel');
  if (item.mediaType === 'story' || item.mediaType === 'story_reply') return t('content.type_story');
  if (item.mediaType === 'video') return t('content.type_video');
  if (item.mediaType === 'carousel_album') return t('content.type_carousel');
  if (item.mediaType === 'highlight') return t('content.type_highlight');
  return t('content.type_post');
}

/** Ukrainian plural form; the English dictionary gives «few» the same text as «many». */
function plural(n: number): 'one' | 'few' | 'many' {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return 'one';
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'few';
  return 'many';
}

/** «Обрали клієнти · 3 клієнти обрали, 2 замовили», «Перевірка AI-агентом · 90 %». */
function evidenceText(link: ContentProduct, t: (key: string, params?: Record<string, string | number>) => string): string {
  const parts = [t(`content.source_${link.source}`)];
  const picks = link.evidence.picks ?? [];
  if (link.source === 'conversation' && picks.length > 0) {
    const orders = picks.filter((p) => p.orderId).length;
    let text = t(`content.evidence_picks_${plural(picks.length)}`, { n: picks.length });
    if (orders > 0) text += `, ${t(`content.evidence_orders_${plural(orders)}`, { n: orders })}`;
    parts.push(text);
  }
  if (link.source === 'vision' && link.confidence != null) parts.push(`${Math.round(link.confidence * 100)} %`);
  return parts.join(' · ');
}

function ProductThumb({ url, className }: { url: string | null; className: string }) {
  return url ? (
    <img src={url} alt="" className={`${className} object-cover`} />
  ) : (
    <div className={`${className} flex items-center justify-center bg-gray-100`}>
      <Package className="h-4 w-4 text-gray-300" />
    </div>
  );
}

function ProductLinkModal({ products, caption, onSelect, onClose }: {
  products: Product[];
  caption: string | null;
  onSelect: (product: Product, linkedColor: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Product | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const distinctColors = picked
    ? Array.from(
        new Set(
          (picked.variants ?? [])
            .map((v) => v.color)
            .filter((c): c is string => !!c),
        ),
      )
    : [];

  const handlePick = (product: Product) => {
    // No colors available → commit as product-level link immediately.
    const colorsAvail = (product.variants ?? []).some((v) => !!v.color);
    if (!colorsAvail) {
      onSelect(product, null);
      return;
    }
    setPicked(product);
  };

  const q = search.toLowerCase();
  const filtered = products.filter(p =>
    p.title.toLowerCase().includes(q) ||
    (p.sku ?? '').toLowerCase().includes(q) ||
    (p.category ?? '').toLowerCase().includes(q)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 overflow-hidden flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">{t('content.link_product')}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          {caption && (
            <p className="text-xs text-gray-500 line-clamp-2 mb-3 bg-gray-50 rounded-lg px-3 py-2">
              {caption}
            </p>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('content.search_product')}
              className="w-full pl-9 pr-9 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-2.5 text-gray-300 hover:text-gray-500">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto p-4">
          {picked ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-3">
                <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {picked.imageUrl ? (
                    <img src={picked.imageUrl} alt={picked.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Package className="h-6 w-6 text-gray-300" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{picked.title}</p>
                  {picked.category && <p className="truncate text-xs text-gray-400">{picked.category}</p>}
                </div>
                <button
                  onClick={() => setPicked(null)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {t('content.change')}
                </button>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">{t('content.pick_color')}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onSelect(picked, null)}
                    className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 hover:border-blue-400"
                  >
                    {t('content.all_colors')}
                  </button>
                  {distinctColors.map((color) => (
                    <button
                      key={color}
                      onClick={() => onSelect(picked, color)}
                      className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 hover:border-blue-400 hover:bg-blue-50"
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">{t('content.no_products_found')}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.map(p => {
                const imgUrl = p.imageUrl;
                return (
                  <button
                    key={p.id}
                    onClick={() => handlePick(p)}
                    className="group text-left rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all overflow-hidden bg-white"
                  >
                    <div className="aspect-square bg-gray-100 overflow-hidden">
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={p.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="h-8 w-8 text-gray-300" />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs font-medium text-gray-900 line-clamp-2 leading-snug">{p.title}</p>
                      {p.category && (
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate">{p.category}</p>
                      )}
                      {p.sku && (
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">SKU: {p.sku}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ContentLinkingPage() {
  const { t } = useT();
  const qc = useQueryClient();
  // Null until the owner picks a tab: then «Перевірити» when there is something to check.
  const [chosen, setChosen] = useState<Filter | null>(null);
  const [offset, setOffset] = useState(0);
  const [linkingItem, setLinkingItem] = useState<ContentItem | null>(null);
  const [showAddManual, setShowAddManual] = useState(false);
  const [detail, setDetail] = useState<ContentItem | null>(null);

  const { data: counts } = useQuery<Counts>({
    queryKey: ['content-linking', 'counts'],
    queryFn: () => api.get('/instagram/media-mappings?limit=1').then((r) => r.data.counts),
  });
  const filter: Filter = chosen ?? (counts && counts.review > 0 ? 'review' : 'all');

  const { data, isLoading } = useQuery<{ items: ContentItem[]; total: number; counts: Counts }>({
    queryKey: ['content-linking', filter, offset],
    queryFn: () =>
      api
        .get('/instagram/media-mappings', {
          params: { ...(filter !== 'all' && { filter }), limit: PAGE_SIZE, offset },
        })
        .then((r) => r.data),
    enabled: chosen !== null || counts !== undefined,
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ['products-list'],
    queryFn: () => api.get('/products').then(r => {
      const result = r.data;
      return Array.isArray(result) ? result : result.items ?? [];
    }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['content-linking'] });

  // The open detail follows the list, so a change shows there too.
  useEffect(() => {
    if (!detail) return;
    const fresh = data?.items.find((i) => i.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [data, detail]);

  const fetchContent = useMutation({
    mutationFn: () => api.post('/instagram/media-mappings/fetch'),
    onSuccess: (res: { data: { fetched: number; matched: number } }) => {
      refresh();
      const { fetched, matched } = res.data;
      alert(matched > 0 ? t('content.fetched_matched', { n: fetched, m: matched }) : t('content.fetched', { n: fetched }));
    },
    onError: () => alert(t('content.fetch_failed')),
  });

  const linkProduct = useMutation({
    mutationFn: ({ item, product, color }: { item: ContentItem; product: Product; color: string | null }) =>
      api.post(`/instagram/media-mappings/${item.id}/products`, { productId: product.id, color }).then((r) => r.data as { id: string }),
    onSuccess: ({ id }, { item, product, color }) => {
      // Shown at once in the open detail; the list catches up on refetch.
      if (detail?.id === item.id) {
        const others = detail.products.filter((p) => p.id !== id);
        setDetail({
          ...detail,
          products: [
            { id, productId: product.id, title: product.title, color, source: 'manual', status: 'confirmed', confidence: null, evidence: {}, imageUrl: product.imageUrl },
            ...others,
          ],
        });
      }
      refresh();
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ item, link, status }: { item: ContentItem; link: ContentProduct; status: 'confirmed' | 'rejected' }) =>
      api.patch(`/instagram/media-mappings/${item.id}/products/${link.id}`, { status }),
    onSuccess: (_res, { item, link, status }) => {
      if (detail?.id === item.id) {
        setDetail({
          ...detail,
          products:
            status === 'rejected'
              ? detail.products.filter((p) => p.id !== link.id)
              : detail.products.map((p) => (p.id === link.id ? { ...p, status: 'confirmed' } : p)),
        });
      }
      refresh();
    },
  });

  const addManual = useMutation({
    mutationFn: (body: { instagramMediaId: string; mediaType?: string; caption?: string; productId?: string }) =>
      api.post('/instagram/media-mappings', body),
    onSuccess: () => {
      refresh();
      setShowAddManual(false);
    },
  });

  const parseLink = useMutation({
    mutationFn: (url: string) => api.post('/instagram/media-mappings/parse-link', { url }).then(r => r.data),
  });

  const deleteMapping = useMutation({
    mutationFn: (id: string) => api.delete(`/instagram/media-mappings/${id}`),
    onSuccess: () => refresh(),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const productList = products ?? [];
  const shownCounts = data?.counts ?? counts;

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: 'review', label: t('content.tab_review') },
    { key: 'unlinked', label: t('content.tab_unlinked') },
    { key: 'linked', label: t('content.tab_linked') },
    { key: 'all', label: t('content.tab_all') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('content.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('content.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowAddManual(true)}>
            <Plus className="h-4 w-4" />
            {t('content.add_manually')}
          </Button>
          <Button onClick={() => fetchContent.mutate()} loading={fetchContent.isPending}>
            <RefreshCw className="h-4 w-4" />
            {t('content.fetch_content')}
          </Button>
        </div>
      </div>

      <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 w-fit">
        {tabs.map((tab) => {
          const n = shownCounts?.[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => {
                setChosen(tab.key);
                setOffset(0);
              }}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {n != null && n > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    tab.key === 'review' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filter === 'review' && items.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-gray-600">
          <Sparkles className="mt-0.5 h-4 w-4 flex-none text-violet-500" />
          {t('content.review_hint')}
        </p>
      )}

      {isLoading || !data ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={ImagePlus}
            title={filter === 'review' ? t('content.empty_review') : t('content.empty_title')}
            description={filter === 'review' ? '' : t('content.empty_text')}
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {items.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetail(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setDetail(item);
              }}
              className="flex cursor-pointer flex-col gap-3 px-4 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:px-5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <MediaTypeIcon type={item.mediaType} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-gray-900">
                    {item.caption || <span className="text-gray-400">{t('content.no_caption')}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {typeLabel(item, t)} · {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:max-w-[45%] sm:justify-end">
                {item.products.length > 0 ? (
                  item.products.map((p) => (
                    <span
                      key={p.id}
                      className={`flex max-w-[220px] items-center gap-1.5 rounded-md py-1 pl-1 pr-2 text-xs font-medium ${
                        p.status === 'confirmed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      <ProductThumb url={p.imageUrl} className="h-5 w-5 flex-none rounded" />
                      <span className="truncate">
                        {p.title}
                        {p.color ? `, ${p.color}` : ''}
                      </span>
                      {p.status === 'suggested' && <span className="flex-none text-amber-600">· {t('content.status_suggested')}</span>}
                    </span>
                  ))
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLinkingItem(item);
                    }}
                    className="flex items-center gap-1 rounded-md border border-blue-200 px-2.5 py-1 text-xs text-blue-600 transition-colors hover:border-blue-400 hover:bg-blue-50"
                  >
                    <Link2 className="h-3 w-3" />
                    {t('content.link_product')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {t('content.page_range', { from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              {t('content.prev')}
            </Button>
            <Button variant="secondary" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              {t('content.next')}
            </Button>
          </div>
        </div>
      )}

      {linkingItem && (
        <ProductLinkModal
          products={productList}
          caption={linkingItem.caption}
          onSelect={(product, color) => {
            linkProduct.mutate({ item: linkingItem, product, color });
            setLinkingItem(null);
          }}
          onClose={() => setLinkingItem(null)}
        />
      )}

      {detail && !linkingItem && (
        <ContentDetailModal
          item={detail}
          busy={setStatus.isPending || linkProduct.isPending}
          onAdd={() => setLinkingItem(detail)}
          onStatus={(link, status) => setStatus.mutate({ item: detail, link, status })}
          onDelete={() => {
            if (confirm(t('content.delete_confirm'))) {
              deleteMapping.mutate(detail.id);
              setDetail(null);
            }
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {showAddManual && (
        <AddManualModal
          products={productList}
          onAdd={(body) => addManual.mutate(body)}
          onParseLink={(url) => parseLink.mutateAsync(url)}
          loading={addManual.isPending}
          onClose={() => setShowAddManual(false)}
        />
      )}
    </div>
  );
}

function ContentDetailModal({ item, busy, onAdd, onStatus, onDelete, onClose }: {
  item: ContentItem;
  busy: boolean;
  onAdd: () => void;
  onStatus: (link: ContentProduct, status: 'confirmed' | 'rejected') => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useT();

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:mx-4 sm:max-w-lg sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <MediaTypeIcon type={item.mediaType} />
            <h3 className="text-sm font-semibold text-gray-900">{typeLabel(item, t)}</h3>
            <span className="text-xs text-gray-400">· {new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('content.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {item.imageUrl && (
          <div className="flex items-center justify-center bg-black">
            <img src={item.imageUrl} alt="" className="max-h-80 w-full object-contain" />
          </div>
        )}

        <div className="space-y-5 px-5 py-4">
          {item.caption && <p className="whitespace-pre-wrap text-sm text-gray-800">{item.caption}</p>}
          {item.permalink && (
            <a
              href={item.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              {t('content.open_instagram')} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          <div className="border-t border-gray-100 pt-4">
            <h4 className="mb-1 text-sm font-semibold text-gray-900">{t('content.products_title')}</h4>
            <p className="mb-3 text-xs text-gray-500">{t('content.products_hint')}</p>
            {item.products.length === 0 && <p className="mb-3 text-sm text-gray-400">{t('content.no_products')}</p>}
            <ul className="space-y-2">
              {item.products.map((link) => (
                <li
                  key={link.id}
                  className={`rounded-lg border p-3 ${link.status === 'confirmed' ? 'border-gray-200' : 'border-amber-200 bg-amber-50/50'}`}
                >
                  <div className="flex items-center gap-3">
                    <ProductThumb url={link.imageUrl} className="h-12 w-12 flex-none rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {link.title}
                        {link.color ? <span className="font-normal text-gray-500">, {link.color}</span> : null}
                      </p>
                      <p className="text-xs text-gray-500">{evidenceText(link, t)}</p>
                    </div>
                    {link.status === 'confirmed' && (
                      <span className="flex flex-none items-center gap-1 text-xs font-medium text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                        {t('content.status_confirmed')}
                      </span>
                    )}
                  </div>
                  {link.evidence.reason && <p className="mt-2 text-xs text-gray-500">{link.evidence.reason}</p>}
                  <div className="mt-3 flex gap-2">
                    {link.status === 'suggested' ? (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => onStatus(link, 'confirmed')}>
                          <Check className="h-3.5 w-3.5" />
                          {t('content.confirm_yes')}
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus(link, 'rejected')}>
                          {t('content.confirm_no')}
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(link, 'rejected')}>
                        {t('content.remove')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="sm" className="mt-3" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" />
              {t('content.add_product')}
            </Button>
          </div>
        </div>

        <div className="flex justify-between border-t border-gray-100 px-5 py-3">
          <button onClick={onDelete} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
            <Trash2 className="h-3.5 w-3.5" /> {t('content.delete')}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
            {t('content.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddManualModal({ products, onAdd, onParseLink, loading, onClose }: {
  products: Product[];
  onAdd: (data: { instagramMediaId: string; mediaType?: string; caption?: string; productId?: string }) => void;
  onParseLink: (url: string) => Promise<{ mediaId: string | null; highlightId: string | null; type: string }>;
  loading: boolean;
  onClose: () => void;
}) {
  const [linkInput, setLinkInput] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [mediaType, setMediaType] = useState('highlight');
  const [caption, setCaption] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [parsed, setParsed] = useState(false);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const handlePaste = async () => {
    if (!linkInput.trim()) return;
    try {
      const result = await onParseLink(linkInput.trim());
      if (result.mediaId) {
        setMediaId(result.mediaId);
        setMediaType(result.type);
        setParsed(true);
      } else {
        alert('Could not extract media ID from this link. Paste the media ID directly.');
      }
    } catch {
      alert('Failed to parse link');
    }
  };

  const filteredProducts = products.filter(p =>
    p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.category ?? '').toLowerCase().includes(productSearch.toLowerCase())
  );

  const selectedProductTitle = products.find(p => p.id === selectedProduct)?.title;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Add content manually</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Instagram link or media ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={linkInput}
                onChange={e => { setLinkInput(e.target.value); setParsed(false); }}
                placeholder="Paste Instagram link or media ID..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handlePaste}
                className="px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
              >
                Parse
              </button>
            </div>
            {parsed && mediaId && (
              <p className="text-xs text-green-600 mt-1">Extracted: {mediaId} ({mediaType})</p>
            )}
          </div>

          {!parsed && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Or enter media ID directly</label>
              <input
                type="text"
                value={mediaId}
                onChange={e => setMediaId(e.target.value)}
                placeholder="e.g. 3863556360571278165"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Caption (optional)</label>
            <input
              type="text"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Description for reference..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Link to product (optional)</label>
            {selectedProductTitle ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-green-50 text-green-700 px-3 py-2 rounded-lg flex-1">
                  <Package className="h-3.5 w-3.5" />
                  <span className="text-sm">{selectedProductTitle}</span>
                </div>
                <button onClick={() => setSelectedProduct('')} className="text-gray-400 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setShowProductSearch(true); }}
                    onFocus={() => setShowProductSearch(true)}
                    placeholder="Search products..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                {showProductSearch && productSearch && (
                  <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                    {filteredProducts.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-400">No products found</div>
                    ) : filteredProducts.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedProduct(p.id); setProductSearch(''); setShowProductSearch(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
                      >
                        <Package className="h-3.5 w-3.5 text-gray-400" />
                        {p.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <button
            onClick={() => onAdd({
              instagramMediaId: mediaId,
              mediaType,
              caption: caption || undefined,
              productId: selectedProduct || undefined,
            })}
            disabled={!mediaId || loading}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
