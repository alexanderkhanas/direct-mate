import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ImagePlus, RotateCcw, X } from '../icons';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n';
import { Alert, IconButton, SetupButton, Skeleton, Suggest } from '../setup/ui';
import { useOptionalSetup } from '../../pages/onboarding/SetupContext';
import { storeInitial } from '../../pages/onboarding/SetupShell';
import { apiState } from '../../pages/onboarding/steps';

interface ChatMessage {
  role: 'customer' | 'bot';
  text: string;
  imageUrls?: string[];
  /** ISO time, from the API's history. */
  createdAt?: string;
}

interface ChatData {
  messages: ChatMessage[];
}

const CHAT_KEY = ['test-chat'];
const SEND_KEY = ['test-chat', 'send'];

/**
 * When this browser started the conversation: the «Сьогодні 14:32» marker
 * until the history (with the API's times) is reloaded. Module scope, so the
 * panel, the sheet and the test step agree.
 */
let startedAt: number | null = null;

/** «Почати заново»: clears the shared test conversation. Used by the chat header and the bot sheet's header. */
export function useResetTestChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/onboarding/test-chat/reset'),
    onSuccess: () => {
      startedAt = null;
      qc.setQueryData<ChatData>(CHAT_KEY, { messages: [] });
      void qc.invalidateQueries({ queryKey: CHAT_KEY });
    },
  });
}

/** A reply is on its way, from any instance: a message sent from the sheet still shows as typing in the panel. */
export function useTestChatWaiting(): boolean {
  return useIsMutating({ mutationKey: SEND_KEY }) > 0;
}

type ChatError = 'reply' | 'limit' | 'photo' | 'reset';

// Keeps focus (and the phone keyboard) in the composer when a send button or chip is tapped.
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * The owner's test conversation, styled as an Instagram DM: the owner writes
 * as a customer (blue, right), the real agent answers (grey, left). One
 * conversation (`['test-chat']`) shared by the «Ваш бот» panel, the bot sheet
 * and the test step. It fills its container; the thread scrolls inside.
 */
