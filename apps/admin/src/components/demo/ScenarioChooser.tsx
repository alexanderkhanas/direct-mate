import { Scenario } from './types';

interface ScenarioChooserProps {
  scenarios: Scenario[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function ScenarioChooser({
  scenarios,
  selectedKey,
  onSelect,
}: ScenarioChooserProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2 mb-6">
      {scenarios.map((s) => {
        const active = s.key === selectedKey;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active
                ? 'bg-gray-900 text-white border border-gray-900'
                : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {s.icon && <span aria-hidden>{s.icon}</span>}
            {s.title}
          </button>
        );
      })}
    </div>
  );
}
