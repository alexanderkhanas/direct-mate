import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Link2, Unlink, Trash2, RefreshCw, Check, Image, Film, LayoutGrid, ExternalLink, Search, X, Package, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { useT } from '../i18n';

interface MediaMapping {
  id: string;
  instagramMediaId: string;
  mediaType: string;
  productId: string | null;
  variantId: string | null;
  caption: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  matchMethod: string | null;
  matchConfidence: number | null;
  confirmed: boolean;
  createdAt: string;
}

interface Product {
  id: string;
  title: string;
  category: string | null;
  sku: string | null;
  imageUrl: string | null;
}

function MediaTypeIcon({ type }: { type: string }) {
  if (type === 'video') return <Film className="h-4 w-4 text-purple-500" />;
  if (type === 'carousel_album') return <LayoutGrid className="h-4 w-4 text-blue-500" />;
  return <Image className="h-4 w-4 text-pink-500" />;
}

function statusBadge(mapping: MediaMapping, t: (key: string) => string) {
  if (mapping.matchMethod === 'ai_vision_match') return <Badge variant="pending">{t('content.ai_matched')}</Badge>;
  if (mapping.matchMethod === 'sku_from_caption') return <Badge variant="connected">{t('content.sku_match')}</Badge>;
  if (mapping.confirmed) return <Badge variant="connected">{t('content.confirmed')}</Badge>;
  if (mapping.productId) return <Badge variant="pending">{t('content.suggested')}</Badge>;
  return <Badge variant="disconnected">{t('content.unlinked')}</Badge>;
}

