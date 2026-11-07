import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, RotateCcw, Send } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';

interface ChatMessage {
  role: 'customer' | 'bot';
  text: string;
  imageUrls?: string[];
}

/**
 * «Спробуйте свого бота»: the owner writes as a customer and sees the real
 * answers — photos, prices, an order — before turning the bot on. Nothing
 * reaches customers, and these chats stay out of the inbox and orders.
 */
export function OwnerTestChat({ onMessage }: { onMessage?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<{ messages: ChatMessage[] }>({
    queryKey: ['test-chat'],
    queryFn: () => api.get('/onboarding/test-chat').then((r) => r.data),
  });
  const messages = data?.messages ?? [];

  const send = useMutation({
    mutationFn: (body: { text: string; photoUrl?: string }) =>
      api.post('/onboarding/test-chat/message', body).then((r) => r.data),
    onMutate: (body) => {
      // Show the customer's message straight away; the bot's answer takes a few seconds.
      qc.setQueryData<{ messages: ChatMessage[] }>(['test-chat'], (old) => ({
        messages: [...(old?.messages ?? []), { role: 'customer', text: body.text, ...(body.photoUrl && { imageUrls: [body.photoUrl] }) }],
      }));
      setText('');
      setPhoto(null);
      setError('');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['test-chat'] });
      onMessage?.();
    },
    onError: (err: any) => {
      setError(err?.response?.status === 429 ? t('setup.test_too_many') : t('setup.test_failed'));
      qc.invalidateQueries({ queryKey: ['test-chat'] });
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<{ url: string }>('/onboarding/test-chat/photo', form).then((r) => r.data.url);
    },
    onSuccess: (url) => setPhoto(url),
    onError: () => setError(t('setup.test_photo_failed')),
  });

  const reset = useMutation({
    mutationFn: () => api.post('/onboarding/test-chat/reset'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['test-chat'] }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, send.isPending]);

  const submit = (value = text) => {
    if ((!value.trim() && !photo) || send.isPending) return;
    send.mutate({ text: value.trim(), ...(photo && { photoUrl: photo }) });
  };

  const suggestions = [t('setup.try_1'), t('setup.try_2'), t('setup.try_3')];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <p className="text-xs text-gray-500">{t('setup.test_hint')}</p>
        <button
          onClick={() => reset.mutate()}
          className="text-xs text-gray-400 hover:text-gray-700 inline-flex items-center gap-1"
          disabled={reset.isPending}
        >
          <RotateCcw className="h-3 w-3" />
          {t('setup.test_reset')}
        </button>
      </div>

      <div className="h-96 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-400"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'customer' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
                m.role === 'customer' ? 'bg-violet-600 text-white' : 'bg-white border border-gray-200 text-gray-900',
              )}
            >
              {m.imageUrls && m.imageUrls.length > 0 && (
                <div className="grid grid-cols-2 gap-1 mb-1">
                  {m.imageUrls.slice(0, 4).map((url) => (
                    <img key={url} src={url} alt="" className="rounded-lg object-cover h-28 w-full" />
                  ))}
                </div>
              )}
              {m.text}
            </div>
          </div>
        ))}
        {send.isPending && <p className="text-xs text-gray-400 animate-pulse">{t('setup.test_typing')}</p>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pt-2 text-xs text-red-600">{error}</p>}
      {photo && <img src={photo} alt="" className="mx-4 mt-2 h-14 w-14 rounded-lg object-cover" />}
      <div className="flex items-center gap-2 p-3 border-t border-gray-100">
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
        <button
          onClick={() => fileRef.current?.click()}
          className="text-gray-400 hover:text-gray-700"
          aria-label={t('setup.test_attach')}
          disabled={upload.isPending}
        >
          <ImagePlus className="h-5 w-5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('setup.test_placeholder')}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <Button size="sm" onClick={() => submit()} loading={send.isPending} disabled={!text.trim() && !photo}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
