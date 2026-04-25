import { useEffect, useRef, useState } from 'react';
import { Zap, RotateCcw } from 'lucide-react';
import type { AxiosError } from 'axios';
import { ScenarioChooser } from './ScenarioChooser';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatInput } from './ChatInput';
import { SCENARIOS } from './scenarios';
import { DisplayedTurn } from './types';
import { publicApi } from '../../lib/publicApi';
import { analytics } from '../../lib/analytics';
import './demo.css';

// Timing constants (ms)
const TURN_BASE_DELAY = 400;
const TYPING_DURATION = 1200;
const TYPING_IMAGE_EXTRA = 500;
const LIVE_MIN_TYPING_MS = 1200;
const LIVE_IMAGE_EXTRA_MS = 500;

let turnIdCounter = 0;
const nextId = () => `t${++turnIdCounter}`;

const generateSessionKey = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

interface DemoApiResponse {
  reply: { text: string; imageUrls?: string[] } | null;
  decision:
    | 'reply'
    | 'handoff'
    | 'create_draft_order'
    | 'noop'
    | 'ask_followup'
    | 'budget_exceeded';
  scenario: string | null;
  isAggregated: boolean;
  handoff: { required: boolean; reason: string | null };
}

interface DemoApiErrorBody {
  error?: { code?: string; message?: string | string[] };
}

