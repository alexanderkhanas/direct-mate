import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Send,
  RotateCcw,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { cn } from '../lib/cn';
import { TraceTab } from '../components/conversation/TraceTab';

// --- Types -----------------------------------------------------------

interface LinkedMedia {
  instagramMediaId: string;
  mediaType: string;
  productTitle: string;
}

interface LiveResult {
  conversationId: string;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  classification: Record<string, unknown> | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  extraReplies: Array<{ text: string; imageUrls?: string[] }>;
  imageUrls?: string[];
  state: Record<string, unknown>;
  trace: string[];
}

interface Bubble {
  from: 'you' | 'bot';
  text: string;
  imageUrls?: string[];
  mediaBadge?: string; // e.g. "story_reply" on the user's message
  // Only on the primary bot bubble of a turn:
  meta?: {
    decision: string;
    scenario: string | null;
    classification: Record<string, unknown> | null;
    state: Record<string, unknown>;
    trace: string[];
  };
}

type MediaMode = 'none' | 'story' | 'photo';

// --- Bot-turn detail (collapsible trace / classification / state) ----

function BotMeta({ meta }: { meta: NonNullable<Bubble['meta']> }) {
  const [open, setOpen] = useState<'trace' | 'class' | 'state' | null>(null);
  const toggle = (k: 'trace' | 'class' | 'state') =>
    setOpen((cur) => (cur === k ? null : k));

  const Section = ({
    k,
    label,
    count,
  }: {
    k: 'trace' | 'class' | 'state';
    label: string;
    count?: number;
  }) => (
    <button
      onClick={() => toggle(k)}
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
    >
      {open === k ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
      {label}
      {count != null && <span className="text-gray-400">({count})</span>}
    </button>
  );

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.decision === 'handoff' ? 'handoff' : 'active'}>
          {meta.decision}
        </Badge>
        {meta.scenario && <Badge variant="default">{meta.scenario}</Badge>}
        <Section k="class" label="classification" />
        <Section k="state" label="state" />
        <Section k="trace" label="trace" count={meta.trace.length} />
      </div>
      {open === 'trace' && (
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-gray-900 p-2 text-[11px] leading-relaxed text-gray-100">
          {meta.trace.map((l, i) => `${String(i + 1).padStart(2, ' ')}. ${l}`).join('\n')}
        </pre>
      )}
      {open === 'class' && (
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-gray-50 p-2 text-[11px] text-gray-700">
          {JSON.stringify(meta.classification, null, 2)}
        </pre>
      )}
      {open === 'state' && (
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-gray-50 p-2 text-[11px] text-gray-700">
          {JSON.stringify(meta.state, null, 2)}
        </pre>
      )}
    </div>
  );
}

// --- Main console ----------------------------------------------------

