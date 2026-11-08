import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { OnboardingStatus } from '../../../pages/onboarding/steps';

// Mirrors apps/api/src/modules/catalog-feeds/feed-sync.service.ts.
export type FeedFormat = 'gmc' | 'yml' | 'sheet';

export interface FeedWarning {
  code: string;
  count: number;
  examples?: string[];
}

export interface FeedSample {
  title: string;
  category: string | null;
  price: number;
  currency: string;
  colors: string[];
  sizes: string[];
  image: string | null;
  inStock: boolean;
}

export interface FeedPreview {
  format: FeedFormat;
  products: number;
  variants: number;
  inStock: number;
  sample: FeedSample[];
  warnings: FeedWarning[];
}

export interface ConnectedFeed {
  id: string;
  url: string;
  format: FeedFormat | null;
  status: 'connected' | 'error' | 'disconnected' | 'pending';
  lastSyncAt: string | null;
  products: number | null;
  warnings: FeedWarning[];
  lastError: { code: string; message: string } | null;
}

export interface FeedStatus {
  feed: ConnectedFeed | null;
}

export interface FeedSyncResult extends FeedStatus {
  status: 'imported' | 'unchanged' | 'already_running' | 'failed';
}

/** A row of GET /connections (the fields used here). */
export interface StoreConnection {
  id: string;
  type: string;
  status: string;
  metadata: { shopDomain?: string; shopName?: string } | null;
  lastSyncAt: string | null;
}

/** A link source: both go through the feed endpoints (a sheet link becomes its CSV export in the API). */
export type LinkSource = 'sheet' | 'feed';

/** Google Sheet template; a CSV of it ships with the admin for owners who'd rather copy columns. */
export const SHEET_TEMPLATE_URL = import.meta.env.VITE_SHEET_TEMPLATE_URL as string | undefined;
export const SHEET_CSV_TEMPLATE = '/templates/directmate-products.csv';

export const FEED_KEY = ['catalog-feed'];
export const CONNECTIONS_KEY = ['connections'];
export const ONBOARDING_KEY = ['onboarding-status'];

export function useFeedStatus() {
  return useQuery<FeedStatus>({
    queryKey: FEED_KEY,
    queryFn: () => api.get('/catalog/feeds').then((r) => r.data),
  });
}

/** Same key and request as the Connections page, so the two share one cache entry. */
export function useConnections() {
  return useQuery<StoreConnection[]>({
    queryKey: CONNECTIONS_KEY,
    queryFn: () => api.get('/connections').then((r) => r.data),
  });
}

/** Same key and request as the setup page: inside setup this is the shell's own status. */
export function useOnboardingStatus() {
  return useQuery<OnboardingStatus>({
    queryKey: ONBOARDING_KEY,
    queryFn: () => api.get('/onboarding/status').then((r) => r.data),
    staleTime: 30_000,
  });
}

export function linkSourceOf(format: FeedFormat | null): LinkSource {
  return format === 'sheet' ? 'sheet' : 'feed';
}

// ─── Errors ─────────────────────────────────────────────────

/**
 * What went wrong with a link. The first seven come from the API's FeedError,
 * `import_failed` from a failed first sync; `invalid_url` and `server_error`
 * are worked out here.
 */
export const FEED_ERROR_CODES = [
  'unreachable',
  'not_public',
  'sheet_not_shared',
  'unknown_format',
  'too_large',
  'unsafe_url',
  'http_error',
  'invalid_url',
  'import_failed',
  'server_error',
] as const;
export type FeedErrorCode = (typeof FEED_ERROR_CODES)[number];

export function knownErrorCode(code: string, fallback: FeedErrorCode = 'import_failed'): FeedErrorCode {
  return (FEED_ERROR_CODES as readonly string[]).includes(code) ? (code as FeedErrorCode) : fallback;
}

/**
 * API errors arrive as `{ error: { code, message, details } }` (AllExceptionsFilter);
 * feed problems carry their code in `details.code`. Anything else (a crash, a
 * proxy timeout, no network) is ours, not the owner's link: `fallback`.
 */
export function feedErrorCode(error: unknown, fallback: FeedErrorCode): FeedErrorCode {
  const body = (error as { response?: { data?: { error?: { code?: string; details?: { code?: string } } } } })?.response?.data?.error;
  if (body?.details?.code) return knownErrorCode(body.details.code, fallback);
  if (body?.code === 'VALIDATION_ERROR') return 'invalid_url';
  return fallback;
}

// ─── Input clean-up ─────────────────────────────────────────

/** Owners often paste «docs.google.com/…» without the scheme; the API wants a full URL. */
export function normalizeUrl(value: string): string {
  const url = value.trim();
  return !url || /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** «https://Lliana.myshopify.com/admin» or just «lliana» → «lliana.myshopify.com». */
export function normalizeShopDomain(value: string): string {
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  return host && !host.includes('.') ? `${host}.myshopify.com` : host;
}

/** A link without the scheme and «www.», for display. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}
