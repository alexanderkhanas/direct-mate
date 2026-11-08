import { useEffect, useRef } from 'react';
import { Loader2, Send, Sparkle } from 'lucide-react';
import { useT } from '../../../i18n';
import { cn } from '../../../lib/cn';
import { Alert } from '../../setup/ui';
import { SetUpForMeButton } from '../SetUpForMeButton';
import type { NotesMessage } from './draft';

/**
 * The owner's chat with the DirectMate assistant about their store notes
 * (boards m22, d20). Deliberately unlike the Instagram-style test chat: here
 * the owner talks to us, not to a customer. The thread scrolls inside and the
 * composer stays at the bottom.
 */
export function NotesChat({
  messages,
  pending,
  failed,
  message,
  onMessage,
  onSend,
  onFocusChange,
  visible,
}: {
  messages: NotesMessage[];
  /** Waiting for the assistant's answer. */
  pending: boolean;
  failed: boolean;
  message: string;
  onMessage: (text: string) => void;
  onSend: () => void;
  /** The composer gained or lost focus (the phone keyboard opens with it). */
  onFocusChange: (focused: boolean) => void;
  /** Below xl only one of chat and draft shows; at xl both always do. */
  visible: boolean;
}) {
  const { t } = useT();
  const threadRef = useRef<HTMLDivElement>(null);
  const canSend = !!message.trim() && !pending;

  // A hidden thread loses its scroll position, so this runs again when the tab comes back.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages.length, pending, visible]);

  return (
    <section
      aria-label={t('setup_notes.chat_label')}
      className={cn(
        visible ? 'flex' : 'hidden',
        'min-h-0 flex-1 flex-col lg:overflow-hidden lg:rounded-[18px] lg:border lg:border-dm-line lg:bg-white xl:flex',
      )}
    >
      <div ref={threadRef} aria-live="polite" className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pt-1 lg:bg-dm-sunken lg:p-[18px]">
        {/* mt-auto keeps a short thread at the bottom without breaking scroll for a long one. */}
        <div className="mt-auto flex flex-col gap-2.5">
          <span className="flex items-center gap-1.5 text-xs text-dm-muted">
            <Sparkle className="h-4 w-4" aria-hidden="true" />
            {t('setup_notes.assistant')}
          </span>
          {messages.map((m, i) => (
            <p
              key={i}
              className={cn(
                'whitespace-pre-wrap break-words px-[13px] py-2.5 text-[15px]',
                m.role === 'owner'
                  ? 'max-w-[82%] self-end rounded-[16px_16px_6px_16px] bg-dm-ink text-white'
                  : 'max-w-[88%] self-start rounded-[16px_16px_16px_6px] border border-dm-line bg-white text-dm-ink',
              )}
            >
              {m.text}
            </p>
          ))}
          {pending && (
            <span className="inline-flex items-center gap-2 text-[13px] text-dm-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('setup_notes.writing')}
            </span>
          )}
        </div>
      </div>

      {failed && (
        <Alert
          tone="error"
          title={t('setup_notes.chat_failed')}
          action={<SetUpForMeButton look="inline" step="knowledge" />}
          className="mb-2 flex-none lg:mx-3 lg:mt-3"
        >
          {t('setup_notes.chat_failed_text')}
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSend();
        }}
        className="flex flex-none items-center gap-1.5 pt-1 lg:border-t lg:border-dm-line lg:bg-white lg:px-3 lg:py-2.5"
      >
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-full border border-dm-line2 bg-white px-3.5 transition-shadow focus-within:border-blue-600 focus-within:ring-[3px] focus-within:ring-blue-100">
          <input
            value={message}
            onChange={(e) => onMessage(e.target.value)}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            aria-label={t('setup_notes.answer_label')}
            placeholder={t('setup_notes.answer_placeholder')}
            maxLength={2000}
            autoComplete="off"
            enterKeyHint="send"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-dm-ink outline-none placeholder:text-dm-muted"
          />
        </div>
        <button
          type="submit"
          aria-label={t('setup_notes.send')}
          title={t('setup_notes.send')}
          disabled={!canSend}
          // Keep focus (and the phone keyboard) in the field, so the layout doesn't jump under the tap.
          onMouseDown={(e) => e.preventDefault()}
          className="grid h-11 w-11 flex-none place-items-center rounded-full bg-dm-ink text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-45"
        >
          <Send className="h-5 w-5" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
