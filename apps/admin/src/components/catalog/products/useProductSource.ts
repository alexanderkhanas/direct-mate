import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import {
  CONNECTIONS_KEY,
  FEED_KEY,
  ONBOARDING_KEY,
  feedErrorCode,
  linkSourceOf,
  normalizeShopDomain,
  normalizeUrl,
  useConnections,
  useFeedStatus,
  useOnboardingStatus,
  type FeedErrorCode,
  type FeedPreview,
  type FeedStatus,
  type FeedSyncResult,
  type LinkSource,
} from './api';

export type SourcePick = LinkSource | 'shopify';

/**
 * What the products flow shows:
 *   pending                 the sources are still loading
 *   choose                  the four source cards
 *   sheet · feed · shopify  a source's own screen
 *   loading · preview       reading a link, then what the bot will see
 *   importing               the first import (up to 1–2 min)
 *   error                   a link that didn't work, with how to fix it
 *   waiting                 Shopify connected, products not synced yet
 *   done                    the connected source(s)
 */
export type SourceView =
  | 'pending'
  | 'choose'
  | SourcePick
  | 'loading'
  | 'preview'
  | 'importing'
  | 'error'
  | 'waiting'
  | 'done';

/** A screen the owner moved to; `null` follows the data (done, waiting or choose). */
type Screen = 'choose' | SourcePick | 'preview' | 'error';

export interface SourceAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

/** How long a fresh import keeps the «щойно» highlight. */
const FRESH_MS = 4000;

/**
 * The products flow shared by the setup step and the Catalog page panel: the
 * screen, the link and Shopify fields, the API calls, and the one primary
 * action and «Назад» for each screen. The step hands `primary` and `back` to
 * the setup footer; the panel renders them as its own buttons.
 */
