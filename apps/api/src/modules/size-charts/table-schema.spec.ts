import { pruneUncertain, readyProblems, sizeChartTableSchema } from './table-schema';
import type { SizeChartTable } from './size-chart-table';

const TABLE: SizeChartTable = {
  measurements: [
    { key: 'chest', label: 'Обхват грудей', unit: 'cm' },
    { key: 'weight', label: 'Вага', unit: 'kg' },
  ],
  rows: [
    { size: 'S', values: { chest: { min: 84, max: 88 }, weight: { min: 50, max: 58 } } },
    { size: 'M', values: { chest: { min: 88, max: 92 } } },
  ],
  uncertain: [{ size: 'S', key: 'chest' }],
};

const issues = (table: unknown) => {
  const parsed = sizeChartTableSchema.safeParse(table);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe('size chart table validation', () => {
  it('accepts a table with empty cells', () => {
    expect(issues(TABLE)).toEqual([]);
  });

  it('rejects a reversed range, a repeated size or column, a value without a column, and wrong units', () => {
    expect(issues({ ...TABLE, rows: [{ size: 'S', values: { chest: { min: 90, max: 84 } } }] })).toContain('min is greater than max');
    expect(issues({ ...TABLE, rows: [TABLE.rows[0], { ...TABLE.rows[1], size: ' s ' }] })).toContain('A size appears twice');
    expect(issues({ ...TABLE, measurements: [TABLE.measurements[0], TABLE.measurements[0]] })).toContain('A measurement appears twice');
    expect(issues({ ...TABLE, rows: [{ size: 'S', values: { hips: { min: 90, max: 94 } } }] })).toContain(
      'Size S has a value for hips, which is not a column',
    );
    expect(issues({ ...TABLE, measurements: [{ key: 'chest', label: 'Груди', unit: 'kg' }] })).toContain('chest must be in cm');
    expect(issues({ ...TABLE, rows: [{ size: '', values: {} }] }).length).toBeGreaterThan(0);
  });

  it('is ready only with sizes, measurements and a value in every row', () => {
    expect(readyProblems(TABLE)).toEqual([]);
    expect(readyProblems({ ...TABLE, rows: [] })).toEqual(['The chart has no sizes']);
    expect(readyProblems({ ...TABLE, rows: [...TABLE.rows, { size: 'L', values: {} }] })).toEqual(['No measurements for L']);
  });

  it('drops uncertain marks whose cell is gone', () => {
    const edited = { ...TABLE, rows: [{ size: 'S', values: { weight: { min: 50, max: 58 } } }], uncertain: [...TABLE.uncertain, { size: 'XL', key: 'chest' as const }] };
    expect(pruneUncertain(edited).uncertain).toEqual([]);
    expect(pruneUncertain(TABLE).uncertain).toEqual(TABLE.uncertain);
  });
});
