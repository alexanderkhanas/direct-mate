import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, Minus, X, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';

/*
 * Setup primitives: Tailwind ports of the design canvas's component classes
 * («DirectMate Onboarding Design», System board). Colours come from the `dm`
 * tokens in tailwind.config.js; the accent is Tailwind's blue-600/700/800.
 */

// ─── Buttons ────────────────────────────────────────────────

export type SetupButtonVariant = 'brand' | 'secondary' | 'ghost' | 'blocked' | 'dark' | 'danger';
export type SetupButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<SetupButtonVariant, string> = {
  brand: 'bg-blue-600 text-white hover:bg-blue-700',
  secondary: 'bg-white border-dm-line2 text-dm-ink hover:bg-dm-sunken',
  ghost: 'bg-transparent text-dm-ink2 hover:bg-dm-bubble',
  blocked: 'bg-blue-50 border-[1.5px] border-dashed border-blue-600 text-blue-800 hover:bg-blue-100',
  dark: 'bg-dm-ink text-white hover:bg-black',
  danger: 'bg-white border-dm-red-line text-dm-red hover:bg-dm-red-bg',
};

const BUTTON_SIZE: Record<SetupButtonSize, string> = {
  sm: 'h-9 text-[13px] rounded-[10px]',
  md: 'h-12 text-[15px] rounded-xl',
  lg: 'h-[52px] text-base rounded-xl',
};

const BUTTON_PAD: Record<SetupButtonSize, string> = { sm: 'px-3', md: 'px-[18px]', lg: 'px-5' };

/**
 * The button classes, for a `<Link>` or `<a>` that should look like a button.
 * `cn` only joins classes (no tailwind-merge), so `extra` must not repeat a
 * property set here (padding, height, colours).
 */
export function buttonClass(variant: SetupButtonVariant = 'brand', size: SetupButtonSize = 'md', extra?: string, loading?: boolean) {
  return cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold border border-transparent transition-colors',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-default',
    !loading && 'disabled:opacity-45',
    BUTTON_SIZE[size],
    variant === 'ghost' ? 'px-3' : BUTTON_PAD[size],
    BUTTON_VARIANT[variant],
    extra,
  );
}

interface SetupButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SetupButtonVariant;
  size?: SetupButtonSize;
  /** Keeps the label and shows a spinner («Читаю фід…»). */
  loading?: boolean;
  block?: boolean;
  grow?: boolean;
}

export const SetupButton = forwardRef<HTMLButtonElement, SetupButtonProps>(
  ({ variant = 'brand', size = 'md', loading, block, grow, className, children, disabled, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, cn(block && 'w-full', grow && 'flex-1 min-w-0', className), loading)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
SetupButton.displayName = 'SetupButton';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the button has no visible text. */
  label: string;
  outline?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, outline, className, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'h-11 w-11 flex-none inline-grid place-items-center rounded-xl text-dm-ink2 transition-colors',
        'hover:bg-dm-bubble focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-45',
        outline && 'border border-dm-line2 bg-white',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = 'IconButton';

// ─── Type ───────────────────────────────────────────────────

/** A step's heading: optional eyebrow, the title (26 px phone, 32 px desktop) and a lead line. */
export function StepTitle({ eyebrow, title, lead }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 lg:gap-2">
      {eyebrow && <span className="text-sm font-medium text-blue-800">{eyebrow}</span>}
      <h1 className="text-[26px] lg:text-[32px] leading-[1.15] font-semibold tracking-[-0.015em] text-dm-ink text-balance">{title}</h1>
      {lead && <p className="text-[15px] lg:text-base text-dm-muted text-pretty">{lead}</p>}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-[17px] leading-[1.3] font-semibold text-dm-ink', className)}>{children}</h2>;
}

export function TextLink({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn('font-medium text-blue-800 underline underline-offset-[3px] decoration-1 hover:text-blue-700', className)}
      {...props}
    >
      {children}
    </button>
  );
}

// ─── Fields ─────────────────────────────────────────────────

const INPUT_BASE =
  'w-full rounded-xl border border-dm-line2 bg-white px-3.5 text-base text-dm-ink placeholder:text-dm-muted outline-none ' +
  'transition-shadow focus:border-blue-600 focus:ring-[3px] focus:ring-blue-100 disabled:bg-dm-sunken disabled:text-dm-ink2';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

/** A label, the control, and a hint or error underneath, wired with ids. */
export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-dm-ink2">
          {label}
        </label>
      )}
      {children({ id, describedBy: error || hint ? noteId : undefined, invalid: !!error })}
      {(error || hint) && (
        <span id={noteId} className={cn('text-[13px]', error ? 'text-dm-red' : 'text-dm-muted')}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(INPUT_BASE, 'h-12', invalid && 'border-dm-red focus:border-dm-red focus:ring-dm-red-bg', className)}
      {...props}
    />
  ),
);
TextInput.displayName = 'TextInput';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(INPUT_BASE, 'block min-h-24 py-3 leading-normal resize-none', invalid && 'border-dm-red', className)}
      {...props}
    />
  ),
);
TextArea.displayName = 'TextArea';

