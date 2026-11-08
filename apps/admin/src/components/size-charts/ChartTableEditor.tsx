import { useState } from 'react';
import { Minus, Plus, Trash2 } from '../icons';
import { SetupButton, Sheet } from '../setup/ui';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import { ADDABLE_KEYS, cellId, newRowId, type EditTable } from './table-edit';
import { capitalize, useMeasurementName } from './parts';
import type { MeasurementKey } from './api';

const CELL =
  'h-11 w-full min-w-0 rounded-[10px] border bg-white px-2 text-base tabular-nums text-dm-ink outline-none transition-shadow ' +
  'placeholder:text-dm-faint focus:border-blue-600 focus:ring-[3px] focus:ring-blue-100';
const CELL_PLAIN = 'border-dm-line2';
const CELL_UNSURE = 'border-[#E2A33B] bg-dm-amber-bg ring-[3px] ring-[#FFF1D6]';
const CELL_INVALID = 'border-dm-red bg-dm-red-bg';

/**
 * The check screen's table (m33, d30): a size column and a column per
 * measurement, every cell an input taking «84–88» or «84». Cells the model
 * was unsure of are amber until edited; cells a save rejected are red.
 * Sizes are added inline; measurements are added and anything removed in
 * small sheets, so the grid keeps its width on a phone.
 */