export function TestChat({
  variant = 'compact',
  title,
  hideHeader,
  headerAction,
  threadNote,
  onComposerFocus,
  className,
}: {
  /** `full`: the test step (roomier, «Надіслати» on desktop). `compact`: the panel and the sheets. */
  variant?: 'full' | 'compact';
  /** The header name; the store's Instagram handle, else its name, by default. */
  title?: string;
  /** The bot sheet shows its own header instead. */
  hideHeader?: boolean;
  /** Extra header buttons before «Почати заново» (the test step's «Тон»). */
  headerAction?: ReactNode;
  /** A note after the messages (the bot sheet's «Про доставку бот навчиться…»). */
  threadNote?: ReactNode;
  /** The composer gained or lost focus: the test step hides the footer while the phone keyboard is open. */
  onComposerFocus?: (focused: boolean) => void;
  className?: string;
}) {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const setup = useOptionalSetup();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const full = variant === 'full';

  const storeName = setup?.status.store.name ?? '';
  const handle = setup?.status.store.instagram ?? storeName;

  const { data, isLoading } = useQuery<ChatData>({
    queryKey: CHAT_KEY,
    queryFn: () => api.get('/onboarding/test-chat').then((r) => r.data),
  });
  const messages = data?.messages ?? [];
  const waiting = useTestChatWaiting();

  const send = useMutation({
    mutationKey: SEND_KEY,
    mutationFn: (body: { text: string; photoUrl?: string }) =>
      api.post<{ messages: ChatMessage[] }>('/onboarding/test-chat/message', body).then((r) => r.data),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: CHAT_KEY });
      // Show the customer's message straight away; the reply takes 5–10 s. Like the API, a photo is its own message.
      const outgoing: ChatMessage[] = [
        ...(body.photoUrl ? [{ role: 'customer' as const, text: '', imageUrls: [body.photoUrl] }] : []),
        ...(body.text ? [{ role: 'customer' as const, text: body.text }] : []),
      ];
      qc.setQueryData<ChatData>(CHAT_KEY, (old) => {
        if (!old?.messages.length) startedAt = Date.now();
        return { messages: [...(old?.messages ?? []), ...outgoing] };
      });
      setText('');
      setPhoto(null);
      setError(null);
    },
    onSuccess: (reply) => {
      qc.setQueryData<ChatData>(CHAT_KEY, (old) => ({ messages: [...(old?.messages ?? []), ...reply.messages] }));
      void qc.invalidateQueries({ queryKey: CHAT_KEY });
      // The first message marks the store as tested.
      if (setup && apiState(setup.status, 'test') !== 'done') void setup.refresh();
    },
    onError: (err: any, body) => {
      const limited = err?.response?.status === 429;
      setError(limited ? 'limit' : 'reply');
      // Over the limit the message wasn't saved: give the text back so it isn't lost.
      if (limited) setText((current) => current || body.text);
      void qc.invalidateQueries({ queryKey: CHAT_KEY });
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<{ url: string }>('/onboarding/test-chat/photo', form).then((r) => r.data.url);
    },
    onMutate: () => setError(null),
    onSuccess: (url) => setPhoto(url),
    onError: () => setError('photo'),
  });

  const reset = useResetTestChat();
  const resetChat = () => {
    setError(null);
    setPhoto(null);
    reset.mutate(undefined, { onError: () => setError('reset') });
  };

  const scrollToBottom = (smooth: boolean) => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // New messages, the typing bubble, an error or a photo bring the thread to the bottom; the first load jumps there.
  const rendered = useRef(false);
  useEffect(() => {
    scrollToBottom(rendered.current);
    rendered.current = messages.length > 0;
  }, [messages.length, waiting, !!error, !!photo]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSend = (!!text.trim() || !!photo) && !waiting && !upload.isPending;
  const submit = (value = text) => {
    const trimmed = value.trim();
    if ((!trimmed && !photo) || waiting || upload.isPending) return;
    send.mutate({ text: trimmed, ...(photo && { photoUrl: photo }) });
  };

  const firstAt = messages[0]?.createdAt ? Date.parse(messages[0].createdAt) : startedAt;
  const time = firstAt && messages.length > 0 ? chatTime(firstAt, lang, t) : null;
  const suggestions = [t('setup_bot.try_1'), t('setup_bot.try_2'), t('setup_bot.try_3')];
  const bubbleWidth = full ? 'max-w-[80%] lg:max-w-[60%]' : 'max-w-[80%]';

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden bg-white', className)}>
      {!hideHeader && (
        <div className="flex flex-none items-center gap-2.5 border-b border-dm-line py-2 pl-3.5 pr-1.5">
          <Avatar name={storeName} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold leading-tight text-dm-ink">{title ?? handle}</span>
            <span className="text-xs leading-snug text-dm-muted">{t('setup_bot.chat_sub')}</span>
          </div>
          {headerAction}
          {full && (
            <SetupButton variant="ghost" size="sm" onClick={resetChat} disabled={reset.isPending || waiting} className="hidden lg:inline-flex">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('setup_bot.reset')}
            </SetupButton>
          )}
          <IconButton label={t('setup_bot.reset')} onClick={resetChat} disabled={reset.isPending || waiting} className={full ? 'lg:hidden' : undefined}>
            <RotateCcw className="h-5 w-5" />
          </IconButton>
        </div>
      )}

      <div
        ref={threadRef}
        role="log"
        aria-live="polite"
        aria-label={t('setup_bot.thread_label')}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto',
          full ? 'px-3.5 py-3.5 lg:px-5 lg:py-[18px]' : 'px-3.5 pb-3 pt-3.5',
        )}
      >
        {isLoading ? (
          <div className="mt-auto flex flex-col gap-1.5" aria-hidden="true">
            <Skeleton className="h-10 w-1/2 self-end rounded-[20px]" />
            <Skeleton className="h-16 w-2/3 rounded-[20px]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            {full && (
              <>
                <Avatar name={storeName} large />
                <span className="mt-1.5 text-[17px] font-semibold leading-tight text-dm-ink">{storeName}</span>
              </>
            )}
            <p className="max-w-[280px] text-sm text-dm-muted">{t('setup_bot.empty')}</p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <Suggest key={s} onMouseDown={keepFocus} onClick={() => submit(s)} disabled={upload.isPending}>
                  {s}
                </Suggest>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Pushes a short conversation to the bottom while keeping a long one scrollable. */}
            <span className="mt-auto" aria-hidden="true" />
            {time && <span className="my-1.5 self-center text-xs text-dm-muted">{time}</span>}
            {messages.map((m, i) => (
              <Message key={i} message={m} bubbleWidth={bubbleWidth} full={full} onImageLoad={() => atBottom.current && scrollToBottom(false)} />
            ))}
            {waiting && (
              <span role="img" aria-label={t('setup_bot.typing')} className="flex flex-none gap-[5px] self-start rounded-[20px] bg-dm-bubble px-3.5 py-[13px]">
                {[0, 150, 300].map((delay) => (
                  <i key={delay} className="block h-[7px] w-[7px] animate-pulse rounded-full bg-dm-faint" style={{ animationDelay: `${delay}ms` }} />
                ))}
              </span>
            )}
            {threadNote}
          </>
        )}
      </div>

      {error && (
        <div className="flex-none px-3 pb-1 pt-2">
          <Alert tone="error" title={t(`setup_bot.error_${error}_title`)}>
            {t(`setup_bot.error_${error}_text`)}
          </Alert>
        </div>
      )}

      {(photo || upload.isPending) && (
        <div className="flex flex-none px-3 pt-3">
          {photo ? (
            <span className="relative">
              <img src={photo} alt={t('setup_bot.your_photo')} className="h-14 w-14 rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label={t('setup_bot.remove_photo')}
                className="absolute -right-4 -top-4 grid h-11 w-11 place-items-center"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-dm-ink text-white">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>
            </span>
          ) : (
            <Skeleton className="h-14 w-14 rounded-xl" />
          )}
        </div>
      )}

      <div className={cn('flex flex-none items-center gap-1.5 border-t border-dm-line bg-white py-2 pl-2 pr-2.5', full && 'lg:px-3 lg:py-2.5')}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <div className="flex h-12 min-w-0 flex-1 items-center gap-0.5 rounded-full border border-dm-line2 px-0.5 transition-shadow focus-within:border-blue-600 focus-within:ring-[3px] focus-within:ring-blue-100">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending || waiting}
            aria-label={t('setup_bot.attach')}
            title={t('setup_bot.attach')}
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-dm-ink2 hover:bg-dm-bubble disabled:opacity-45"
          >
            <ImagePlus className="h-5 w-5" aria-hidden="true" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onFocus={() => onComposerFocus?.(true)}
            onBlur={() => onComposerFocus?.(false)}
            maxLength={1000}
            enterKeyHint="send"
            placeholder={t('setup_bot.placeholder')}
            aria-label={t('setup_bot.message_label')}
            className="min-w-0 flex-1 bg-transparent text-base text-dm-ink outline-none placeholder:text-dm-muted"
          />
          {canSend && (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={() => submit()}
              aria-label={t('setup_bot.send')}
              className={cn('grid h-11 w-11 flex-none place-items-center', full && 'lg:hidden')}
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-600 text-white">
                <ArrowUp className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
            </button>
          )}
        </div>
        {full && (
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => submit()}
            disabled={!canSend}
            className="hidden h-11 flex-none px-2.5 text-[15px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-45 lg:inline-block"
          >
            {t('setup_bot.send')}
          </button>
        )}
      </div>
    </div>
  );
}

