import { useEffect, useReducer, useState } from 'react';
import { Check, ChevronDown, Info, RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { usePlural } from '../../lib/plural';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { Chip, IconButton, Sheet, SkillRow, type TickState } from '../setup/ui';
import { useSetup } from '../../pages/onboarding/SetupContext';
import { apiState, type OwnerStepKey } from '../../pages/onboarding/steps';
import { Avatar, TestChat, useResetTestChat, useTestChatWaiting } from './TestChat';
import { ToneEditor } from './ToneEditor';

// ─── Skills: the steps, phrased as what the bot can do (Handoff §5) ──────

const STEP_SKILLS = ['products', 'knowledge', 'sizes', 'test', 'tone', 'instagram', 'telegram'] as const;
type StepSkill = (typeof STEP_SKILLS)[number];
type SkillKey = 'account' | StepSkill;

/** Where each skill's row leads: tone is set on the test step, Telegram on the go-live step. */
const SKILL_STEP: Record<StepSkill, OwnerStepKey> = {
  products: 'products',
  knowledge: 'knowledge',
  sizes: 'sizes',
  test: 'test',
  tone: 'test',
  instagram: 'instagram',
  telegram: 'live',
};

interface Skill {
  key: SkillKey;
  label: string;
  state: TickState;
  done: boolean;
  /** The step this row opens; none for the account row. */
  step?: OwnerStepKey;
  n?: number;
  current: boolean;
  fresh: boolean;
}

const FRESH_MS = 4000;

/**
 * Which skills were done when last seen, and until when each new one shows
 * «щойно». Module scope, so it survives remounts: the panel, the drawer and
 * the sheet are separate trees and must agree.
 */
const seen = { store: null as string | null, done: new Set<SkillKey>(), freshUntil: new Map<SkillKey, number>() };

/** The skills that turned done in the last ~4 s. The first status seen for a store only sets the baseline. */
function useFreshSkills(store: string, done: SkillKey[]): Set<SkillKey> {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const now = Date.now();
  if (seen.store !== store) {
    seen.store = store;
    seen.freshUntil.clear();
  } else {
    for (const key of done) if (!seen.done.has(key)) seen.freshUntil.set(key, now + FRESH_MS);
  }
  seen.done = new Set(done);

  const live = [...seen.freshUntil].filter(([, until]) => until > now);
  const nextExpiry = live.length ? Math.min(...live.map(([, until]) => until)) : null;
  useEffect(() => {
    if (nextExpiry === null) return;
    const id = window.setTimeout(rerender, nextExpiry - Date.now() + 50);
    return () => window.clearTimeout(id);
  }, [nextExpiry]);
  return new Set(live.map(([key]) => key));
}

function useSkills(): Skill[] {
  const { t } = useT();
  const plural = usePlural();
  const { status, steps, active } = useSetup();
  const present = STEP_SKILLS.filter((key) => apiState(status, key) !== null);
  const fresh = useFreshSkills(
    status.store.name,
    present.filter((key) => apiState(status, key) === 'done'),
  );

  const label = (key: StepSkill, done: boolean): string => {
    if (!done) return t(`setup_bot.skill_${key}_todo`);
    if (key === 'products') return plural(status.store.products.total, 'setup_bot.skill_products');
    if (key === 'instagram' && status.store.instagram) return t('setup_bot.skill_instagram', { handle: status.store.instagram });
    if (key === 'instagram') return t('setup_bot.skill_instagram_plain');
    return t(`setup_bot.skill_${key}`);
  };

  const rows = present.map((key): Skill => {
    const state = apiState(status, key);
    const step = SKILL_STEP[key];
    const done = state === 'done';
    const current = step === active;
    return {
      key,
      label: label(key, done),
      state: done ? 'done' : current ? 'now' : state === 'skipped' ? 'skip' : 'todo',
      done,
      step,
      n: steps.find((s) => s.key === step)?.n,
      current,
      fresh: fresh.has(key),
    };
  });

  return [
    { key: 'account', label: t('setup_bot.skill_account', { name: status.store.name }), state: 'done', done: true, current: false, fresh: false },
    ...rows,
  ];
}

function SkillList({ skills, onNavigate, className }: { skills: Skill[]; onNavigate?: () => void; className?: string }) {
  const { t } = useT();
  const { goTo } = useSetup();
  return (
    <div className={cn('flex flex-none flex-col gap-0.5', className)}>
      {skills.map((skill) => (
        <SkillRow
          key={skill.key}
          state={skill.state}
          n={skill.n}
          label={skill.label}
          fresh={skill.fresh}
          freshLabel={t('setup_bot.fresh')}
          current={skill.current}
          onClick={
            skill.step
              ? () => {
                  goTo(skill.step!);
                  onNavigate?.();
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}

function SkillsHeading({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <h2 className="text-[17px] font-semibold leading-[1.3] text-dm-ink">{t('setup_bot.skills_title')}</h2>
      <span className="text-[13px] text-dm-muted">{t('setup_bot.skills_hint')}</span>
    </div>
  );
}

/** The live test chat in its rounded box, filling what the skills list leaves. */
function PanelChat() {
  const { t } = useT();
  return (
    <div className="mx-4 mb-4 mt-3 flex min-h-[280px] flex-1 flex-col">
      <TestChat title={t('setup_bot.try_title')} className="flex-1 rounded-[18px] border border-dm-line" />
    </div>
  );
}

// ─── The panel, the drawer and the sheet ───────────────────────────────

/**
 * «Ваш бот» beside the step at ≥1280 px: the skills list (it doubles as step
 * navigation) and the live test chat. On the test step, where the chat is the
 * step itself, the panel holds the tone editor instead (board d40).
 */
export function BotPanel() {
  const { active } = useSetup();
  // Before the width check, so «щойно» transitions are tracked while the panel is hidden.
  const skills = useSkills();
  const wide = useMediaQuery('(min-width: 1280px)');
  if (!wide) return null;

  if (active === 'test') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        <ToneEditor withTitle />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SkillsHeading className="flex-none px-5 pb-2 pt-5" />
      <SkillList skills={skills} className="px-2.5 pt-1" />
      <PanelChat />
    </div>
  );
}

/**
 * «Ваш бот» on demand: a bottom sheet on phones (board m04: a skills summary
 * above the chat), or the panel's skills and chat as a right drawer at
 * 1024–1279 px.
 */
export function BotSheet({ open, onClose, side }: { open: boolean; onClose: () => void; side: 'bottom' | 'right' }) {
  const { t } = useT();
  const skills = useSkills();

  if (side === 'right') {
    return (
      <Sheet open={open} onClose={onClose} title={t('setup_bot.skills_title')} side="right" header={<SkillsHeading className="flex-1 py-2" />}>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-dm-line bg-dm-sunken pt-2">
          <SkillList skills={skills} onNavigate={onClose} className="px-2.5" />
          <PanelChat />
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('setup_bot.sheet_title')} side="bottom" tall header={<SheetHeader />}>
      <SkillsSummary skills={skills} onNavigate={onClose} />
      <TestChat hideHeader threadNote={<KnowledgeHint onNavigate={onClose} />} className="flex-1" />
    </Sheet>
  );
}

function SheetHeader() {
  const { t } = useT();
  const { status } = useSetup();
  const reset = useResetTestChat();
  const waiting = useTestChatWaiting();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <Avatar name={status.store.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="text-[15px] font-semibold leading-tight text-dm-ink">{t('setup_bot.sheet_title')}</h2>
        <span className="truncate text-xs leading-snug text-dm-muted">{t('setup_bot.sheet_sub')}</span>
      </div>
      <IconButton label={t('setup_bot.sheet_reset')} onClick={() => reset.mutate()} disabled={reset.isPending || waiting}>
        <RotateCcw className="h-5 w-5" />
      </IconButton>
    </div>
  );
}

/** «Уже вміє 2 з 7»: chips when collapsed, the full clickable list when open. */
function SkillsSummary({ skills, onNavigate }: { skills: Skill[]; onNavigate: () => void }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const counted = skills.filter((s) => s.key !== 'account');
  const done = counted.filter((s) => s.done);
  return (
    <div className="flex flex-none flex-col gap-2 border-b border-dm-line px-4 pb-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="-mt-1 flex min-h-11 items-center gap-1 self-start text-[13px] font-medium text-dm-muted"
      >
        {t('setup_bot.skills_count', { done: done.length, total: counted.length })}
        <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
      </button>
      {expanded ? (
        <SkillList skills={skills} onNavigate={onNavigate} className="-mx-2 max-h-[40dvh] overflow-y-auto" />
      ) : (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {[...done, ...counted.filter((s) => !s.done)].map((s) => (
            <Chip key={s.key} tone={s.done ? 'ok' : 'neutral'} icon={s.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : undefined}>
              {s.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** In the sheet's thread while the store notes are missing: delivery questions go to a manager until then. */
function KnowledgeHint({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useT();
  const { status, active, goTo } = useSetup();
  if (apiState(status, 'knowledge') === 'done' || active === 'knowledge') return null;
  return (
    <button
      type="button"
      onClick={() => {
        goTo('knowledge');
        onNavigate();
      }}
      className="mt-1.5 flex flex-none items-start gap-2.5 self-stretch rounded-xl bg-blue-50 px-3 py-2.5 text-left text-[13px] text-blue-800 hover:bg-blue-100"
    >
      <Info className="mt-px h-4 w-4 flex-none" aria-hidden="true" />
      <span>
        {t('setup_bot.knowledge_hint')} <span className="underline underline-offset-2">{t('setup_bot.knowledge_hint_go')}</span>
      </span>
    </button>
  );
}
