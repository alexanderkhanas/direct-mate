import { useEffect, useRef, useState } from 'react';
import { Zap, RotateCcw } from 'lucide-react';
import { ScenarioChooser } from './ScenarioChooser';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatInput } from './ChatInput';
import { SCENARIOS } from './scenarios';
import { DisplayedTurn, Turn } from './types';
import './demo.css';

// Timing constants (ms)
const TURN_BASE_DELAY = 400;
const TYPING_DURATION = 1200;
const TYPING_IMAGE_EXTRA = 500;
const LIVE_REPLY_DELAY = 800;

const LIVE_REPLY_TEXT =
  'Live mode coming soon — попробуйте один зі сценаріїв вище 💛';

let turnIdCounter = 0;
const nextId = () => `t${++turnIdCounter}`;

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

  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll message list to bottom on every change.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

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

  const handleSelect = (key: string) => setSelectedKey(key);

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

  const handleLiveSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    const userTurn: Turn = { role: 'user', text };
    setMessages((prev) => [...prev, { ...userTurn, id: nextId() }]);

    // Reuse the same runId semantics so scenario switches still cancel this.
    const myRun = runIdRef.current;
    setTimeout(() => {
      if (runIdRef.current !== myRun) return;
      setIsTyping(true);
    }, 200);
    setTimeout(() => {
      if (runIdRef.current !== myRun) return;
      setIsTyping(false);
      const botTurn: Turn = { role: 'bot', text: LIVE_REPLY_TEXT };
      setMessages((prev) => [...prev, { ...botTurn, id: nextId() }]);
    }, LIVE_REPLY_DELAY);
  };

  return (
    <div className="w-full">
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
              <p className="text-xs text-gray-400 text-center max-w-[220px]">
                Оберіть сценарій зверху, щоб побачити бота в дії
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
        <ChatInput value={input} onChange={setInput} onSend={handleLiveSend} />
      </div>
    </div>
  );
}
