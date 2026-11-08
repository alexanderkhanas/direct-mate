import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import type { ManagerExample, TenantSettings } from '../../types';
import { Alert, Field, IconButton, SectionTitle, SetupButton, Skeleton, Suggest, TextArea } from '../setup/ui';
import { useOptionalSetup } from '../../pages/onboarding/SetupContext';

/** The quick toggles; each adds or removes its phrase (`setup_bot.tone_<key>_phrase`) in the tone text. */
const TONE_CHIPS = ['vy', 'ty', 'short', 'emoji', 'warm', 'business'] as const;
type ToneChip = (typeof TONE_CHIPS)[number];
const EXCLUSIVE: Partial<Record<ToneChip, ToneChip>> = { vy: 'ty', ty: 'vy' };

function withPhrase(text: string, phrase: string): string {
  const base = text.trim();
  return base ? `${base} ${phrase}` : phrase;
}

function withoutPhrase(text: string, phrase: string): string {
  return text.replace(` ${phrase}`, '').replace(phrase, '').trim();
}

/**
 * «Як звучить бот»: the store's tone (quick toggles plus free text) and the
 * owner's example replies. Shown in the desktop panel on the test step and in
 * a sheet opened from «Тон». The tone saves with its own button, not the
 * step's primary; examples save as they're added.
 */
export function ToneEditor({
  withTitle,
}: {
  /** Show the heading (the desktop panel); a sheet already has one. */
  withTitle?: boolean;
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const setup = useOptionalSetup();

  const settings = useQuery<TenantSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data),
  });
  const saved = settings.data?.brandTonePrompt ?? '';
  // null until the owner edits: the field shows the saved tone.
  const [draft, setDraft] = useState<string | null>(null);
  const tone = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  const save = useMutation({
    mutationFn: (brandTone: string) => api.patch('/settings', { brandTone }),
    onSuccess: (_res, brandTone) => {
      qc.setQueryData<TenantSettings>(['settings'], (old) => (old ? { ...old, brandTonePrompt: brandTone } : old));
      void qc.invalidateQueries({ queryKey: ['settings'] });
      // Keep anything typed while the save was on its way.
      setDraft((current) => (current === null || current.trim() === brandTone ? null : current));
      // The API counts the tone step done once the tone differs from the default.
      void setup?.refresh();
    },
  });

  const edit = (next: string) => {
    if (!save.isPending) save.reset();
    setDraft(next);
  };

  const toggle = (chip: ToneChip) => {
    const phrase = t(`setup_bot.tone_${chip}_phrase`);
    if (tone.includes(phrase)) {
      edit(withoutPhrase(tone, phrase));
      return;
    }
    const other = EXCLUSIVE[chip];
    edit(withPhrase(other ? withoutPhrase(tone, t(`setup_bot.tone_${other}_phrase`)) : tone, phrase));
  };

  return (
    <div className="flex flex-1 flex-col gap-3.5">
      {withTitle ? (
        <div className="flex flex-col gap-1">
          <SectionTitle>{t('setup_bot.tone_title')}</SectionTitle>
          <p className="text-sm text-dm-muted">{t('setup_bot.tone_lead')}</p>
        </div>
      ) : (
        <p className="text-sm text-dm-muted">{t('setup_bot.tone_lead')}</p>
      )}

      {settings.isError ? (
        <Alert tone="error" title={t('setup_bot.tone_load_failed_title')}>
          {t('setup_bot.tone_load_failed_text')}
        </Alert>
      ) : settings.isLoading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
          <div role="group" aria-label={t('setup_bot.tone_chips_label')} className="flex flex-wrap gap-2">
            {TONE_CHIPS.map((chip) => {
              const pressed = tone.includes(t(`setup_bot.tone_${chip}_phrase`));
              return (
                <Suggest key={chip} pressed={pressed} onClick={() => toggle(chip)} className="inline-flex items-center gap-1.5">
                  {pressed && <Check className="h-4 w-4" aria-hidden="true" />}
                  {t(`setup_bot.tone_${chip}`)}
                </Suggest>
              );
            })}
          </div>
          <Field label={t('setup_bot.tone_label')}>
            {({ id, describedBy }) => (
              <TextArea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                value={tone}
                onChange={(e) => edit(e.target.value)}
                placeholder={t('setup_bot.tone_placeholder')}
              />
            )}
          </Field>
        </>
      )}

      <Examples />

      <div className="mt-auto flex flex-col gap-2 pt-1">
        {save.isError && (
          <Alert tone="error" title={t('setup_bot.tone_failed_title')}>
            {t('setup_bot.tone_failed_text')}
          </Alert>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-dm-green">
            {t('setup_bot.tone_saved')}
          </p>
        )}
        <SetupButton variant="secondary" block onClick={() => save.mutate(tone.trim())} loading={save.isPending} disabled={!dirty}>
          {t('setup_bot.tone_save')}
        </SetupButton>
      </div>
    </div>
  );
}

