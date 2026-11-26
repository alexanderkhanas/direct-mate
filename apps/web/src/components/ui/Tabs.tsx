import type { ReactNode } from 'react';

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface TabsProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<TabOption<T>>;
  /** Optional aria-label for the tablist (a11y). */
  ariaLabel?: string;
}

/**
 * Segmented-control style switcher. Visually distinct from the
 * `ScenarioChooser` pill chips below: a single rounded container holds the
 * options, the active option has a dark inset capsule, inactive options are
 * borderless text only. Reads as "switch view" rather than "pick from a
 * list of options".
 */
export function Tabs<T extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
}: TabsProps<T>) {
  return (
    <div className="flex justify-center mb-6">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="inline-flex items-center gap-1 rounded-full bg-gray-100 p-1"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                active
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'bg-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {opt.icon && (
                <span aria-hidden className="inline-flex">
                  {opt.icon}
                </span>
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
