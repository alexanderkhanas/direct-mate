/**
 * A size chart read into data: which measurements it has and, per size, the
 * range for each. Written by the vision read (status `draft`), corrected by
 * the owner, then `ready` for the agent's `get_size_help`.
 */

/** Measurements a chart can have; `other` covers anything else, under its own label. */
export const MEASUREMENT_KEYS = ['chest', 'waist', 'hips', 'height', 'weight', 'inseam', 'foot', 'other'] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

export interface ChartMeasurement {
  key: MeasurementKey;
  /** As the owner and the customer see it: «Обхват грудей». */
  label: string;
  unit: 'cm' | 'kg';
}

/** One cell: a range «84–88», or a single value (min = max). */
export interface ChartRange {
  min: number;
  max: number;
}

export interface ChartRow {
  /** As printed on the chart: «S», «42», «W30». */
  size: string;
  values: Partial<Record<MeasurementKey, ChartRange>>;
}

export interface SizeChartTable {
  measurements: ChartMeasurement[];
  rows: ChartRow[];
  /** Cells the model couldn't read with confidence; the owner checks these first. */
  uncertain: Array<{ size: string; key: MeasurementKey }>;
}

/** `image`: only a picture the bot can send (charts from before Nov 2026) · `draft`: read, not yet checked · `ready`. */
export type SizeChartStatus = 'image' | 'draft' | 'ready';