/** «Приклади ваших відповідей»: customer → owner pairs the bot imitates. Shares `['examples']` with Settings. */
function Examples() {
  const { t } = useT();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [customer, setCustomer] = useState('');
  const [reply, setReply] = useState('');

  const { data: examples, isLoading } = useQuery<ManagerExample[]>({
    queryKey: ['examples'],
    queryFn: () => api.get('/settings/examples').then((r) => r.data),
  });

  const add = useMutation({
    mutationFn: () => api.post('/settings/examples', { customerMessage: customer.trim(), managerReply: reply.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['examples'] });
      setCustomer('');
      setReply('');
      setAdding(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/examples/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['examples'] }),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-dm-ink2">{t('setup_bot.examples_title')}</span>
        <span className="text-[13px] text-dm-muted">{t('setup_bot.examples_note')}</span>
      </div>

      {isLoading && <Skeleton className="h-20 rounded-2xl" />}
      {examples?.map((ex) => (
        <div key={ex.id} className="relative flex flex-col gap-2 rounded-2xl border border-dm-line bg-white py-3 pl-3.5 pr-12">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-dm-muted">{t('setup_bot.example_customer')}</span>
            <span className="whitespace-pre-wrap break-words text-[15px] text-dm-ink">{ex.customerMessage}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-dm-muted">{t('setup_bot.example_you')}</span>
            <span className="whitespace-pre-wrap break-words text-[15px] text-dm-ink">{ex.managerReply}</span>
          </div>
          <IconButton
            label={t('setup_bot.example_delete')}
            onClick={() => remove.mutate(ex.id)}
            disabled={remove.isPending && remove.variables === ex.id}
            className="absolute right-0.5 top-0.5"
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-dm-line bg-dm-sunken p-3.5">
          <Field label={t('setup_bot.example_customer_label')}>
            {({ id }) => (
              <TextArea id={id} rows={2} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={t('setup_bot.example_customer_placeholder')} autoFocus />
            )}
          </Field>
          <Field label={t('setup_bot.example_you_label')}>
            {({ id }) => <TextArea id={id} rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('setup_bot.example_you_placeholder')} />}
          </Field>
          {add.isError && (
            <Alert tone="error" title={t('setup_bot.example_failed_title')}>
              {t('setup_bot.example_failed_text')}
            </Alert>
          )}
          <div className="flex gap-2">
            <SetupButton variant="secondary" size="sm" onClick={() => add.mutate()} loading={add.isPending} disabled={!customer.trim() || !reply.trim()}>
              {t('setup_bot.example_save')}
            </SetupButton>
            <SetupButton
              variant="ghost"
              size="sm"
              onClick={() => {
                add.reset();
                setAdding(false);
              }}
            >
              {t('setup_bot.example_cancel')}
            </SetupButton>
          </div>
        </div>
      ) : (
        <SetupButton variant="secondary" size="sm" onClick={() => setAdding(true)} className="self-start">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('setup_bot.example_add')}
        </SetupButton>
      )}
    </div>
  );
}
