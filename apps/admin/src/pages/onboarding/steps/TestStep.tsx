import { useEffect, useState } from 'react';
import { SlidersHorizontal } from '../../../components/icons';
import { useT } from '../../../i18n';
import { useMediaQuery } from '../../../lib/useMediaQuery';
import { SetupButton, Sheet, StepTitle } from '../../../components/setup/ui';
import { TestChat } from '../../../components/onboarding/TestChat';
import { ToneEditor } from '../../../components/onboarding/ToneEditor';
import { useSetupStep } from '../SetupContext';

/**
 * «Спробуйте бота» (boards m40–m42, d40): the owner writes as a customer in an
 * Instagram-style chat. The tone editor sits in the right panel at ≥1280 px;
 * below that, «Тон» in the chat header opens it in a sheet.
 */
export default function TestStep() {
  const { t } = useT();
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [toneOpen, setToneOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const keyboard = useKeyboardOpen();
  // While the phone keyboard is open, only the composer stays: the footer would squeeze the thread.
  useSetupStep({ layout: 'fill', hideFooter: !desktop && composing && keyboard });

  return (
    <>
      <StepTitle title={t('setup_bot.test_title')} lead={<span className="hidden lg:inline">{t('setup_bot.test_lead')}</span>} />
      <TestChat
        variant="full"
        onComposerFocus={setComposing}
        headerAction={
          <SetupButton variant="secondary" size="sm" onClick={() => setToneOpen(true)} className="xl:hidden">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {t('setup_bot.tone_button')}
          </SetupButton>
        }
        // Full-bleed on phones: cancel the shell's side and bottom padding.
        className="-mx-4 -mb-6 flex-1 border-t border-dm-line lg:mx-0 lg:mb-0 lg:rounded-[20px] lg:border"
      />
      <Sheet open={toneOpen} onClose={() => setToneOpen(false)} title={t('setup_bot.tone_title')} side={desktop ? 'right' : 'bottom'}>
        <div className="flex min-h-0 flex-col overflow-y-auto px-5 pb-5 lg:flex-1">
          <ToneEditor />
        </div>
      </Sheet>
    </>
  );
}

/**
 * The on-screen keyboard is up: the visual viewport is much shorter than the
 * window. Focus alone isn't enough, since Android's back button hides the
 * keyboard without blurring the input.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const onResize = () => setOpen(window.innerHeight - viewport.height > 150);
    viewport.addEventListener('resize', onResize);
    return () => viewport.removeEventListener('resize', onResize);
  }, []);
  return open;
}
