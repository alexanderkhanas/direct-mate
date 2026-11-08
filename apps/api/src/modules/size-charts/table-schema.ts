import { z } from 'zod';
import { MEASUREMENT_KEYS, type SizeChartTable } from './size-chart-table';

/** Ukrainian labels for each measurement, when the chart or the owner gives none. */
export const DEFAULT_LABELS: Record<(typeof MEASUREMENT_KEYS)[number], string> = {
  chest: 'Обхват грудей',
  waist: 'Обхват талії',
  hips: 'Обхват стегон',
  height: 'Зріст',
  weight: 'Вага',
  inseam: 'Довжина по внутрішньому шву',
  foot: 'Довжина стопи',
  other: 'Інша мірка',
};

const keySchema = z.enum(MEASUREMENT_KEYS);

const rangeSchema = z
  .object({ min: z.number().positive().max(500), max: z.number().positive().max(500) })
  .refine((r) => r.min <= r.max, { message: 'min is greater than max' });

const sizeKey = (size: string) => size.trim().toUpperCase();

/**
 * A size chart table as the admin sends it (PATCH /size-charts/:id). Weight
 * is in kg, every other measurement in cm. Cells may be empty; a cell's key
 * must be one of the table's measurements.
 */
export const sizeChartTableSchema = z
  .object({
    measurements: z
      .array(z.object({ key: keySchema, label: z.string().trim().min(1).max(60), unit: z.enum(['cm', 'kg']) }))
      .max(MEASUREMENT_KEYS.length),
    rows: z
      .array(z.object({ size: z.string().trim().min(1).max(24), values: z.partialRecord(keySchema, rangeSchema) }))
      .max(60),
    uncertain: z.array(z.object({ size: z.string(), key: keySchema })).max(500),
  })
  .superRefine((table, ctx) => {
    const keys = table.measurements.map((m) => m.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'A measurement appears twice' });
    for (const m of table.measurements) {
      if ((m.key === 'weight') !== (m.unit === 'kg')) {
        ctx.addIssue({ code: 'custom', message: `${m.key} must be in ${m.key === 'weight' ? 'kg' : 'cm'}` });
      }
    }
    const sizes = table.rows.map((r) => sizeKey(r.size));
    if (new Set(sizes).size !== sizes.length) ctx.addIssue({ code: 'custom', message: 'A size appears twice' });
    for (const row of table.rows) {
      for (const key of Object.keys(row.values)) {
        if (!keys.includes(key as never)) ctx.addIssue({ code: 'custom', message: `Size ${row.size} has a value for ${key}, which is not a column` });
      }
    }
  });

/** What keeps a table from being used for recommendations; empty when it can be `ready`. */
export function readyProblems(table: SizeChartTable): string[] {
  const problems: string[] = [];
  if (table.measurements.length === 0) problems.push('The chart has no measurements');
  if (table.rows.length === 0) problems.push('The chart has no sizes');
  const empty = table.rows.filter((r) => Object.keys(r.values).length === 0).map((r) => r.size);
  if (empty.length > 0) problems.push(`No measurements for ${empty.join(', ')}`);
  return problems;
}

/** Drops `uncertain` entries that no longer point at a cell (a size or column was removed or renamed). */
export function pruneUncertain(table: SizeChartTable): SizeChartTable {
  const uncertain = table.uncertain.filter((u) =>
    table.rows.some((r) => sizeKey(r.size) === sizeKey(u.size) && r.values[u.key] !== undefined),
  );
  return { ...table, uncertain };
}
