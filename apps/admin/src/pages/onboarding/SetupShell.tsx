import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, MessageCircle, X } from '../../components/icons';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { usePlural } from '../../lib/plural';
import { IconButton, Sheet, SetupButton, StepTitle, Tick, type TickState } from '../../components/setup/ui';
import { SetUpForMeButton } from '../../components/onboarding/SetUpForMeButton';
import { BotPanel, BotSheet } from '../../components/onboarding/BotPanel';
import { StepConfigProvider, useSetup, useSetupStep, type StepConfig, type StepConfigSlot } from './SetupContext';
import { doneCount, stageProgress, type OwnerStep, type OwnerStepKey } from './steps';
import ProductsStep from './steps/ProductsStep';
import NotesStep from './steps/NotesStep';
import SizesStep from './steps/SizesStep';
import TestStep from './steps/TestStep';
import InstagramStep from './steps/InstagramStep';
import LiveStep from './steps/LiveStep';

// Imported, not lazy: the steps are small, and a lazy chunk gone after a deploy would blank the page.
const STEP_COMPONENTS: Record<OwnerStepKey, ComponentType> = {
  products: ProductsStep,
  knowledge: NotesStep,
  sizes: SizesStep,
  test: TestStep,
  instagram: InstagramStep,
  live: LiveStep,
};

/**
 * The setup frame (design boards m02–m04, d10). One tree for every width, so a
 * step mounts once:
 *   < 1024 px  phone: top bar, 3-segment progress, step line → steps sheet,
 *              sticky footer, «Спробувати бота» pill → bot sheet
 *   1024–1279  desktop top bar with stages; «Ваш бот» opens as a right drawer
 *   ≥ 1280     the 400 px «Ваш бот» panel beside the step
 */
export function SetupShell({ intro, onIntroDone, skipFailed }: { intro: boolean; onIntroDone: () => void; skipFailed: boolean }) {
  const { t } = useT();
  const { active } = useSetup();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [botOpen, setBotOpen] = useState<false | 'bottom' | 'right'>(false);
  const Step = STEP_COMPONENTS[active];
  // The page doesn't scroll, this container does: back to the top on every step.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [active, intro]);

  return (
    <StepConfigProvider>
      {(slot) => {
        const config: StepConfig = slot?.config.current ?? {};
        const fill = !intro && config.layout === 'fill';
        // The pill would cover a chat's composer, or a two-row footer's buttons; those steps go without it.
        const showPill = !intro && active !== 'test' && !fill && !config.hideFooter && !config.secondary;
        return (
          <div className="flex h-[100dvh] flex-col bg-dm-bg font-sans text-[15px] leading-[1.45] text-dm-ink antialiased">
            <MobileTopBar />
            <MobileProgress />
            <DesktopTopBar onOpenBot={() => setBotOpen('right')} />

            <div className="flex min-h-0 flex-1">
              <main className="flex min-w-0 flex-1 flex-col">
                <div ref={scrollRef} className={cn('min-h-0 flex-1', fill ? 'flex flex-col' : 'overflow-y-auto')}>
                  <div
                    className={cn(
                      'mx-auto flex w-full flex-col gap-4 px-4 pt-4 lg:gap-5 lg:px-12 lg:pb-8 lg:pt-10',
                      showPill ? 'pb-20' : 'pb-6',
                      config.width === 'wide' ? 'lg:max-w-[1096px]' : 'lg:max-w-[816px]',
                      fill && 'min-h-0 flex-1',
                    )}
                  >
                    {intro ? (
                      <Intro onDone={onIntroDone} />
                    ) : (
                      <>
                        <StepLine onOpen={() => setStepsOpen(true)} />
                        <Step />
                      </>
                    )}
                  </div>
                </div>
                <Footer slot={slot} skipFailed={skipFailed} />
              </main>

              <aside aria-label={t('setup_shell.your_bot')} className="hidden w-[400px] flex-none flex-col border-l border-dm-line bg-dm-sunken xl:flex">
                <BotPanel />
              </aside>
            </div>

            {showPill && <TryBotPill onClick={() => setBotOpen('bottom')} />}
            <StepsSheet open={stepsOpen} onClose={() => setStepsOpen(false)} />
            <BotSheet open={botOpen !== false} side={botOpen === 'right' ? 'right' : 'bottom'} onClose={() => setBotOpen(false)} />
          </div>
        );
      }}
    </StepConfigProvider>
  );
}

