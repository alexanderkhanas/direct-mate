import { cn } from '../../lib/cn';

/**
 * A small ring that fills as setup steps finish (the sidebar's setup entry,
 * the Dashboard setup card). Decorative: put the numbers in text beside it.
 */
export function ProgressRing({ value, max, size = 28, stroke = 4, className }: { value: number; max: number; size?: number; stroke?: number; className?: string }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const part = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={cn('flex-none -rotate-90', className)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-blue-100" />
      {part > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - part)}
          className="stroke-blue-600"
        />
      )}
    </svg>
  );
}
