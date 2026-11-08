import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SetupButtonVariant } from '../../components/setup/ui';
import type { OnboardingStatus, OwnerStep, OwnerStepKey } from './steps';

/** The Instagram login's result, read once from `?instagram=connected|error&reason=…` when Meta sends the owner back. */
export interface InstagramOAuthReturn {
  ok: boolean;
  /** The callback's reason code (integrations.controller.ts); null when connected. */
  reason: string | null;
}

/** Everything a step needs from the shell: the status, navigation, and a way to refresh. */
export interface SetupContextValue {
  status: OnboardingStatus;
  steps: OwnerStep[];
  active: OwnerStepKey;
  current: OwnerStep;
  goTo: (key: OwnerStepKey) => void;
  /** To the next step that still needs doing (refreshes the status first). */
  goNext: () => void;
  goBack: () => void;
  /** Re-read GET /onboarding/status, e.g. after an import or a save. */
  refresh: () => Promise<void>;
  /** Skip the active step (optional steps only) and move on. */
  skip: () => void;
  skipping: boolean;
  /** Set right after the Instagram login, for the Instagram step to show what happened. */
  oauth: InstagramOAuthReturn | null;
}

const SetupContext = createContext<SetupContextValue | null>(null);

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext);
  if (!ctx) throw new Error('useSetup() outside the setup shell');
  return ctx;
}

/** The setup context, or null outside setup (Catalog, Settings): shared panels then render their own buttons. */
export function useOptionalSetup(): SetupContextValue | null {
  return useContext(SetupContext);
}

// ─── The step's footer ──────────────────────────────────────

export interface SetupAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** brand by default; `blocked` = what's left, and pressing it goes there. */
  variant?: Extract<SetupButtonVariant, 'brand' | 'blocked' | 'secondary' | 'dark'>;
}

export interface StepConfig {
  /** The step's one primary action. Leave undefined for «Далі»; null for none (show `hint` instead). */
  primary?: SetupAction | null;
  /** A second action left of the primary («Спершу поспостерігати»). */
  secondary?: SetupAction | null;
  /** Footer text when there is no primary («Оберіть, звідки взяти товари»). */
  hint?: string;
  /** Show «Пропустити». Default: the step is optional and not done yet. */
  skip?: boolean;
  /** Show the back button. Default: true, except on the first step. */
  back?: boolean;
  /** Override what «Назад» does (an inner screen going back to the step's start). */
  onBack?: () => void;
  /** `fill`: the step manages its own scrolling (chats fill the space between header and composer). */
  layout?: 'scroll' | 'fill';
  /** Desktop content width: 720 px (default) or 1000 px (notes: chat beside the draft). */
  width?: 'narrow' | 'wide';
  /** Hide the footer, e.g. while the phone keyboard is open in a chat. */
  hideFooter?: boolean;
}

export interface StepConfigSlot {
  config: React.MutableRefObject<StepConfig>;
  version: number;
}

const StepConfigContext = createContext<{ set: (slot: StepConfigSlot | null) => void } | null>(null);

/**
 * A step hands its footer (one primary action, skip, back) and layout to the
 * shell. Call it on every render; handlers are read when clicked, so they can
 * close over fresh state.
 */
export function useSetupStep(config: StepConfig): void {
  const ctx = useContext(StepConfigContext);
  const ref = useRef(config);
  ref.current = config;
  // Re-render the footer only when something visible changes, not on every new handler.
  const key = JSON.stringify(config, (_k, v) => (typeof v === 'function' ? true : v));
  const version = useRef(0);
  useLayoutEffect(() => {
    version.current += 1;
    ctx?.set({ config: ref, version: version.current });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => ctx?.set(null), []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Used by the shell: holds the active step's config. */
export function StepConfigProvider({ children }: { children: (slot: StepConfigSlot | null) => ReactNode }) {
  const [slot, setSlot] = useState<StepConfigSlot | null>(null);
  const setter = useRef({ set: setSlot }).current;
  return (
    <StepConfigContext.Provider value={setter}>{children(slot)}</StepConfigContext.Provider>
  );
}

export function SetupProvider({ value, children }: { value: SetupContextValue; children: ReactNode }) {
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}