export function DemoWidget() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayedTurn[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState('');
  // Re-render trigger for the "reset" link: increment when playback completes.
  const [playbackDone, setPlaybackDone] = useState(false);

  // Cancellation token. Every playback run captures this id; stale timeouts
  // compare before mutating state, so scenario switches cancel cleanly
  // without clearTimeout bookkeeping.
  const runIdRef = useRef(0);

  // Live-mode session — persists for the lifetime of this component instance.
  // Backend reuses the same Conversation row across buffer windows for this key.
  const sessionKeyRef = useRef<string>(generateSessionKey());
  // Stale-response guard: when two POSTs are in-flight for the same session,
  // the backend resolves both with identical payloads. We only render the
  // most recent send's response.
  const liveSendIdRef = useRef(0);

  // 1-based counter — increments only on successful sends (not errors,
  // not budget_exceeded). Powers demo_message_sent.messageIndex.
  const messageIndexRef = useRef(0);

  // Read from sessionStorage at mount so React Strict Mode's double-mount
  // in dev doesn't double-fire demo_live_mode_started.
  const liveModeStartedRef = useRef(
    sessionStorage.getItem('demo_live_mode_started') === '1',
  );

  const widgetRootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll message list to bottom on every change.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  // demo_viewed — IntersectionObserver on the widget root, threshold 0.5,
  // fires after 2s of continuous visibility. Once per session.
  useEffect(() => {
    if (sessionStorage.getItem('demo_viewed_fired') === '1') return;
    const el = widgetRootRef.current;
    if (!el) return;
    let timer: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          if (timer == null) {
            timer = window.setTimeout(() => {
              analytics.demoViewed('landing');
              observer.disconnect();
            }, 2000);
          }
        } else if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      if (timer != null) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Playback engine — triggers on selectedKey change, or explicit restart
  // via `playbackDone` being reset to false below.
  useEffect(() => {
    if (!selectedKey) return;
    const scenario = SCENARIOS.find((s) => s.key === selectedKey);
    if (!scenario) return;

    runIdRef.current += 1;
    const myRun = runIdRef.current;

    setMessages([]);
    setIsTyping(false);
    setPlaybackDone(false);

    let cursor = 0;
    for (const turn of scenario.turns) {
      const appendDelay = TURN_BASE_DELAY + (turn.delayMs ?? 0);
      const extraForImage =
        turn.role === 'bot' && turn.imageUrls?.length ? TYPING_IMAGE_EXTRA : 0;

      if (turn.role === 'user') {
        cursor += appendDelay;
        const t = cursor;
        setTimeout(() => {
          if (runIdRef.current !== myRun) return;
          setMessages((prev) => [...prev, { ...turn, id: nextId() }]);
        }, t);
      } else {
        cursor += appendDelay;
        const tTypingOn = cursor;
        setTimeout(() => {
          if (runIdRef.current !== myRun) return;
          // Handoff banner should not be preceded by a typing indicator —
          // it's a system action, not a "person typing".
          if (!turn.isHandoff) setIsTyping(true);
        }, tTypingOn);

        cursor += TYPING_DURATION + extraForImage;
        const tMessage = cursor;
        setTimeout(() => {
          if (runIdRef.current !== myRun) return;
          setIsTyping(false);
          setMessages((prev) => [...prev, { ...turn, id: nextId() }]);
        }, tMessage);
      }
    }

    // Fire playback-complete after the last scheduled event.
    const completeAt = cursor + 100;
    setTimeout(() => {
      if (runIdRef.current !== myRun) return;
      setPlaybackDone(true);
    }, completeAt);
  }, [selectedKey]);

  const handleSelect = (key: string) => {
    analytics.demoScenarioClicked(key);
    setSelectedKey(key);
  };

  const handleInputChange = (v: string) => {
    setInput(v);
    if (
      !liveModeStartedRef.current &&
      v.length > 0 &&
      selectedKey === null
    ) {
      liveModeStartedRef.current = true;
      sessionStorage.setItem('demo_live_mode_started', '1');
      analytics.demoLiveModeStarted();
    }
  };

  const handleRestart = () => {
    // Bump runId, then re-trigger the effect by setting key to null then back.
    // Using a distinct "replay" counter is cleaner, but this is 1 line.
    runIdRef.current += 1;
    setMessages([]);
    setIsTyping(false);
    setPlaybackDone(false);
    // Force the effect to re-run by clearing + restoring the selection.
    const key = selectedKey;
    setSelectedKey(null);
    // setTimeout 0 defers until after the null commit so the effect re-fires.
    setTimeout(() => setSelectedKey(key), 0);
  };

  // Exit scenario mode → return to live typing. Cancels any in-progress
  // playback (runIdRef bump invalidates pending timeouts) and clears messages
  // so the user starts fresh in live mode.
  const handleExitScenario = () => {
    runIdRef.current += 1;
    setMessages([]);
    setIsTyping(false);
    setPlaybackDone(false);
    setSelectedKey(null);
  };

  const handleLiveSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    // Capture this bubble's id so we can pop it on a 400 too_long response
    // (the server rejected the message; we shouldn't leave it rendered as if
    // it had been sent).
    const userBubbleId = nextId();
    setMessages((prev) => [...prev, { role: 'user', text, id: userBubbleId }]);
    setIsTyping(true);

    const sendId = ++liveSendIdRef.current;
    const sendStart = Date.now();

    try {
      const { data } = await publicApi.post<DemoApiResponse>('/demo/message', {
        sessionKey: sessionKeyRef.current,
        text,
      });

      if (sendId !== liveSendIdRef.current) return;

      const elapsed = Date.now() - sendStart;
      const extra = data.reply?.imageUrls?.length ? LIVE_IMAGE_EXTRA_MS : 0;
      const minDelay = LIVE_MIN_TYPING_MS + extra;
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed));
      }
      if (sendId !== liveSendIdRef.current) return;

      setIsTyping(false);

      if (data.decision === 'budget_exceeded') {
        analytics.demoErrorReceived('budget_exceeded');
        setMessages((prev) => [
          ...prev,
          {
            role: 'bot',
            text: 'Demo тимчасово перевантажений, спробуйте за хвилину 💛',
            id: nextId(),
          },
        ]);
        return;
      }

      // Successful send — increment counter and emit analytics. Errors
      // and budget_exceeded above don't tick this (they fire demo_error_received).
      messageIndexRef.current += 1;
      analytics.demoMessageSent(messageIndexRef.current, data.isAggregated);

      if (data.handoff?.required) {
        setMessages((prev) => [
          ...prev,
          ...(data.reply?.text
            ? [{ role: 'bot' as const, text: data.reply.text, id: nextId() }]
            : []),
          {
            role: 'bot' as const,
            text: 'Розмову передано оператору',
            isHandoff: true,
            id: nextId(),
          },
        ]);
      } else if (data.reply?.text) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'bot' as const,
            text: data.reply!.text,
            imageUrls: data.reply!.imageUrls,
            aggregatedHint: data.isAggregated,
            id: nextId(),
          },
        ]);
      }
      // 'noop' / null reply → render nothing, drop typing
    } catch (err) {
      if (sendId !== liveSendIdRef.current) return;
      setIsTyping(false);

      const axiosErr = err as AxiosError<DemoApiErrorBody>;
      const status = axiosErr.response?.status;
      const errBody = axiosErr.response?.data?.error;
      const errCode = errBody?.code;
      const errMessage = errBody?.message;
      const messageMatches = (needle: string) =>
        Array.isArray(errMessage)
          ? errMessage.includes(needle)
          : typeof errMessage === 'string' && errMessage.includes(needle);

      if (status === 400 && errCode === 'VALIDATION_ERROR' && messageMatches('too_long')) {
        analytics.demoErrorReceived('too_long');
        // Atomic update: drop the optimistic user bubble AND append the bot
        // bubble in one setMessages call so the user never sees a flicker
        // where their bubble is removed before the bot reply appears.
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userBubbleId),
          {
            role: 'bot',
            text: 'Повідомлення занадто довге, спробуйте коротше',
            id: nextId(),
          },
        ]);
        return;
      }

      if (status === 429 && errCode === 'RATE_LIMITED') {
        analytics.demoErrorReceived('rate_limit');
        const retryAfterRaw = axiosErr.response?.headers?.['retry-after'];
        const retryAfter = retryAfterRaw ? parseInt(String(retryAfterRaw), 10) : 3600;
        const minutes = Math.max(1, Math.ceil(retryAfter / 60));
        setMessages((prev) => [
          ...prev,
          {
            role: 'bot',
            text: `Забагато повідомлень — спробуйте за ${minutes} хв 💛`,
            id: nextId(),
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'Спробуйте ще раз 💛', id: nextId() },
      ]);
      console.error('demo send failed', err);
    }
  };

  return (
    <div ref={widgetRootRef} className="w-full">
      <ScenarioChooser
        scenarios={SCENARIOS}
        selectedKey={selectedKey}
        onSelect={handleSelect}
      />

      <div className="w-full max-w-[420px] md:max-w-[600px] mx-auto rounded-3xl border border-gray-200 bg-white shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-gray-100">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-pink-400 via-purple-500 to-indigo-500 flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 truncate">StyleBoutique UA</p>
            <p className="text-[11px] text-gray-400">Відповідає через DirectMate</p>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3 bg-white min-h-[320px] max-h-[520px]"
        >
          {messages.length === 0 && !isTyping && (
            <div className="h-full flex items-center justify-center">
              <p className="text-xs text-gray-400 text-center max-w-[260px]">
                Напишіть повідомлення нижче або оберіть готовий сценарій зверху
              </p>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} turn={m} />
          ))}
          {isTyping && <TypingIndicator />}
          {playbackDone && selectedKey && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={handleRestart}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Пройти знову
              </button>
            </div>
          )}
        </div>

        {/* Input */}
        {selectedKey ? (
          <div className="px-3.5 pt-2 text-center">
            <button
              type="button"
              onClick={handleExitScenario}
              className="text-[11px] text-gray-500 hover:text-gray-900 transition-colors"
            >
              ← Повернутись до живого чату
            </button>
          </div>
        ) : (
          <p className="text-[11px] italic text-gray-400 px-3.5 pt-2 text-center">
            💬 Можете писати кілька повідомлень — бот зачекає поки ви закінчите
          </p>
        )}
        <ChatInput
          value={input}
          onChange={handleInputChange}
          onSend={handleLiveSend}
          disabled={selectedKey !== null}
        />
      </div>
    </div>
  );
}
