import { useT } from '../../i18n';

const TOPICS = ['learn_tone', 'learn_delivery', 'learn_payment', 'learn_examples'] as const;

/** A four-point sparkle with curved sides, centred on (cx, cy). */
function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.18; // how far the curves bow towards the centre
  return [
    `M${cx} ${cy - r}`,
    `C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}`,
    'Z',
  ].join(' ');
}

/** The AI mark: a big blue sparkle and a small violet one twinkling out of step, and a tiny one popping in. */
function Sparkles() {
  return (
    <svg viewBox="0 0 48 48" className="h-14 w-14 flex-none" aria-hidden="true">
      <path className="dm-sparkle-big" d={sparkle(19, 21, 16)} fill="#3B82F6" />
      <path className="dm-sparkle-small" d={sparkle(37, 36, 8)} fill="#8B5CF6" />
      <path className="dm-sparkle-tiny" d={sparkle(38, 10, 4.5)} fill="#60A5FA" />
    </svg>
  );
}

/**
 * «AI-агент вчиться на вашому Instagram»: the wait while the history import
 * runs, shown as learning rather than reading. Twinkling AI sparkles, what it
 * picks up lighting up in turn, and a sliding bar. Animations live in
 * index.css and stop under prefers-reduced-motion.
 */
export function AiLearning({ title, text }: { title: string; text?: string }) {
  const { t } = useT();
  return (
    <div role="status" className="flex flex-col gap-3 overflow-hidden rounded-2xl border border-blue-100 bg-blue-50 p-4">
      <div className="flex items-center gap-4">
        <Sparkles />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <b className="text-[15px] font-semibold text-blue-800">{title}</b>
            {text && <p className="text-sm text-dm-ink2">{text}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5" aria-hidden="true">
            {TOPICS.map((key, i) => (
              <span
                key={key}
                style={{ animationDelay: `${i * 0.8}s` }}
                className="dm-learn-chip rounded-full border border-blue-100 bg-white px-2.5 py-1 text-xs font-medium text-dm-muted"
              >
                {t(`setup_history.${key}`)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <span className="relative block h-1 overflow-hidden rounded-full bg-blue-100" aria-hidden="true">
        <span className="dm-indeterminate absolute inset-y-0 left-0 block w-2/5 rounded-full bg-blue-500" />
      </span>
    </div>
  );
}
