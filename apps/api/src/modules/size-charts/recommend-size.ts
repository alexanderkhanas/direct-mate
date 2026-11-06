/**
 * Height/weight → size, from the numeric ranges a store keeps in
 * `flow_config.sizeChart` (size charts in `size_charts` are images only).
 *
 * Shared by the v2 agent's `get_size_help` tool and the old reply engine, so
 * both recommend the same size for the same measurements.
 */

export interface SizeRange {
  heightMin: number;
  heightMax: number;
  weightMin: number;
  weightMax: number;
}

export type NumericSizeChart = Record<string, SizeRange>;

/**
 * One point for height in range, one for weight in range; the first size with
 * the top score wins, in chart order. When nothing scores, the size whose
 * height midpoint is closest wins. Returns null with no measurements.
 */
export function recommendSize(
  measurements: { heightCm?: number | null; weightKg?: number | null },
  sizeChart: NumericSizeChart,
): string | null {
  const height = measurements.heightCm || 0;
  const weight = measurements.weightKg || 0;
  if (!height && !weight) return null;

  let bestSize: string | null = null;
  let bestScore = -1;

  for (const [size, range] of Object.entries(sizeChart)) {
    let score = 0;
    if (height && height >= range.heightMin && height <= range.heightMax) score++;
    if (weight && weight >= range.weightMin && weight <= range.weightMax) score++;

    if (score > bestScore) {
      bestScore = score;
      bestSize = size;
    }
  }

  if (bestScore === 0 && height) {
    let closestDist = Infinity;
    for (const [size, range] of Object.entries(sizeChart)) {
      const dist = Math.abs(height - (range.heightMin + range.heightMax) / 2);
      if (dist < closestDist) {
        closestDist = dist;
        bestSize = size;
      }
    }
  }

  return bestSize;
}

/**
 * The store's numeric chart, or null when it is missing or malformed.
 * `flow_config` is owner-editable jsonb, so a bad entry drops out rather than
 * failing the turn.
 */
export function parseNumericSizeChart(raw: unknown): NumericSizeChart | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const chart: NumericSizeChart = {};
  for (const [size, range] of Object.entries(raw as Record<string, unknown>)) {
    const r = range as Partial<Record<keyof SizeRange, unknown>> | null;
    if (
      r &&
      typeof r.heightMin === 'number' &&
      typeof r.heightMax === 'number' &&
      typeof r.weightMin === 'number' &&
      typeof r.weightMax === 'number'
    ) {
      chart[size] = {
        heightMin: r.heightMin,
        heightMax: r.heightMax,
        weightMin: r.weightMin,
        weightMax: r.weightMax,
      };
    }
  }
  return Object.keys(chart).length > 0 ? chart : null;
}