export function useProductSource({ onImported, refresh }: { onImported?: () => void; refresh?: () => Promise<void> } = {}) {
  const { t } = useT();
  const plural = usePlural();
  const qc = useQueryClient();
  const feedQuery = useFeedStatus();
  const connectionsQuery = useConnections();
  const statusQuery = useOnboardingStatus();

  const [screen, setScreen] = useState<Screen | null>(null);
  const [kind, setKind] = useState<LinkSource>('sheet');
  const [url, setUrl] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [error, setError] = useState<{ code: FeedErrorCode; during: 'preview' | 'connect' } | null>(null);
  const [justImported, setJustImported] = useState(false);

  useEffect(() => {
    if (!justImported) return;
    const timer = window.setTimeout(() => setJustImported(false), FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [justImported]);

  const feed = feedQuery.data?.feed ?? null;
  const shopify = connectionsQuery.data?.find((c) => c.type === 'shopify' && c.status === 'connected') ?? null;
  const products = statusQuery.data?.store.products ?? { total: 0, inStock: 0 };
  const supportAvailable = statusQuery.data?.supportAvailable ?? false;
  const hasSource = !!feed || !!shopify || products.total > 0;

  /** After products change: the status (step done, counts) and the Catalog page's list. */
  const refreshCatalog = () =>
    Promise.all([
      refresh ? refresh() : qc.invalidateQueries({ queryKey: ONBOARDING_KEY }),
      qc.invalidateQueries({ queryKey: ['products'] }),
    ]);

  const preview = useMutation<FeedPreview, unknown, string>({
    mutationFn: (link) => api.post('/catalog/feeds/preview', { url: link }).then((r) => r.data),
    onSuccess: () => setScreen('preview'),
    onError: (err) => {
      setError({ code: feedErrorCode(err, 'server_error'), during: 'preview' });
      setScreen('error');
    },
  });

  const connect = useMutation<FeedStatus, unknown, string>({
    mutationFn: (link) => api.post('/catalog/feeds', { url: link }).then((r) => r.data),
    // Awaited, so the import wait stays on screen until the counts are fresh.
    onSuccess: async (status) => {
      qc.setQueryData(FEED_KEY, status);
      await refreshCatalog();
      preview.reset();
      setScreen(null);
      setJustImported(true);
      onImported?.();
    },
    onError: (err) => {
      setError({ code: feedErrorCode(err, 'import_failed'), during: 'connect' });
      setScreen('error');
      // A failed first sync still leaves the feed connected, with its error.
      void qc.invalidateQueries({ queryKey: FEED_KEY });
    },
  });

  const connectShopify = useMutation({
    mutationFn: () =>
      api.post('/connections/shopify', { shopDomain: normalizeShopDomain(shopDomain), accessToken: shopToken.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CONNECTIONS_KEY });
      setShopToken('');
      setScreen(null);
    },
  });

  const resync = useMutation<FeedSyncResult, unknown, string>({
    mutationFn: (id) => api.post(`/catalog/feeds/${id}/sync`).then((r) => r.data),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: FEED_KEY }), refreshCatalog()]),
  });

  const settled: SourceView = shopify && !feed && products.total === 0 ? 'waiting' : hasSource ? 'done' : 'choose';
  const sourcesLoading = feedQuery.isPending || connectionsQuery.isPending || statusQuery.isPending;
  const view: SourceView = preview.isPending
    ? 'loading'
    : connect.isPending
      ? 'importing'
      : (screen ?? (sourcesLoading ? 'pending' : settled));

  const runPreview = () => {
    const link = normalizeUrl(url);
    setUrl(link);
    setError(null);
    preview.mutate(link);
  };
  const runImport = () => connect.mutate(normalizeUrl(url));
  // A failed import is retried as is; a link edited on the error screen is previewed first.
  const retry = () => (error?.during === 'connect' && normalizeUrl(url) === preview.variables ? runImport() : runPreview());

  const pick = (next: SourcePick) => {
    if (next !== 'shopify') {
      // Changing the link of the connected feed starts from the current one.
      if (next !== kind || !url) setUrl(feed && linkSourceOf(feed.format) === next ? feed.url : '');
      setKind(next);
    }
    setError(null);
    connectShopify.reset();
    setScreen(next);
  };

  const count = preview.data?.products ?? 0;
  const primary: SourceAction | null =
    view === 'sheet' || view === 'feed'
      ? { label: t('setup_products.preview_products'), onClick: runPreview, disabled: !url.trim() }
      : view === 'loading'
        ? { label: t(`setup_products.reading_${kind}_busy`), onClick: () => undefined, loading: true }
        : view === 'shopify'
          ? {
              label: t('setup_products.shopify_connect'),
              onClick: () => connectShopify.mutate(),
              loading: connectShopify.isPending,
              disabled: !shopDomain.trim() || !shopToken.trim(),
            }
          : view === 'preview'
            ? { label: plural(count, 'setup_products.import'), onClick: runImport }
            : view === 'importing'
              ? { label: t('setup_products.importing_busy'), onClick: () => undefined, loading: true }
              : view === 'error'
                ? { label: t('setup_products.retry'), onClick: retry, disabled: !url.trim() }
                : null;

  const back: (() => void) | null =
    view === 'sheet' || view === 'feed' || view === 'shopify' || view === 'error'
      ? () => setScreen('choose')
      : view === 'preview'
        ? () => setScreen(kind)
        : view === 'choose' && hasSource
          ? () => setScreen(null)
          : null;

  /** The heading for the inner screens; the step and the panel name the start and the end themselves. */
  const heading =
    view === 'choose'
      ? { title: t('setup_products.choose_title'), lead: t('setup_products.choose_lead') }
      : view === 'sheet' || view === 'feed' || view === 'shopify'
        ? { title: t(`setup_products.source_${view}`), lead: t(`setup_products.${view}_lead`) }
        : view === 'preview'
          ? { title: t('setup_products.preview_title'), lead: t('setup_products.preview_lead') }
          : view === 'loading' || view === 'importing' || view === 'error'
            ? { title: t(`setup_products.source_${kind}`), lead: undefined }
            : { title: t('setup_products.done_title'), lead: undefined };

  return {
    view,
    heading,
    primary,
    back,
    kind,
    url,
    setUrl,
    shopDomain,
    setShopDomain,
    shopToken,
    setShopToken,
    preview: preview.data,
    previewCount: count,
    errorCode: error?.code ?? null,
    shopifyFailed: connectShopify.isError,
    feed,
    shopify,
    products,
    supportAvailable,
    justImported,
    resync,
    pick,
    /** «Змінити джерело». */
    chooseAgain: () => setScreen('choose'),
    /** «Змінити посилання» from the preview. */
    editLink: () => setScreen(kind),
  };
}

export type ProductSourceFlow = ReturnType<typeof useProductSource>;