// ─── Top bars and progress ──────────────────────────────────

function MobileTopBar() {
  const { t } = useT();
  const navigate = useNavigate();
  const { active } = useSetup();
  return (
    <header className="flex h-[60px] flex-none items-center gap-2 bg-white pl-1.5 pr-3 lg:hidden">
      <IconButton label={t('setup_shell.exit')} onClick={() => navigate('/')}>
        <X className="h-5 w-5" />
      </IconButton>
      <SetUpForMeButton step={active} look="pill" className="ml-auto" />
    </header>
  );
}

function MobileProgress() {
  const { steps, active } = useSetup();
  return (
    <div className="flex flex-none gap-1 bg-white px-4 pb-3 lg:hidden" aria-hidden="true">
      {stageProgress(steps, active).map((p) => (
        <span key={p.stage} style={{ flex: p.steps.length }} className="relative block h-1 overflow-hidden rounded-sm bg-dm-line">
          <i className="absolute inset-y-0 left-0 block rounded-sm bg-blue-600" style={{ width: segmentFill(p.done, p.steps.length, p.current) }} />
        </span>
      ))}
    </div>
  );
}

/** Share of a stage segment to fill; the current stage shows a sliver even before its first step is done. */
function segmentFill(done: number, total: number, current: boolean): string {
  const share = total > 0 ? (done / total) * 100 : 0;
  return `${current ? Math.max(share, 8) : share}%`;
}

function DesktopTopBar({ onOpenBot }: { onOpenBot: () => void }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { steps, active, goTo } = useSetup();
  return (
    <header className="hidden h-16 flex-none items-center gap-6 border-b border-dm-line bg-white pl-6 pr-5 lg:flex">
      <div className="flex flex-none items-center gap-2.5 text-[15px] font-semibold xl:w-[260px]">
        <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-blue-600 text-white" aria-hidden="true">
          <MessageCircle className="h-4 w-4" />
        </span>
        DirectMate
      </div>
      <nav aria-label={t('setup_shell.stages_label')} className="flex min-w-0 flex-1 justify-center gap-4 xl:gap-6">
        {stageProgress(steps, active).map((p) => {
          const allDone = p.done === p.steps.length;
          const target = p.steps.find((s) => s.state !== 'done') ?? p.steps[0];
          return (
            <button
              key={p.stage}
              type="button"
              onClick={() => target && goTo(target.key)}
              aria-current={p.current ? 'step' : undefined}
              className={cn(
                'flex min-w-0 max-w-40 flex-1 flex-col gap-[7px] text-left text-[13px] font-medium leading-tight',
                p.current ? 'text-dm-ink' : 'text-dm-muted',
              )}
            >
              <span>
                {t(`setup_shell.stage_${p.stage}`)}
                {(p.current || allDone) && (
                  <small className="text-xs font-normal text-dm-muted">
                    {' · '}
                    {p.current && p.steps.length > 1
                      ? t('setup_shell.stage_progress', { n: p.position ?? 1, total: p.steps.length })
                      : allDone
                        ? t('setup_shell.stage_done')
                        : t('setup_shell.now')}
                  </small>
                )}
              </span>
              <span className="relative block h-1 overflow-hidden rounded-sm bg-dm-line">
                <i className="absolute inset-y-0 left-0 block bg-blue-600" style={{ width: segmentFill(p.done, p.steps.length, p.current) }} />
              </span>
            </button>
          );
        })}
      </nav>
      <div className="flex flex-none items-center justify-end gap-2">
        <SetUpForMeButton step={active} look="pill" short />
        <SetupButton variant="secondary" size="sm" onClick={onOpenBot} className="xl:hidden">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t('setup_shell.your_bot')}
        </SetupButton>
        <SetupButton variant="ghost" size="sm" onClick={() => navigate('/')}>
          {t('setup_shell.exit_short')}
        </SetupButton>
      </div>
    </header>
  );
}

