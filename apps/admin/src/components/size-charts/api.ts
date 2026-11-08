import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/*
 * Size charts (GET/POST/PATCH /size-charts): types, queries and small helpers
 * shared by the setup step and the Size charts page. Every key starts with
 * `size-charts`, so invalidating that prefix refreshes lists, counts and
 * coverage together.
 */

export const MEASUREMENT_KEYS = ['chest', 'waist', 'hips', 'height', 'weight', 'inseam', 'foot', 'other'] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

export interface ChartMeasurement {
  key: MeasurementKey;
  label: string;
  unit: 'cm' | 'kg';
}

export interface ChartRange {
  min: number;
  max: number;
}

export interface SizeChartTable {
  measurements: ChartMeasurement[];
  rows: Array<{ size: string; values: Partial<Record<MeasurementKey, ChartRange>> }>;
  uncertain: Array<{ size: string; key: MeasurementKey }>;
}

/** `image`: a picture only · `draft`: read, not checked · `ready`: the bot recommends from it. */
export type SizeChartStatus = 'image' | 'draft' | 'ready';

export interface SizeChart {
  id: string;
  name: string;
  imagePath: string;
  /** Stored lower-case; `displayNames` spells them as the catalog does. Empty = all. */
  brands: string[];
  categories: string[];
  isDefault: boolean;
  table: SizeChartTable | null;
  status: SizeChartStatus;
  sendImage: boolean;
  /** Active products the chart's scope covers. */
  productCount: number;
  createdAt: string;
}

export interface SizeChartCoverage {
  total: number;
  covered: number;
  uncovered: number;
  uncoveredBrands: string[];
  uncoveredCategories: string[];
}

/** Which products a chart is for, spelled as the catalog has them. Empty = all. */
export interface ChartScope {
  brands: string[];
  categories: string[];
}

export const SIZE_CHARTS_KEY = ['size-charts'] as const;
/** GET /engine/config, shared with Settings (the sizing advice lives in flow_config). */
export const STORE_CONFIG_KEY = ['store-config'] as const;

export function useSizeCharts() {
  return useQuery<SizeChart[]>({
    queryKey: SIZE_CHARTS_KEY,
    queryFn: () => api.get('/size-charts').then((r) => r.data),
  });
}

/** The brands and categories of the store's active products, for the scope chips. */
export function useScopeOptions() {
  const brands = useQuery<string[]>({
    queryKey: [...SIZE_CHARTS_KEY, 'brands'],
    queryFn: () => api.get('/size-charts/brands').then((r) => r.data),
  });
  const categories = useQuery<string[]>({
    queryKey: [...SIZE_CHARTS_KEY, 'categories'],
    queryFn: () => api.get('/size-charts/categories').then((r) => r.data),
  });
  return { brands: brands.data ?? [], categories: categories.data ?? [], loading: brands.isLoading || categories.isLoading };
}

/** «Підходить N товарів»: live while the owner picks; the last count stays on screen between picks. */
export function useMatchCount(scope: ChartScope, enabled = true) {
  return useQuery<{ count: number; total: number }>({
    enabled,
    queryKey: [...SIZE_CHARTS_KEY, 'match-count', scope.brands, scope.categories],
    queryFn: () =>
      api
        .get('/size-charts/match-count', {
          params: { brands: scope.brands.join(','), categories: scope.categories.join(',') },
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  });
}

export function useCoverage() {
  return useQuery<SizeChartCoverage>({
    queryKey: [...SIZE_CHARTS_KEY, 'coverage'],
    queryFn: () => api.get('/size-charts/coverage').then((r) => r.data),
  });
}

/** Uploads are served by the API under /uploads (proxied in dev); a remote image is used as is. */
export function chartImageUrl(imagePath: string): string {
  return /^https?:\/\//i.test(imagePath) ? imagePath : `/${imagePath.replace(/^\//, '')}`;
}

/** Stored lower-case names → the catalog's spelling, where the catalog still has them. */
export function displayNames(stored: string[], options: string[]): string[] {
  return stored.map((s) => options.find((o) => o.trim().toLowerCase() === s) ?? s);
}

/** A chart's scope for the chips; a default chart (from before scopes) covers the whole store. */
export function chartScope(chart: SizeChart, options: { brands: string[]; categories: string[] }): ChartScope {
  if (chart.isDefault) return { brands: [], categories: [] };
  return { brands: displayNames(chart.brands, options.brands), categories: displayNames(chart.categories, options.categories) };
}

export const isWholeStore = (scope: ChartScope) => scope.brands.length === 0 && scope.categories.length === 0;

/** The reason code the API gives for a failed read or save (`details.reason`). */
export function errorReason(err: unknown): string | null {
  const details = (err as { response?: { data?: { error?: { details?: { reason?: unknown } } } } })?.response?.data?.error?.details;
  return typeof details?.reason === 'string' ? details.reason : null;
}