export function ChartTableEditor({
  table,
  onChange,
  invalid,
}: {
  table: EditTable;
  onChange: (next: EditTable) => void;
  /** Cell ids (and `${rowId}:size`) a save rejected. */
  invalid?: Set<string>;
}) {
  const { t } = useT();
  const nameOf = useMeasurementName();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);

  const grid = { gridTemplateColumns: `minmax(3.5rem,0.75fr) repeat(${table.columns.length}, minmax(4.5rem,1fr))` };
  const unit = (u: 'cm' | 'kg') => t(u === 'kg' ? 'setup_sizes.unit_kg' : 'setup_sizes.unit_cm');

  const setCell = (rowId: string, key: MeasurementKey, text: string) =>
    onChange({
      ...table,
      rows: table.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [key]: text } } : r)),
      uncertain: table.uncertain.filter((id) => id !== cellId(rowId, key)),
    });
  const setSize = (rowId: string, size: string) =>
    onChange({ ...table, rows: table.rows.map((r) => (r.id === rowId ? { ...r, size } : r)) });
  const addRow = () => onChange({ ...table, rows: [...table.rows, { id: newRowId(), size: '', cells: {} }] });
  const removeRow = (rowId: string) =>
    onChange({
      ...table,
      rows: table.rows.filter((r) => r.id !== rowId),
      uncertain: table.uncertain.filter((id) => !id.startsWith(`${rowId}:`)),
    });
  const addColumn = (key: MeasurementKey) => {
    onChange({ ...table, columns: [...table.columns, { key, label: t(`setup_sizes.m_${key}`), unit: key === 'weight' ? 'kg' : 'cm' }] });
    setAdding(false);
  };
  const removeColumn = (key: MeasurementKey) =>
    onChange({
      ...table,
      columns: table.columns.filter((c) => c.key !== key),
      rows: table.rows.map((r) => {
        const cells = { ...r.cells };
        delete cells[key];
        return { ...r, cells };
      }),
      uncertain: table.uncertain.filter((id) => !id.endsWith(`:${key}`)),
    });

  const addable = ADDABLE_KEYS.filter((k) => !table.columns.some((c) => c.key === k));

  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-dm-line bg-white p-2.5 lg:rounded-2xl lg:p-3">
      {/* Wider than a phone with many measurements: the table scrolls sideways, not the page. */}
      <div role="table" aria-label={t('setup_sizes.table_label')} className="-mx-0.5 flex flex-col gap-1.5 overflow-x-auto px-0.5 pb-0.5">
        <div role="row" className="grid gap-1.5 px-0.5 text-xs font-medium text-dm-muted lg:gap-2 lg:text-[13px]" style={grid}>
          <span role="columnheader">{t('setup_sizes.col_size')}</span>
          {table.columns.map((c) => (
            <span key={c.key} role="columnheader" className="truncate" title={c.label}>
              {capitalize(nameOf(c))}, {unit(c.unit)}
            </span>
          ))}
        </div>
        {table.rows.map((row, i) => {
          const sizeInvalid = invalid?.has(`${row.id}:size`);
          return (
            <div key={row.id} role="row" className="grid gap-1.5 lg:gap-2" style={grid}>
              <div role="cell" className="min-w-0">
                <input
                  value={row.size}
                  onChange={(e) => setSize(row.id, e.target.value)}
                  aria-label={t('setup_sizes.size_cell_label', { n: i + 1 })}
                  aria-invalid={sizeInvalid || undefined}
                  className={cn(CELL, 'font-semibold', sizeInvalid ? CELL_INVALID : CELL_PLAIN)}
                />
              </div>
              {table.columns.map((c) => {
                const id = cellId(row.id, c.key);
                const unsure = table.uncertain.includes(id);
                const bad = invalid?.has(id);
                const label = `${capitalize(nameOf(c))} ${row.size.trim()}`;
                return (
                  <div key={c.key} role="cell" className="min-w-0">
                    <input
                      value={row.cells[c.key] ?? ''}
                      onChange={(e) => setCell(row.id, c.key, e.target.value)}
                      aria-label={unsure ? t('setup_sizes.cell_label_check', { cell: label }) : label}
                      aria-invalid={bad || undefined}
                      autoComplete="off"
                      className={cn(CELL, bad ? CELL_INVALID : unsure ? CELL_UNSURE : CELL_PLAIN)}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <SetupButton variant="ghost" size="sm" onClick={addRow} aria-label={t('setup_sizes.add_size_label')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('setup_sizes.add_size')}
        </SetupButton>
        {addable.length > 0 && (
          <SetupButton variant="ghost" size="sm" onClick={() => setAdding(true)} aria-label={t('setup_sizes.add_measurement_label')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('setup_sizes.add_measurement')}
          </SetupButton>
        )}
        {(table.rows.length > 0 || table.columns.length > 0) && (
          <SetupButton variant="ghost" size="sm" onClick={() => setRemoving(true)} aria-label={t('setup_sizes.remove_items_label')}>
            <Minus className="h-4 w-4" aria-hidden="true" />
            {t('setup_sizes.remove_items')}
          </SetupButton>
        )}
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('setup_sizes.add_measurement_sheet')} side="bottom">
        <div className="flex flex-col gap-1 overflow-y-auto px-2.5 pb-4">
          {addable.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => addColumn(key)}
              className="flex min-h-[52px] items-center gap-3 rounded-xl px-2.5 text-left text-[15px] text-dm-ink hover:bg-dm-sunken focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
            >
              <Plus className="h-5 w-5 flex-none text-blue-600" aria-hidden="true" />
              {t(`setup_sizes.m_${key}`)}
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={removing} onClose={() => setRemoving(false)} title={t('setup_sizes.remove_sheet')} side="bottom">
        <div className="flex flex-col gap-3 overflow-y-auto px-2.5 pb-4">
          {table.columns.length > 0 && (
            <RemoveGroup
              title={t('setup_sizes.remove_sheet_measurements')}
              items={table.columns.map((c) => ({
                id: c.key,
                text: c.label,
                label: t('setup_sizes.remove_measurement', { label: c.label }),
                onRemove: () => removeColumn(c.key),
              }))}
            />
          )}
          {table.rows.length > 0 && (
            <RemoveGroup
              title={t('setup_sizes.remove_sheet_sizes')}
              items={table.rows.map((r, i) => ({
                id: r.id,
                text: r.size.trim() || t('setup_sizes.size_cell_label', { n: i + 1 }),
                label: t('setup_sizes.remove_size', { size: r.size.trim() || i + 1 }),
                onRemove: () => removeRow(r.id),
              }))}
            />
          )}
        </div>
      </Sheet>
    </div>
  );
}

/** One section of the «Прибрати» sheet: a row per size or measurement with a remove button. */
function RemoveGroup({ title, items }: { title: string; items: Array<{ id: string; text: string; label: string; onRemove: () => void }> }) {
  return (
    <section className="flex flex-col">
      <h3 className="px-2.5 pb-1 text-[13px] font-semibold text-dm-muted">{title}</h3>
      {items.map((item) => (
        <div key={item.id} className="flex min-h-[52px] items-center gap-3 rounded-xl px-2.5">
          <span className="min-w-0 flex-1 truncate text-[15px] text-dm-ink">{item.text}</span>
          <button
            type="button"
            onClick={item.onRemove}
            aria-label={item.label}
            title={item.label}
            className="grid h-11 w-11 flex-none place-items-center rounded-xl text-dm-red hover:bg-dm-red-bg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      ))}
    </section>
  );
}