/** «Крок 2 з 6 · Навчання»: on phones it opens the steps sheet; on desktop it's a plain eyebrow. */
function StepLine({ onOpen }: { onOpen: () => void }) {
  const { t } = useT();
  const { steps, current } = useSetup();
  const text = t('setup_shell.step_line', { n: current.n, total: steps.length, stage: t(`setup_shell.stage_${current.stage}`) });
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${text}. ${t('setup_shell.step_line_open')}`}
        className="-mb-2 -mt-2.5 inline-flex items-center gap-1 self-start py-3 text-[13px] font-medium leading-none text-blue-800 lg:hidden"
      >
        {text}
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="hidden text-sm font-medium text-blue-800 lg:-mb-3 lg:block">{text}</span>
    </>
  );
}

// ─── Footer ─────────────────────────────────────────────────

function Footer({ slot, skipFailed }: { slot: StepConfigSlot | null; skipFailed: boolean }) {
  const { t } = useT();
  const { steps, current, goNext, goBack, skip, skipping } = useSetup();
  const config: StepConfig = slot?.config.current ?? {};
  if (config.hideFooter) return null;

  // Handlers are read at click time, so a step's fresh closures are used.
  const latest = () => slot?.config.current ?? {};
  const primary =
    config.primary === undefined
      ? { label: t('setup_shell.next'), onClick: goNext }
      : config.primary;
  const showSkip = config.skip ?? (current.skippable && current.state !== 'done');
  const showBack = config.onBack ? true : (config.back ?? true) && steps[0]?.key !== current.key;
  const back = () => (latest().onBack ?? goBack)();

  return (
    <footer className="relative z-[2] flex-none bg-white shadow-dm-up lg:border-t lg:border-dm-line lg:shadow-none">
      <div
        className={cn(
          'mx-auto flex w-full items-center gap-2 px-4 pt-3 lg:px-12 lg:py-3.5',
          // With a second row below (narrow phones), that row takes the safe-area inset.
          config.secondary ? 'pb-3 sm:pb-[calc(12px+env(safe-area-inset-bottom))]' : 'pb-[calc(12px+env(safe-area-inset-bottom))]',
          config.width === 'wide' ? 'lg:max-w-[1096px]' : 'lg:max-w-[816px]',
        )}
      >
        {showBack ? (
          <>
            <IconButton label={t('setup_shell.back')} outline onClick={back} className="lg:hidden">
              <ChevronLeft className="h-5 w-5" />
            </IconButton>
            <SetupButton variant="ghost" onClick={back} className="hidden lg:inline-flex">
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              {t('setup_shell.back')}
            </SetupButton>
          </>
        ) : null}
        <span className="hidden flex-1 lg:block" />
        {showSkip && (
          <SetupButton variant="ghost" onClick={skip} loading={skipping}>
            {t('setup_shell.skip')}
          </SetupButton>
        )}
        {config.secondary && (
          <SetupButton
            variant="secondary"
            size="lg"
            onClick={() => latest().secondary?.onClick()}
            loading={config.secondary.loading}
            disabled={config.secondary.disabled}
            className="hidden sm:inline-flex"
          >
            {config.secondary.label}
          </SetupButton>
        )}
        {primary ? (
          <SetupButton
            variant={primary.variant ?? 'brand'}
            size="lg"
            grow
            onClick={() => (config.primary === undefined ? goNext() : latest().primary?.onClick())}
            loading={primary.loading}
            disabled={primary.disabled}
            className="lg:flex-none"
          >
            <span className="truncate">{primary.label}</span>
          </SetupButton>
        ) : (
          config.hint && <span className="flex-1 text-center text-[13px] text-dm-muted lg:flex-none">{config.hint}</span>
        )}
      </div>
      {config.secondary && (
        // On narrow phones the secondary action sits on its own line under the primary.
        <div className="px-4 pb-[calc(12px+env(safe-area-inset-bottom))] sm:hidden">
          <SetupButton
            variant="secondary"
            block
            onClick={() => latest().secondary?.onClick()}
            loading={config.secondary.loading}
            disabled={config.secondary.disabled}
          >
            {config.secondary.label}
          </SetupButton>
        </div>
      )}
      {skipFailed && <p className="px-4 pb-2 text-center text-[13px] text-dm-red">{t('setup_shell.skip_failed')}</p>}
    </footer>
  );
}

/** «Спробувати бота»: floats above the footer on phones, on every step except the test step. */
function TryBotPill({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  const { status } = useSetup();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ bottom: 'calc(88px + env(safe-area-inset-bottom))' }}
      className="fixed right-4 z-[3] inline-flex h-11 items-center gap-2.5 rounded-full bg-dm-ink pl-1.5 pr-4 text-sm font-medium text-white shadow-dm lg:hidden"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-[13px] font-semibold" aria-hidden="true">
        {storeInitial(status.store.name)}
      </span>
      {t('setup_shell.try_bot')}
    </button>
  );
}

export function storeInitial(name: string): string {
  return (name.trim()[0] ?? 'D').toUpperCase();
}

// ─── Sheets and screens ─────────────────────────────────────

function StepsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const plural = usePlural();
  const { steps, active, status, goTo } = useSetup();
  return (
    <Sheet open={open} onClose={onClose} title={t('setup_shell.steps_sheet')}>
      <p className="px-5 pb-1.5 text-sm text-dm-muted">{t('setup_shell.progress', { done: doneCount(steps), total: steps.length })}</p>
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5">
        {stageProgress(steps, active).map((p) => (
          <div key={p.stage} className="flex flex-col">
            <span className="px-2.5 pb-1 pt-3.5 text-[13px] font-semibold text-dm-muted">{t(`setup_shell.stage_${p.stage}`)}</span>
            {p.steps.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-current={s.key === active ? 'step' : undefined}
                onClick={() => {
                  goTo(s.key);
                  onClose();
                }}
                className={cn(
                  'flex min-h-[52px] items-center gap-3 rounded-xl px-2.5 text-left text-[15px] text-dm-ink',
                  s.key === active ? 'bg-blue-50 font-medium' : 'hover:bg-dm-sunken',
                )}
              >
                <Tick state={tickState(s, active)} n={s.n} />
                <span className="flex-1">{t(`setup_shell.step_${s.key}`)}</span>
                <small className="text-xs font-normal text-dm-muted">{stepMeta(s, active, status.store.products.total, t, plural)}</small>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex-none border-t border-dm-line px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
        <SetUpForMeButton step={active} look="inline" lead={t('setup_shell.stuck')} label={t('setup_shell.help_stuck')} />
      </div>
    </Sheet>
  );
}

export function tickState(step: OwnerStep, active: OwnerStepKey): TickState {
  if (step.state === 'done') return 'done';
  if (step.key === active) return 'now';
  if (step.state === 'skipped') return 'skip';
  return 'todo';
}

function stepMeta(
  step: OwnerStep,
  active: OwnerStepKey,
  products: number,
  t: (key: string, params?: Record<string, string | number>) => string,
  plural: (n: number, keyBase: string) => string,
): string {
  if (step.key === 'products' && step.state === 'done' && products > 0) return plural(products, 'setup_shell.products');
  if (step.key === active) return t('setup_shell.now');
  if (step.state === 'skipped') return t('setup_shell.skipped');
  if (step.skippable && step.state !== 'done') return t('setup_shell.can_skip');
  return '';
}

/** First visit (m02): what's ahead, that nothing reaches customers yet, and the free-setup offer. */
function Intro({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { status } = useSetup();
  useSetupStep({ primary: { label: t('setup_shell.intro_start'), onClick: onDone }, back: false, skip: false });
  const stages: Array<{ key: 'teach' | 'check' | 'launch'; text: string }> = [
    { key: 'teach', text: t('setup_shell.intro_teach') },
    { key: 'check', text: t('setup_shell.intro_check') },
    { key: 'launch', text: t('setup_shell.intro_launch') },
  ];
  return (
    <div className="flex flex-col gap-[22px] pt-3 lg:pt-0">
      <StepTitle eyebrow={t('setup_shell.intro_hello', { store: status.store.name })} title={t('setup_shell.intro_title')} lead={t('setup_shell.intro_lead')} />
      <ol className="flex flex-col rounded-2xl border border-dm-line bg-white">
        {stages.map((s, i) => (
          <li key={s.key} className={cn('flex gap-3.5 px-4 py-3.5', i < stages.length - 1 && 'border-b border-dm-line')}>
            <Tick state={i === 0 ? 'now' : 'todo'} n={i + 1} size={28} />
            <div className="flex min-w-0 flex-col gap-1">
              <b className="text-base font-semibold">{t(`setup_shell.stage_${s.key}`)}</b>
              <span className="text-sm text-dm-muted">{s.text}</span>
            </div>
          </li>
        ))}
      </ol>
      <span className="flex items-center gap-2 text-sm text-dm-green">
        <Tick state="done" size={20} />
        {t('setup_shell.intro_account', { store: status.store.name })}
      </span>
      <SetUpForMeButton look="card" />
    </div>
  );
}