function ProductLinkModal({ products, caption, onSelect, onClose }: {
  products: Product[];
  caption: string | null;
  onSelect: (product: Product) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

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
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No products found</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.map(p => {
                const imgUrl = p.imageUrl;
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelect(p)}
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
  const [filter, setFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [linkingMapping, setLinkingMapping] = useState<MediaMapping | null>(null);
  const [showAddManual, setShowAddManual] = useState(false);
  const [detailMapping, setDetailMapping] = useState<MediaMapping | null>(null);

  const queryParams = filter === 'linked' ? '?linked=true'
    : filter === 'unlinked' ? '?linked=false'
    : '';

  const { data, isLoading } = useQuery<{ items: MediaMapping[]; total: number }>({
    queryKey: ['content-linking', filter],
    queryFn: () => api.get(`/instagram/media-mappings${queryParams}`).then(r => r.data),
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ['products-list'],
    queryFn: () => api.get('/products').then(r => {
      const result = r.data;
      return Array.isArray(result) ? result : result.items ?? [];
    }),
  });

  const fetchContent = useMutation({
    mutationFn: () => api.post('/instagram/media-mappings/fetch'),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['content-linking'] });
      const { fetched, matched } = res.data;
      alert(`Fetched ${fetched} items${matched > 0 ? `, ${matched} auto-matched by SKU` : ''}`);
    },
    onError: () => alert('Failed to fetch content. Check Instagram connection.'),
  });

  const linkProduct = useMutation({
    mutationFn: ({ id, productId }: { id: string; productId: string }) =>
      api.patch(`/instagram/media-mappings/${id}`, { productId, confirmed: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content-linking'] }),
  });

  const unlinkProduct = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/instagram/media-mappings/${id}`, { productId: null, variantId: null, confirmed: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content-linking'] }),
  });

  const addManual = useMutation({
    mutationFn: (data: { instagramMediaId: string; mediaType?: string; caption?: string; productId?: string }) =>
      api.post('/instagram/media-mappings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-linking'] });
      setShowAddManual(false);
    },
  });

  const parseLink = useMutation({
    mutationFn: (url: string) => api.post('/instagram/media-mappings/parse-link', { url }).then(r => r.data),
  });

  const deleteMapping = useMutation({
    mutationFn: (id: string) => api.delete(`/instagram/media-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content-linking'] }),
  });

  const items = data?.items ?? [];
  const productList = products ?? [];

  const filters = [
    { key: 'all' as const, label: `All${data?.total != null ? ` (${data.total})` : ''}` },
    { key: 'unlinked' as const, label: t('content.unlinked') },
    { key: 'linked' as const, label: t('content.linked') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('content.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('content.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowAddManual(true)}
          >
            <Plus className="h-4 w-4" />
            {t('content.add_manually')}
          </Button>
          <Button
            onClick={() => fetchContent.mutate()}
            loading={fetchContent.isPending}
          >
            <RefreshCw className="h-4 w-4" />
            {t('content.fetch_content')}
          </Button>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={ImagePlus}
            title="No content yet"
            description="Click 'Fetch Content' to import your Instagram posts and stories"
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {items.map(mapping => (
            <button
              key={mapping.id}
              onClick={() => setDetailMapping(mapping)}
              className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {mapping.mediaUrl ? (
                    <img src={mapping.mediaUrl} alt="" className="h-12 w-12 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <MediaTypeIcon type={mapping.mediaType} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">
                      {mapping.caption || <span className="text-gray-400 italic">No caption</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{mapping.mediaType}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{new Date(mapping.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {mapping.productId ? (
                    <>
                      <div className="flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded-md">
                        <Package className="h-3 w-3" />
                        <span className="text-xs font-medium max-w-[120px] truncate">
                          {productList.find(p => p.id === mapping.productId)?.title ?? 'Linked'}
                        </span>
                      </div>
                      {statusBadge(mapping, t)}
                    </>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setLinkingMapping(mapping); }}
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 border border-blue-200 hover:border-blue-400 hover:bg-blue-50 px-2.5 py-1 rounded-md transition-colors"
                    >
                      <Link2 className="h-3 w-3" />
                      {t('content.link_product')}
                    </button>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {linkingMapping && (
        <ProductLinkModal
          products={productList}
          caption={linkingMapping.caption}
          onSelect={(p) => {
            linkProduct.mutate({ id: linkingMapping.id, productId: p.id });
            setLinkingMapping(null);
          }}
          onClose={() => setLinkingMapping(null)}
        />
      )}

      {detailMapping && (
        <ContentDetailModal
          mapping={detailMapping}
          products={productList}
          onLink={(productId) => {
            linkProduct.mutate({ id: detailMapping.id, productId });
            setDetailMapping(null);
          }}
          onUnlink={() => {
            unlinkProduct.mutate(detailMapping.id);
            setDetailMapping(null);
          }}
          onDelete={() => {
            if (confirm('Delete this content mapping?')) {
              deleteMapping.mutate(detailMapping.id);
              setDetailMapping(null);
            }
          }}
          onClose={() => setDetailMapping(null)}
        />
      )}

      {showAddManual && (
        <AddManualModal
          products={productList}
          onAdd={(data) => addManual.mutate(data)}
          onParseLink={(url) => parseLink.mutateAsync(url)}
          loading={addManual.isPending}
          onClose={() => setShowAddManual(false)}
        />
      )}
    </div>
  );
}

function ContentDetailModal({ mapping, products, onLink, onUnlink, onDelete, onClose }: {
  mapping: MediaMapping;
  products: Product[];
  onLink: (productId: string) => void;
  onUnlink: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [showProductSearch, setShowProductSearch] = useState(false);

  const linkedProduct = products.find(p => p.id === mapping.productId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MediaTypeIcon type={mapping.mediaType} />
            <h3 className="text-sm font-semibold text-gray-900 capitalize">{mapping.mediaType}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {mapping.mediaUrl && (
          <div className="bg-black flex items-center justify-center">
            <img src={mapping.mediaUrl} alt="" className="max-h-80 w-full object-contain" />
          </div>
        )}

        <div className="px-5 py-4 space-y-4">
          {mapping.caption && (
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Caption</label>
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{mapping.caption}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Media ID</label>
              <p className="text-xs text-gray-600 font-mono break-all">{mapping.instagramMediaId}</p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Status</label>
              <div className="flex items-center gap-2">
                {statusBadge(mapping, t)}
                {mapping.matchMethod && (
                  <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{mapping.matchMethod}</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Date</label>
              <p className="text-xs text-gray-600">{new Date(mapping.createdAt).toLocaleString()}</p>
            </div>
            {mapping.permalink && (
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Link</label>
                <a href={mapping.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                  Open on Instagram <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Linked Product</label>
            {linkedProduct ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-2 rounded-lg">
                  <Package className="h-4 w-4" />
                  <span className="text-sm font-medium">{linkedProduct.title}</span>
                </div>
                <button onClick={onUnlink} className="text-xs text-orange-500 hover:text-orange-700 px-2 py-1">
                  Unlink
                </button>
              </div>
            ) : !showProductSearch ? (
              <button
                onClick={() => setShowProductSearch(true)}
                className="text-sm text-blue-500 hover:text-blue-700 flex items-center gap-1"
              >
                <Link2 className="h-4 w-4" /> Link to product
              </button>
            ) : (
              <ProductSearchInline products={products} onSelect={(p) => onLink(p.id)} />
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-between">
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Close</button>
        </div>
      </div>
    </div>
  );
}

function ProductSearchInline({ products, onSelect }: { products: Product[]; onSelect: (p: Product) => void }) {
  const [search, setSearch] = useState('');
  const filtered = products.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    (p.category ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          autoFocus
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search products..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
        {filtered.slice(0, 10).map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2 border-b border-gray-50 last:border-0"
          >
            <Package className="h-3.5 w-3.5 text-gray-400" />
            {p.title}
            {p.category && <span className="text-[10px] text-gray-400 ml-auto">{p.category}</span>}
          </button>
        ))}
        {filtered.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No products found</div>}
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
