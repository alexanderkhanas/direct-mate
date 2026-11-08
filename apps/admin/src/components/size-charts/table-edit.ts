import type { ChartRange, MeasurementKey, SizeChartTable } from './api';

/*
 * The check screen's table as the owner edits it: cells are text («84–88»
 * or «84»), rows carry a stable id so a highlighted cell stays highlighted
 * while its size is renamed. Turned back into a SizeChartTable on save.
 */

export interface EditColumn {
  key: MeasurementKey;
  label: string;
  unit: 'cm' | 'kg';
}

export interface EditRow {
  id: string;
  size: string;
  cells: Partial<Record<MeasurementKey, string>>;
}

export interface EditTable {
  columns: EditColumn[];
  rows: EditRow[];
  /** Cells the model was unsure of, as `cellId(row, key)`; one leaves the set when the owner edits it. */
  uncertain: string[];
}

/** Measurements the owner can add, in this order (`other` only comes from a chart). */
export const ADDABLE_KEYS: MeasurementKey[] = ['chest', 'waist', 'hips', 'height', 'weight', 'inseam', 'foot'];

let nextId = 0;
export const newRowId = () => `row-${++nextId}`;

export const cellId = (rowId: string, key: MeasurementKey) => `${rowId}:${key}`;

/** «84–88», or «84» for a single value. */
export function formatRange(range: ChartRange): string {
  return range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const RANGE = new RegExp(String.raw`^${NUMBER}\s*(?:[-–—/]|\s)\s*${NUMBER}$`);
const SINGLE = new RegExp(`^${NUMBER}$`);

/** A cell's text: empty → null; «84–88», «84-88», «84 88» or «84» → a range; anything else → 'invalid'. */
export function parseCell(text: string | undefined): ChartRange | null | 'invalid' {
  const clean = (text ?? '').trim();
  if (!clean) return null;
  const toNumber = (s: string) => Number(s.replace(',', '.'));
  const range = clean.match(RANGE);
  const single = clean.match(SINGLE);
  const [a, b] = range ? [toNumber(range[1]), toNumber(range[2])] : single ? [toNumber(single[1]), toNumber(single[1])] : [NaN, NaN];
  if (!(a > 0 && b > 0 && a <= 500 && b <= 500)) return 'invalid';
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

export function toEditTable(table: SizeChartTable): EditTable {
  const rows = table.rows.map((r) => ({
    id: newRowId(),
    size: r.size,
    cells: Object.fromEntries(
      Object.entries(r.values).map(([key, range]) => [key, range ? formatRange(range) : '']),
    ) as EditRow['cells'],
  }));
  const uncertain = table.uncertain.flatMap((u) => {
    const row = rows.find((r) => r.size.trim().toUpperCase() === u.size.trim().toUpperCase());
    return row ? [cellId(row.id, u.key)] : [];
  });
  return { columns: table.measurements.map((m) => ({ ...m })), rows, uncertain };
}

export type TableProblem = 'cells' | 'size_missing' | 'size_twice' | 'row_empty' | 'no_rows' | 'no_columns';

export type SaveCheck =
  | { ok: true; table: SizeChartTable }
  | { ok: false; problems: TableProblem[]; /** Cells to mark red: cellId, or `${rowId}:size`. */ invalid: Set<string> };

/**
 * The table to save, or what's wrong with it. A row with no size and no
 * values is dropped (a blank row the owner added and didn't fill).
 */
export function fromEditTable(edit: EditTable): SaveCheck {
  const invalid = new Set<string>();
  const problems = new Set<TableProblem>();
  const rows: SizeChartTable['rows'] = [];
  const seen = new Map<string, string>();

  for (const row of edit.rows) {
    const size = row.size.trim();
    const values: SizeChartTable['rows'][number]['values'] = {};
    let hasText = false;
    for (const col of edit.columns) {
      const parsed = parseCell(row.cells[col.key]);
      if (row.cells[col.key]?.trim()) hasText = true;
      if (parsed === 'invalid') {
        invalid.add(cellId(row.id, col.key));
        problems.add('cells');
      } else if (parsed) {
        values[col.key] = parsed;
      }
    }
    if (!size && !hasText) continue;
    if (!size) {
      invalid.add(`${row.id}:size`);
      problems.add('size_missing');
      continue;
    }
    const key = size.toUpperCase();
    if (seen.has(key)) {
      invalid.add(`${row.id}:size`).add(`${seen.get(key)}:size`);
      problems.add('size_twice');
    }
    seen.set(key, row.id);
    if (Object.keys(values).length === 0 && !hasText) {
      invalid.add(`${row.id}:size`);
      problems.add('row_empty');
    }
    rows.push({ size, values });
  }
  if (edit.columns.length === 0) problems.add('no_columns');
  if (rows.length === 0) problems.add('no_rows');

  if (problems.size > 0) return { ok: false, problems: [...problems], invalid };
  const uncertain = edit.rows.flatMap((r) =>
    edit.columns.filter((c) => edit.uncertain.includes(cellId(r.id, c.key)) && r.size.trim()).map((c) => ({ size: r.size.trim(), key: c.key })),
  );
  return { ok: true, table: { measurements: edit.columns, rows, uncertain } };
}