function Message({
  message,
  bubbleWidth,
  full,
  onImageLoad,
}: {
  message: ChatMessage;
  bubbleWidth: string;
  full: boolean;
  onImageLoad: () => void;
}) {
  const { t } = useT();
  const mine = message.role === 'customer';
  const images = message.imageUrls ?? [];
  return (
    <>
      {images.length > 0 &&
        (mine ? (
          <img
            src={images[0]}
            alt={t('setup_bot.your_photo')}
            onLoad={onImageLoad}
            className="max-h-64 w-[45%] max-w-[220px] flex-none self-end rounded-2xl bg-dm-bubble object-cover"
          />
        ) : (
          // Instagram delivers the photos before the text; at most four, two per row.
          <div className={cn('grid w-[72%] flex-none grid-cols-2 gap-1 self-start', full && 'lg:max-w-[300px]')}>
            {images.slice(0, 4).map((url) => (
              <img key={url} src={url} alt={t('setup_bot.bot_photo')} onLoad={onImageLoad} className="aspect-[4/5] w-full rounded-2xl bg-dm-bubble object-cover" />
            ))}
          </div>
        ))}
      {message.text && (
        <span
          className={cn(
            'flex-none whitespace-pre-wrap break-words rounded-[20px] px-[13px] py-[9px] text-[15px] leading-[1.38]',
            bubbleWidth,
            mine ? 'self-end rounded-br-md bg-blue-600 text-white' : 'self-start rounded-bl-md bg-dm-bubble text-dm-ink',
          )}
        >
          {message.text}
        </span>
      )}
    </>
  );
}

/** The store's round initial, as the chat's avatar. */
export function Avatar({ name, large }: { name: string; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid flex-none place-items-center rounded-full bg-blue-100 font-semibold text-blue-800',
        large ? 'h-[76px] w-[76px] text-[30px]' : 'h-9 w-9 text-[15px]',
      )}
    >
      {storeInitial(name)}
    </span>
  );
}

/** «Сьогодні 14:32», or the date when the conversation started on another day. */
function chatTime(at: number, lang: 'uk' | 'en', t: (key: string, params?: Record<string, string | number>) => string): string {
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
  const date = new Date(at);
  const clock = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return t('setup_bot.today_at', { time: clock });
  return `${date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })} ${clock}`;
}
