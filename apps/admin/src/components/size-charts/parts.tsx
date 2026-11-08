import type { ButtonHTMLAttributes } from 'react';
import { Check } from '../icons';
import { Chip } from '../setup/ui';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import { chartImageUrl, isWholeStore, type ChartMeasurement, type ChartScope } from './api';

/** The chart's picture as a small portrait thumbnail (the design's 52×64 / 44×54 tiles). */
export function ChartThumb({ imagePath, className }: { imagePath: string; className?: string }) {
  return (
    <img
      src={chartImageUrl(imagePath)}
      alt=""
      className={cn('flex-none rounded-lg border border-dm-line bg-white object-cover', className ?? 'h-16 w-[52px]')}
    />
  );
}

/** A multi-select chip: «Усі бренди», «Lliana». Pressed shows a tick on the accent tint. */
export function ToggleChip({ pressed, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100',
        pressed ? 'border-transparent bg-blue-50 text-blue-800' : 'border-dm-line2 bg-white text-dm-ink2 hover:bg-dm-sunken',
        className,
      )}
      {...props}
    >
      {pressed && <Check className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A chart's products as chips: its brands and categories, or «Усі товари». */
export function ScopeChips({ scope, className }: { scope: ChartScope; className?: string }) {
  const { t } = useT();
  const names = isWholeStore(scope) ? [t('setup_sizes.scope_all')] : [...scope.brands, ...scope.categories];
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {names.map((name) => (
        <Chip key={name} tone="accent">
          {name}
        </Chip>
      ))}
    </div>
  );
}

/** How a measurement is called in tight places (column headings, card meta): «груди», «талія». */
export function useMeasurementName() {
  const { t } = useT();
  return (m: Pick<ChartMeasurement, 'key' | 'label'>) => (m.key === 'other' ? m.label : t(`setup_sizes.short_${m.key}`));
}

/** «Груди» from «груди»: the first letter up, for a heading or the start of a sentence. */
export const capitalize = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** «штани, топи і шорти»: names joined the way a sentence lists them. */
export function useJoinNames() {
  const { t } = useT();
  return (names: string[]) =>
    names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${t('setup_sizes.list_and')} ${names[names.length - 1]}`;
}
