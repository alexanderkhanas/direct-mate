import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Send, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';

// Mirrors apps/api/src/modules/onboarding/store-notes.ts.
const SECTIONS = ['delivery', 'payment', 'returns', 'sizes', 'contacts', 'other'] as const;
type Section = (typeof SECTIONS)[number];

interface NotesDraft {
  sections: Partial<Record<Section, string>>;
  paymentDetails: string | null;
  checkoutFields: string[];
  businessHours: Record<string, string> | null;
  sizingAdvice: 'recommend' | 'consult' | null;
  questions: string[];
  sources: string[];
}

interface ChatMessage {
  role: 'owner' | 'assistant';
  text: string;
}

interface NotesState {
  draft: NotesDraft | null;
  messages: ChatMessage[];
  websiteUrl: string | null;
}

/**
 * «Що знає бот» in setup: AI drafts the notes from the shop's website, a
 * short chat asks only what's missing, and the owner edits and saves.
 */
export function NotesBuilder({ onSaved }: { onSaved?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { data } = useQuery<NotesState>({
    queryKey: ['onboarding-notes'],
    queryFn: () => api.get('/onboarding/notes').then((r) => r.data),
  });
  const [website, setWebsite] = useState('');
  const [draft, setDraft] = useState<NotesDraft | null>(null);
  const [message, setMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data?.websiteUrl && !website) setWebsite(data.websiteUrl);
    if (data?.draft) setDraft(data.draft);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setState = (next: Partial<NotesState>) =>
    qc.setQueryData<NotesState>(['onboarding-notes'], (old) => ({ ...(old ?? { draft: null, messages: [], websiteUrl: null }), ...next }));

  const start = useMutation({
    mutationFn: (websiteUrl: string | null) =>
      api.post('/onboarding/notes/draft', { websiteUrl: websiteUrl || undefined }).then((r) => r.data),
    onSuccess: (res: { draft: NotesDraft; messages: ChatMessage[] }) => {
      setDraft(res.draft);
      setState(res);
    },
  });

  const chat = useMutation({
    mutationFn: async (text: string) => {
      // The owner's own edits go first, so the chat builds on them instead of overwriting them.
      if (draft) await api.post('/onboarding/notes/update', { draft });
      return api.post('/onboarding/notes/chat', { message: text }).then((r) => r.data);
    },
    onMutate: (text) => {
      setState({ messages: [...(data?.messages ?? []), { role: 'owner', text }] });
      setMessage('');
    },
    onSuccess: (res: { draft: NotesDraft; messages: ChatMessage[] }) => {
      setDraft(res.draft);
      setState({ draft: res.draft, messages: res.messages });
    },
  });

  const save = useMutation({
    mutationFn: () => api.post('/onboarding/notes/save', { draft }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-status'] });
      qc.invalidateQueries({ queryKey: ['store-config'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      onSaved?.();
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length, chat.isPending]);

  if (!data) return null;

  if (!draft) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <p className="text-sm text-gray-700">{t('notes.intro')}</p>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://your-shop.com.ua" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => start.mutate(website.trim())} loading={start.isPending} disabled={!website.trim()}>
                {t('notes.draft_from_site')}
              </Button>
              <Button variant="secondary" onClick={() => start.mutate(null)} disabled={start.isPending}>
                {t('notes.no_site')}
              </Button>
            </div>
            {start.isPending && <p className="text-xs text-gray-500">{t('notes.drafting')}</p>}
            {start.isError && <p className="text-xs text-red-600">{t('notes.draft_failed')}</p>}
          </div>
        </div>
      </Card>
    );
  }

  const edit = (patch: Partial<NotesDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col h-[34rem]">
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50 rounded-t-2xl">
          {data.messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'owner' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                  m.role === 'owner' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-900',
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          {chat.isPending && <p className="text-xs text-gray-400 animate-pulse">{t('notes.writing')}</p>}
          {chat.isError && <p className="text-xs text-red-600">{t('notes.chat_failed')}</p>}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 p-3 border-t border-gray-100">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && message.trim() && !chat.isPending && chat.mutate(message.trim())}
            placeholder={t('notes.answer_placeholder')}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <Button size="sm" onClick={() => chat.mutate(message.trim())} loading={chat.isPending} disabled={!message.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Card className="space-y-3 h-[34rem] overflow-y-auto">
        {SECTIONS.map((s) => (
          <Textarea
            key={s}
            label={t(`notes.section_${s}`)}
            rows={draft.sections[s] ? 3 : 2}
            value={draft.sections[s] ?? ''}
            onChange={(e) => edit({ sections: { ...draft.sections, [s]: e.target.value } })}
            placeholder={t('notes.section_empty')}
          />
        ))}
        <Textarea
          label={t('notes.payment_details')}
          rows={3}
          value={draft.paymentDetails ?? ''}
          onChange={(e) => edit({ paymentDetails: e.target.value || null })}
          placeholder={t('notes.payment_details_placeholder')}
        />
        <p className="text-xs text-gray-500">
          {t('notes.more_in_settings')}{' '}
          <Link to="/settings" className="underline text-gray-700">{t('notes.settings_link')}</Link>
        </p>
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={() => save.mutate()} loading={save.isPending}>{t('common.save')}</Button>
          <button className="text-xs text-gray-400 hover:text-gray-700" onClick={() => setDraft(null)}>
            {t('notes.start_over')}
          </button>
          {save.isSuccess && <span className="text-xs text-emerald-600">{t('settings.saved')}</span>}
        </div>
      </Card>
    </div>
  );
}
