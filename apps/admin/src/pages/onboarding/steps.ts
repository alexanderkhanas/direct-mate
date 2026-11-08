/**
 * The setup steps as the owner sees them. The API reports eight steps
 * (onboarding.service.ts); the owner sees six, in three stages: tone is shown
 * inside «Спробуйте AI-агента» and Telegram inside «Увімкнути AI-агента».
 */

export type ApiStepKey = 'products' | 'instagram' | 'knowledge' | 'sizes' | 'test' | 'tone' | 'telegram' | 'live';
export type StepState = 'todo' | 'done' | 'skipped';

// Mirrors apps/api/src/modules/onboarding/onboarding.service.ts.
export interface OnboardingStatus {
  completed: boolean;
  operatingMode: string;
  steps: Array<{ key: ApiStepKey; state: StepState; blocking: boolean }>;
  readiness: { ready: boolean; missing: Array<'instagram' | 'products' | 'knowledge'> };
  store: {
    name: string;
    businessType: string;
    instagram: string | null;
    feedUrl: string | null;
    products: { total: number; inStock: number };
  };
  supportAvailable: boolean;
}

export type OwnerStepKey = 'products' | 'knowledge' | 'sizes' | 'test' | 'instagram' | 'live';
export type StageKey = 'teach' | 'check' | 'launch';

export const STAGES: StageKey[] = ['teach', 'check', 'launch'];

// Instagram comes early, in «Навчання»: its history drafts the notes and the tone. The bot stays off until «live».
const OWNER_STEPS: Array<{ key: OwnerStepKey; stage: StageKey; skippable: boolean }> = [
  { key: 'products', stage: 'teach', skippable: false },
  { key: 'instagram', stage: 'teach', skippable: false },
  { key: 'knowledge', stage: 'teach', skippable: false },
  { key: 'sizes', stage: 'teach', skippable: true },
  { key: 'test', stage: 'check', skippable: true },
  { key: 'live', stage: 'launch', skippable: false },
];

export interface OwnerStep {
  key: OwnerStepKey;
  stage: StageKey;
  state: StepState;
  /** Required before the bot can be turned on. */
  blocking: boolean;
  skippable: boolean;
  /** 1-based position among the steps this store has. */
  n: number;
}

/** The six owner steps (five for a store without sizes), with their state from the API. */
export function ownerSteps(status: OnboardingStatus): OwnerStep[] {
  return OWNER_STEPS.filter((s) => status.steps.some((a) => a.key === s.key)).map((s, i) => {
    const api = status.steps.find((a) => a.key === s.key)!;
    return { ...s, state: api.state, blocking: api.blocking, n: i + 1 };
  });
}

/** The state of any API step, including the folded ones (tone, telegram). */
export function apiState(status: OnboardingStatus, key: ApiStepKey): StepState | null {
  return status.steps.find((s) => s.key === key)?.state ?? null;
}

export function isOwnerStepKey(value: string | null): value is OwnerStepKey {
  return OWNER_STEPS.some((s) => s.key === value);
}

/** Where setup opens: the first step not done yet, else the last one. */
export function firstOpenStep(steps: OwnerStep[]): OwnerStepKey {
  return (steps.find((s) => s.state === 'todo') ?? steps[steps.length - 1]).key;
}

/** The step after `from` that still needs doing, or simply the next one. */
export function nextStep(steps: OwnerStep[], from: OwnerStepKey): OwnerStepKey | null {
  const i = steps.findIndex((s) => s.key === from);
  return (steps.slice(i + 1).find((s) => s.state !== 'done') ?? steps[i + 1])?.key ?? null;
}

export function previousStep(steps: OwnerStep[], from: OwnerStepKey): OwnerStepKey | null {
  const i = steps.findIndex((s) => s.key === from);
  return i > 0 ? steps[i - 1].key : null;
}

export interface StageProgress {
  stage: StageKey;
  steps: OwnerStep[];
  done: number;
  /** The active step is in this stage. */
  current: boolean;
  /** 1-based position of the active step inside the stage, when current. */
  position: number | null;
}

/** Per stage: its steps and how many are done (the 3-segment progress bar, the desktop stage nav). */
export function stageProgress(steps: OwnerStep[], active: OwnerStepKey): StageProgress[] {
  return STAGES.map((stage) => {
    const inStage = steps.filter((s) => s.stage === stage);
    const at = inStage.findIndex((s) => s.key === active);
    return {
      stage,
      steps: inStage,
      done: inStage.filter((s) => s.state === 'done').length,
      current: at >= 0,
      position: at >= 0 ? at + 1 : null,
    };
  });
}

export function doneCount(steps: OwnerStep[]): number {
  return steps.filter((s) => s.state === 'done').length;
}