// ─── Surfaces ───────────────────────────────────────────────

export function Card({ flat, className, children }: { flat?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-dm-line p-4', flat ? 'bg-dm-sunken' : 'bg-white', className)}>
      {children}
    </div>
  );
}

export type AlertTone = 'error' | 'warn' | 'info' | 'success';

const ALERT_TONE: Record<AlertTone, { box: string; Icon: typeof Info }> = {
  error: { box: 'bg-dm-red-bg border-dm-red-line text-dm-red', Icon: XCircle },
  warn: { box: 'bg-dm-amber-bg border-dm-amber-line text-dm-amber', Icon: AlertTriangle },
  info: { box: 'bg-blue-50 border-blue-100 text-blue-800', Icon: Info },
  success: { box: 'bg-dm-green-bg border-dm-green-line text-dm-green', Icon: CheckCircle2 },
};

/** What happened (title), how to fix it (children), then an optional action such as the free-setup link. */
export function Alert({
  tone,
  title,
  children,
  action,
  icon,
  className,
}: {
  tone: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Replaces the tone's icon (a spinner for a wait line, a lock for a private link). */
  icon?: ReactNode;
  className?: string;
}) {
  const { box, Icon } = ALERT_TONE[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-[14px] border p-3.5', box, className)}>
      {icon ?? <Icon className="h-5 w-5 flex-none mt-px" aria-hidden="true" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <b className="block text-[15px] font-semibold">{title}</b>}
        {children && <div className="text-sm text-dm-ink2">{children}</div>}
        {action && <div className="mt-1 text-sm">{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block rounded-lg bg-dm-skel animate-pulse', className)} />;
}

// ─── Chips, badges ──────────────────────────────────────────

export type ChipTone = 'ok' | 'miss' | 'neutral' | 'accent';

const CHIP_TONE: Record<ChipTone, string> = {
  ok: 'bg-dm-green-bg text-dm-green',
  miss: 'bg-dm-amber-bg text-dm-amber',
  neutral: 'bg-white border border-dm-line2 text-dm-ink2',
  accent: 'bg-blue-50 text-blue-800',
};

export function Chip({ tone = 'neutral', icon, children, className }: { tone?: ChipTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] text-[13px] font-medium', CHIP_TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** A suggested message or a toggle chip (pass `pressed` for a toggle). */
export function Suggest({ pressed, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'h-10 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-45',
        pressed ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'ok' | 'err'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-[5px] text-xs font-medium leading-none',
        tone === 'ok' ? 'bg-dm-green-bg text-dm-green' : tone === 'err' ? 'bg-dm-red-bg text-dm-red' : 'bg-dm-bubble text-dm-ink2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** «щойно» / «щойно оновлено»: a section or skill that just changed. */
export function NewTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('whitespace-nowrap rounded-md bg-blue-100 px-1.5 py-1 text-[11px] font-semibold leading-none text-blue-800', className)}>
      {children}
    </span>
  );
}

// ─── Step states ────────────────────────────────────────────

export type TickState = 'done' | 'now' | 'todo' | 'skip';

/** The round state mark: done ✓, current and upcoming (numbered), skipped –. */
export function Tick({ state, n, size = 22, className }: { state: TickState; n?: number | string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size > 24 ? 13 : 11 }}
      className={cn(
        'grid flex-none place-items-center rounded-full border-[1.5px] font-semibold leading-none',
        state === 'done' && 'border-dm-green-icon bg-dm-green-icon text-white',
        state === 'skip' && 'border-dm-bubble bg-dm-bubble text-dm-muted',
        state === 'now' && 'border-blue-600 bg-blue-50 text-blue-800',
        state === 'todo' && 'border-dm-line2 text-dm-muted',
        className,
      )}
    >
      {state === 'done' ? (
        <Check className="h-[13px] w-[13px]" strokeWidth={3} />
      ) : state === 'skip' ? (
        <Minus className="h-[13px] w-[13px]" strokeWidth={3} />
      ) : (
        n
      )}
    </span>
  );
}

/** One «Ваш бот уже вміє» row: a step phrased as what the bot can do; clickable when it links to its step. */
export function SkillRow({
  state,
  n,
  label,
  fresh,
  freshLabel,
  current,
  trailing,
  onClick,
}: {
  state: TickState;
  n?: number;
  label: ReactNode;
  /** Just turned done: blue highlight with a «щойно» tag. */
  fresh?: boolean;
  freshLabel?: string;
  current?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Tick state={state} n={n} />
      <span className="min-w-0 flex-1 text-left">{label}</span>
      {fresh && freshLabel && <NewTag>{freshLabel}</NewTag>}
      {trailing}
    </>
  );
  const cls = cn(
    'flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-sm transition-colors',
    state === 'todo' ? 'text-dm-muted' : 'text-dm-ink',
    fresh && 'bg-blue-50',
    current && 'bg-white shadow-[inset_0_0_0_1px_theme(colors.blue.200)]',
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-current={current ? 'step' : undefined} className={cn(cls, 'hover:bg-white')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ─── Choices ────────────────────────────────────────────────

/** A radio card: title (+ badge), description, selected ring. Group them under one `name`. */
export function ChoiceCard({
  name,
  value,
  selected,
  onSelect,
  title,
  badge,
  description,
  className,
}: {
  name: string;
  value: string;
  selected: boolean;
  onSelect: (value: string) => void;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer items-start gap-3 rounded-[14px] border bg-white p-3.5 transition-colors',
        'has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-blue-100',
        selected ? 'border-blue-600 bg-[#FAFCFF] shadow-[0_0_0_1px_theme(colors.blue.600)]' : 'border-dm-line2 hover:border-dm-faint',
        className,
      )}
    >
      <input type="radio" name={name} value={value} checked={selected} onChange={() => onSelect(value)} className="sr-only" />
      <span
        aria-hidden="true"
        className={cn('mt-px grid h-[22px] w-[22px] flex-none place-items-center rounded-full border-[1.5px]', selected ? 'border-blue-600' : 'border-dm-line2')}
      >
        {selected && <span className="h-3 w-3 rounded-full bg-blue-600" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-dm-ink">
          {title}
          {badge}
        </span>
        {description && <span className="text-sm text-dm-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-[46px] flex-none rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-45',
        checked ? 'bg-blue-600' : 'bg-dm-line2',
      )}
    >
      <span className={cn('absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-[left]', checked ? 'left-[21px]' : 'left-[3px]')} />
    </button>
  );
}

/** A square checkbox with its label; `children` is the label text. */
export function CheckRow({
  checked,
  onChange,
  children,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1 has-[:focus-visible]:[&>span:first-of-type]:ring-4 has-[:focus-visible]:[&>span:first-of-type]:ring-blue-100">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span
        aria-hidden="true"
        className={cn(
          'mt-px grid h-6 w-6 flex-none place-items-center rounded-[7px] border-[1.5px] text-white',
          checked ? 'border-blue-600 bg-blue-600' : 'border-dm-line2 bg-white',
        )}
      >
        {checked && <Check className="h-[15px] w-[15px]" strokeWidth={3} />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium text-dm-ink">{children}</span>
        {description && <span className="text-sm text-dm-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Two-way segmented tabs (notes: Чат / Чернетка). A tab can carry a dot: something changed there. */
export function SegTabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ key: K; label: ReactNode; dot?: boolean }>;
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="grid flex-none grid-cols-2 rounded-xl bg-dm-skel p-[3px]">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === value}
          onClick={() => onChange(tab.key)}
          className={cn(
            'inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[10px] text-sm font-medium transition-colors',
            tab.key === value ? 'bg-white text-dm-ink shadow-[0_1px_2px_rgba(18,24,38,.1)]' : 'text-dm-muted',
          )}
        >
          {tab.label}
          {tab.dot && <span className="h-[7px] w-[7px] rounded-full bg-blue-600" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

// ─── Sheet ──────────────────────────────────────────────────

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet on phones (grab handle, rounded top) or a right drawer on
 * desktop. Esc and the scrim close it; focus stays inside while it's open
 * and returns to where it was.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = 'bottom',
  tall,
  header,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name; shown as the heading unless `header` replaces it. */
  title: string;
  side?: 'bottom' | 'right';
  /** Bottom sheet at a fixed 92 % of the screen (chats), instead of fitting its content. */
  tall?: boolean;
  /** A custom header row (avatar, extra buttons); the close button is added after it. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 font-sans">
      <div className="absolute inset-0 bg-[rgba(18,24,38,.45)]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'absolute flex flex-col bg-white outline-none',
          side === 'bottom'
            ? cn('inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[20px] shadow-dm-sheet pb-[env(safe-area-inset-bottom)]', tall && 'h-[92dvh]')
            : 'inset-y-0 right-0 w-[400px] max-w-full border-l border-dm-line shadow-dm-sheet',
          className,
        )}
      >
        {side === 'bottom' && <span className="mx-auto mt-2 block h-1 w-9 flex-none rounded-full bg-dm-line2" aria-hidden="true" />}
        <div className="flex flex-none items-center gap-2 py-1.5 pl-5 pr-2">
          {header ?? <h2 className="flex-1 text-[17px] font-semibold text-dm-ink">{title}</h2>}
          <IconButton label={t('setup_shell.close')} onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
