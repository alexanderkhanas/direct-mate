import { cn } from '../../lib/cn';

type BadgeVariant =
  | 'active'
  | 'handoff'
  | 'closed'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'pending'
  | 'success'
  | 'default';

const styles: Record<BadgeVariant, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  handoff: 'bg-amber-100 text-amber-700',
  closed: 'bg-gray-100 text-gray-500',
  connected: 'bg-emerald-100 text-emerald-700',
  disconnected: 'bg-gray-100 text-gray-500',
  error: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
  success: 'bg-emerald-100 text-emerald-700',
  default: 'bg-gray-100 text-gray-600',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
