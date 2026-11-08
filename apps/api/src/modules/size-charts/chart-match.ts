import type { ChartRange, MeasurementKey, SizeChartTable } from './size-chart-table';

/**
 * A customer's measurements → a size, from a chart the owner checked. Pure,
 * so the agent's `get_size_help` and its tests agree on every case.
 */

/** Measurements a customer can give: every chart key except `other`, in cm (weight in kg). */
export type GivenMeasurements = Partial<Record<Exclude<MeasurementKey, 'other'>, number>>;

export type SizeMatch =
  /** None of the given measurements is on the chart. */
  | { kind: 'none' }
  /** The measurements are more than a size step beyond every row. */
  | { kind: 'out_of_range'; matchedOn: MeasurementKey[] }
  | {
      kind: 'size';
      size: string;
      /** Two adjacent sizes fit equally well: [smaller, larger]; `size` is the larger. */
      between?: [string, string];
      matchedOn: MeasurementKey[];
      /** Given measurements outside the chosen size's range. */
      outside: Array<{ key: MeasurementKey; value: number; range: ChartRange }>;
    };

/** Two rows closer than this (in size steps) fit equally well. */
const TIE_STEPS = 0.5;
/** Past this many size steps from the nearest row, the chart doesn't cover the customer. */
const OUT_OF_RANGE_STEPS = 1;

/**
 * The size whose ranges hold the most of the given measurements; among
 * those, the one nearest by summed distance outside the ranges, each
 * measurement measured in its own size steps (4 cm of chest and 6 cm of
 * height both count as about one size). Equal candidates go to the larger
 * size, and no size is chosen that a measurement is well above: a little
 * loose fits, a little tight doesn't. A boundary value («88» with S 84–88
 * and M 88–92) or a close split (chest says M, hips say L) gives `between`.
 */
export function matchSize(table: SizeChartTable, given: GivenMeasurements): SizeMatch {
  const keys = table.measurements
    .map((m) => m.key)
    .filter(
      (k): k is Exclude<MeasurementKey, 'other'> =>
        k !== 'other' && typeof given[k] === 'number' && table.rows.some((r) => r.values[k]),
    );
  if (keys.length === 0) return { kind: 'none' };

  const steps = new Map(keys.map((k) => [k, sizeStep(table, k)]));
  /** Size steps a given measurement is above a row's range; 0 when it fits or is below. */
  const above = (k: (typeof keys)[number], index: number) => {
    const range = table.rows[index].values[k];
    return range && given[k]! > range.max ? (given[k]! - range.max) / steps.get(k)! : 0;
  };

  const scored = table.rows.map((row, index) => {
    let inside = 0;
    let distance = 0;
    let farthest = 0;
    for (const k of keys) {
      const range = row.values[k];
      const value = given[k]!;
      // A size without this measurement can't be judged on it: count it a step away.
      if (!range) {
        distance += 1;
        continue;
      }
      const off = value < range.min ? (range.min - value) / steps.get(k)! : value > range.max ? (value - range.max) / steps.get(k)! : 0;
      if (off === 0) inside += 1;
      distance += off;
      farthest = Math.max(farthest, off);
    }
    return { index, inside, distance, farthest };
  });
  const ranked = [...scored].sort((a, b) => b.inside - a.inside || a.distance - b.distance || b.index - a.index);
  const best = ranked[0];

  if (best.inside === 0 && best.farthest > OUT_OF_RANGE_STEPS) return { kind: 'out_of_range', matchedOn: keys };

  const runnerUp = ranked[1];
  const tied =
    !!runnerUp &&
    runnerUp.inside === best.inside &&
    runnerUp.distance - best.distance < TIE_STEPS &&
    Math.abs(runnerUp.index - best.index) === 1;
  let chosen = tied ? Math.max(best.index, runnerUp.index) : best.index;
  let between: [string, string] | undefined = tied
    ? [table.rows[Math.min(best.index, runnerUp.index)].size, table.rows[chosen].size]
    : undefined;

  // Up a size while any measurement is more than half a step above this one.
  while (chosen < table.rows.length - 1 && keys.some((k) => above(k, chosen) > TIE_STEPS)) {
    chosen += 1;
    between = undefined;
  }
  // The largest size still too small for a measurement: the chart doesn't cover this customer.
  if (keys.some((k) => above(k, chosen) > OUT_OF_RANGE_STEPS)) return { kind: 'out_of_range', matchedOn: keys };

  const row = table.rows[chosen];
  const outside = keys.flatMap((key) => {
    const range = row.values[key];
    const value = given[key]!;
    return range && (value < range.min || value > range.max) ? [{ key, value, range }] : [];
  });
  return {
    kind: 'size',
    size: row.size,
    ...(between && { between }),
    matchedOn: keys,
    outside,
  };
}

/**
 * How much a measurement grows from one size to the next: the median gap
 * between neighbouring rows' midpoints. Never below 1 (cm or kg).
 */
function sizeStep(table: SizeChartTable, key: MeasurementKey): number {
  const mids = table.rows
    .map((r) => r.values[key])
    .filter((r): r is ChartRange => !!r)
    .map((r) => (r.min + r.max) / 2);
  const gaps = mids
    .slice(1)
    .map((m, i) => Math.abs(m - mids[i]))
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  if (gaps.length === 0) return 1;
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.max(1, median);
}

/** «84–88», or «84» for a single value. */
export function formatRange(range: ChartRange): string {
  return range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
}