export default function LiveDmConsole() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState('');
  const [mediaMode, setMediaMode] = useState<MediaMode>('none');
  const [storyMediaId, setStoryMediaId] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Linked media for the story-reply picker
  const { data: media } = useQuery<LinkedMedia[]>({
    queryKey: ['live-media'],
    queryFn: () => api.get('/testing/simulator/live/media').then((r) => r.data),
  });

  // Rehydrate the persisted thread on mount
  useEffect(() => {
    api
      .get('/testing/simulator/live')
      .then((r) => {
        setConversationId(r.data?.conversationId ?? null);
        const msgs = (r.data?.messages ?? []) as Array<{ role: string; text: string | null }>;
        setBubbles(
          msgs
            .filter((m) => m.text)
            .map((m) => ({
              from: m.role === 'user' ? 'you' : 'bot',
              text: m.text as string,
            })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles]);

  const buildMediaReference = (): { mediaId: string; type: string } | undefined => {
    if (mediaMode === 'story' && storyMediaId) {
      return { mediaId: storyMediaId, type: 'story_reply' };
    }
    if (mediaMode === 'photo' && photoUrl.trim()) {
      return { mediaId: photoUrl.trim(), type: 'customer_photo' };
    }
    return undefined;
  };

  const send = async () => {
    const mediaReference = buildMediaReference();
    if (!text.trim() && !mediaReference) return;
    setBusy(true);
    setError(null);

    // Optimistic user bubble
    setBubbles((b) => [
      ...b,
      {
        from: 'you',
        text: text.trim() || '(media only)',
        mediaBadge: mediaReference?.type,
      },
    ]);
    const sentText = text;
    setText('');

    try {
      const { data } = await api.post<LiveResult>('/testing/simulator/live/message', {
        text: sentText,
        mediaReference,
      });
      setConversationId(data.conversationId);
      const botBubbles: Bubble[] = [];
      if (data.replyText) {
        botBubbles.push({
          from: 'bot',
          text: data.replyText,
          imageUrls: data.imageUrls,
          meta: {
            decision: data.decision,
            scenario: data.scenario,
            classification: data.classification,
            state: data.state,
            trace: data.trace,
          },
        });
      }
      for (const extra of data.extraReplies ?? []) {
        botBubbles.push({ from: 'bot', text: extra.text, imageUrls: extra.imageUrls });
      }
      if (botBubbles.length === 0) {
        botBubbles.push({
          from: 'bot',
          text: `(${data.decision}, no reply text)`,
          meta: {
            decision: data.decision,
            scenario: data.scenario,
            classification: data.classification,
            state: data.state,
            trace: data.trace,
          },
        });
      }
      setBubbles((b) => [...b, ...botBubbles]);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await api.post('/testing/simulator/live/reset');
      setBubbles([]);
      setConversationId(null);
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Instagram DM console</h2>
          <Badge variant="pending">superadmin</Badge>
        </div>
        <Button variant="ghost" onClick={reset} disabled={busy}>
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Drives the reply engine like a real inbound DM (media included) against the
        tenant you're logged in as. No message is sent to Meta.
      </p>

      {/* Thread */}
      <div
        ref={scrollRef}
        className="h-96 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2"
      >
        {bubbles.length === 0 && (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            No messages yet — send one below.
          </div>
        )}
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={cn('flex', b.from === 'you' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                b.from === 'you'
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-200 text-gray-900',
              )}
            >
              {b.mediaBadge && (
                <div className="mb-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                    <ImageIcon className="h-3 w-3" /> {b.mediaBadge}
                  </span>
                </div>
              )}
              <div className="whitespace-pre-wrap">{b.text}</div>
              {b.imageUrls && b.imageUrls.length > 0 && (
                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  {b.imageUrls.slice(0, 4).map((u, j) => (
                    <img
                      key={j}
                      src={u}
                      alt=""
                      className="rounded-md object-cover w-full h-20"
                    />
                  ))}
                </div>
              )}
              {b.meta && <BotMeta meta={b.meta} />}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-white border border-gray-200 px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}
      </div>

      {/* Media controls */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-medium text-gray-600">Attach:</span>
        {(['none', 'story', 'photo'] as MediaMode[]).map((m) => (
          <label key={m} className="inline-flex items-center gap-1 text-xs text-gray-700">
            <input
              type="radio"
              name="media-mode"
              checked={mediaMode === m}
              onChange={() => setMediaMode(m)}
            />
            {m === 'none' ? 'none' : m === 'story' ? 'story reply' : 'customer photo'}
          </label>
        ))}
        {mediaMode === 'story' && (
          <select
            value={storyMediaId}
            onChange={(e) => setStoryMediaId(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white max-w-xs"
          >
            <option value="">select a linked post/story…</option>
            {media?.map((m) => (
              <option key={m.instagramMediaId} value={m.instagramMediaId}>
                {m.productTitle} · {m.mediaType} · {m.instagramMediaId.slice(0, 10)}…
              </option>
            ))}
          </select>
        )}
        {mediaMode === 'photo' && (
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="image URL (a catalog image matches deterministically)"
            className="flex-1 min-w-[16rem] border border-gray-300 rounded-lg px-2 py-1 text-xs"
          />
        )}
      </div>

      {/* Composer */}
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!busy) send();
            }
          }}
          rows={2}
          placeholder="Type a customer message…  (Enter to send, Shift+Enter for newline)"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <Button onClick={send} disabled={busy} loading={busy}>
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}

      {/* Full engine traces for this sim conversation — reuses the same
          "Copy as markdown" export as the Conversations page. */}
      {conversationId && (
        <div className="mt-5 border-t border-gray-200 pt-4">
          <TraceTab conversationId={conversationId} />
        </div>
      )}
    </Card>
  );
}
