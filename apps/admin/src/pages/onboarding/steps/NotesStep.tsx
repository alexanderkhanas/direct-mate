import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from '../../../components/icons';
import { api } from '../../../lib/api';
import { useT } from '../../../i18n';
import { useMediaQuery } from '../../../lib/useMediaQuery';
import { Alert, Chip, SegTabs, Skeleton, StepTitle, TextLink } from '../../../components/setup/ui';
import { SetUpForMeButton } from '../../../components/onboarding/SetUpForMeButton';
import { NotesStart } from '../../../components/onboarding/notes/NotesStart';
import { NotesDrafting } from '../../../components/onboarding/notes/NotesDrafting';
import { NotesChat } from '../../../components/onboarding/notes/NotesChat';
import { NotesDraftEditor } from '../../../components/onboarding/notes/NotesDraftEditor';
import {
  KEY_SECTIONS,
  changedKeys,
  filled,
  isDraftEmpty,
  mergeDraft,
  withScheme,
  type FreshKey,
  type NotesDraft,
  type NotesMessage,
  type NotesState,
  type NotesWay,
} from '../../../components/onboarding/notes/draft';
import { useSetup, useSetupStep } from '../SetupContext';
import { apiState, type OnboardingStatus } from '../steps';

const NOTES_KEY = ['onboarding-notes'];

/** How long a section the chat changed stays highlighted. */
const FRESH_MS = 4000;

type DraftBody = Record<string, never> | { text: string } | { websiteUrl: string };

/**
 * «Що знає бот»: the store notes the bot answers delivery, payment and returns
 * questions from. Three ways in (interview, pasted text, website) → a draft →
 * a short chat with the assistant beside the editable draft → save.
 * Phones and 1024–1279 px show the chat and the draft as two tabs; ≥1280 px
 * shows them side by side.
 */
export default function NotesStep() {
  const { t } = useT();
  const qc = useQueryClient();
  const { status, goNext } = useSetup();
  const isPhone = useMediaQuery('(max-width: 1023px)');
  const isXl = useMediaQuery('(min-width: 1280px)');

  const notesQuery = useQuery<NotesState>({
    queryKey: NOTES_KEY,
    queryFn: () => api.get('/onboarding/notes').then((r) => r.data),
  });
  const notes = notesQuery.data;

  // undefined until the saved draft has been read; null means no draft yet (the start screen).
  const [draft, setDraft] = useState<NotesDraft | null | undefined>(undefined);
  const [way, setWay] = useState<NotesWay>('interview');
  const [text, setText] = useState('');
  const [website, setWebsite] = useState('');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'chat' | 'draft'>('chat');
  const [draftDot, setDraftDot] = useState(false);
  const [fresh, setFresh] = useState<FreshKey[]>([]);
  const [composerFocused, setComposerFocused] = useState(false);

  // The draft the server holds, to tell whether the owner has edits it hasn't seen.
  const synced = useRef<NotesDraft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftVisible = isXl || tab === 'draft';
  const draftVisibleRef = useRef(draftVisible);
  draftVisibleRef.current = draftVisible;

  // Only from data fetched for this visit: a cached draft could be older, or another store's.
  if (draft === undefined && notes && notesQuery.isFetchedAfterMount) {
    synced.current = notes.draft;
    setDraft(notes.draft);
    setWebsite(notes.websiteUrl ?? '');
  }

  const setNotes = (next: Partial<NotesState>) =>
    qc.setQueryData<NotesState>(NOTES_KEY, (old) => ({ ...(old ?? { draft: null, messages: [], websiteUrl: null }), ...next }));

  // The highlight runs once the owner can see the draft (on phones, when they open its tab).
  useEffect(() => {
    if (fresh.length === 0 || !draftVisible) return;
    const timer = setTimeout(() => setFresh([]), FRESH_MS);
    return () => clearTimeout(timer);
  }, [fresh, draftVisible]);

  // Leaving the step (Back, the steps sheet, Settings) keeps hand edits as the draft, as the chat would.
  useEffect(
    () => () => {
      const latest = draftRef.current;
      if (!latest || latest === synced.current) return;
      api.post('/onboarding/notes/update', { draft: latest }).catch(() => undefined);
      qc.setQueryData<NotesState>(NOTES_KEY, (old) => (old ? { ...old, draft: latest } : old));
    },
    [qc],
  );

  const start = useMutation({
    mutationFn: (body: DraftBody) =>
      api.post<{ draft: NotesDraft; messages: NotesMessage[] }>('/onboarding/notes/draft', body).then((r) => r.data),
    onSuccess: (res) => {
      synced.current = res.draft;
      setDraft(res.draft);
      setNotes({ draft: res.draft, messages: res.messages });
      setTab('chat');
    },
  });

  const chat = useMutation({
    mutationFn: async ({ text: answer, sent }: { text: string; sent: NotesDraft }) => {
      // The owner's own edits go first, so the chat builds on them instead of overwriting them.
      await api.post('/onboarding/notes/update', { draft: sent });
      synced.current = sent;
      return api
        .post<{ reply: string; draft: NotesDraft; messages: NotesMessage[] }>('/onboarding/notes/chat', { message: answer })
        .then((r) => r.data);
    },
    onMutate: ({ text: answer }) => {
      const previous = notes?.messages ?? [];
      setNotes({ messages: [...previous, { role: 'owner', text: answer }] });
      setMessage('');
      return { previous };
    },
    onSuccess: (res, { sent }) => {
      const { draft: merged, kept } = mergeDraft(sent, draftRef.current ?? sent, res.draft);
      synced.current = res.draft;
      setDraft(merged);
      setNotes({ draft: res.draft, messages: res.messages });
      const changed = changedKeys(sent, res.draft).filter((k) => !kept.includes(k));
      if (changed.length > 0) {
        setFresh((old) => [...new Set([...old, ...changed])]);
        if (!draftVisibleRef.current) setDraftDot(true);
      }
    },
    onError: (_err, { text: answer }, context) => {
      setNotes({ messages: context?.previous ?? [] });
      setMessage((current) => current || answer);
    },
  });

  const save = useMutation({
    // Saving writes the store's settings and keeps the draft, so coming back shows what was saved.
    mutationFn: (toSave: NotesDraft) => api.post<OnboardingStatus>('/onboarding/notes/save', { draft: toSave }).then((r) => r.data),
    onSuccess: (next, saved) => {
      synced.current = saved;
      setNotes({ draft: saved });
      qc.setQueryData(['onboarding-status'], next);
      qc.invalidateQueries({ queryKey: ['store-config'] });
      qc.invalidateQueries({ queryKey: ['engine-config'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      goNext();
    },
  });

  const begin = () => {
    if (way === 'interview') start.mutate({});
    else if (way === 'text' && text.trim()) start.mutate({ text: text.trim() });
    else if (way === 'website' && website.trim()) start.mutate({ websiteUrl: withScheme(website.trim()) });
  };

  const send = () => {
    const answer = message.trim();
    if (!answer || !draft || chat.isPending) return;
    chat.mutate({ text: answer, sent: draft });
  };

  const startOver = () => {
    setDraft(null);
    setFresh([]);
    setDraftDot(false);
    setTab('chat');
    start.reset();
    chat.reset();
    save.reset();
  };

  const openTab = (next: 'chat' | 'draft') => {
    setTab(next);
    if (next === 'draft') setDraftDot(false);
  };

  const view = draft === undefined ? 'loading' : draft ? 'editor' : start.isPending && way !== 'interview' ? 'drafting' : 'start';
  const keyboardOpen = view === 'editor' && isPhone && composerFocused;

  useSetupStep(
    view === 'editor'
      ? {
          primary: {
            label: t('setup_notes.save_next'),
            onClick: () => draftRef.current && save.mutate(draftRef.current),
            loading: save.isPending,
            // Saving mid-answer would miss what the chat is writing into the draft.
            disabled: chat.isPending || (!!draft && isDraftEmpty(draft)),
          },
          // The chat fills the height and scrolls inside; the draft tab alone scrolls with the page.
          layout: isXl || tab === 'chat' ? 'fill' : 'scroll',
          width: 'wide',
          hideFooter: keyboardOpen,
        }
      : view === 'drafting'
        ? { primary: { label: t('setup_notes.drafting_button'), onClick: () => undefined, loading: true }, back: false }
        : {
            primary:
              way === 'interview'
                ? { label: t('setup_notes.start'), onClick: begin, loading: start.isPending, disabled: view === 'loading' }
                : { label: t('setup_notes.make_draft'), onClick: begin, disabled: !(way === 'text' ? text : website).trim() },
          },
  );

  if (view === 'loading') {
    return (
      <>
        <StepTitle title={t('setup_notes.title')} lead={t('setup_notes.lead')} />
        {notesQuery.isError ? (
          <Alert
            tone="error"
            title={t('setup_notes.load_failed')}
            action={<TextLink onClick={() => notesQuery.refetch()}>{t('setup_notes.retry')}</TextLink>}
          >
            {t('setup_notes.load_failed_text')}
          </Alert>
        ) : (
          <div className="flex flex-col gap-2.5" aria-hidden="true">
            <Skeleton className="h-[86px] rounded-[14px]" />
            <Skeleton className="h-[86px] rounded-[14px]" />
            <Skeleton className="h-[86px] rounded-[14px]" />
          </div>
        )}
      </>
    );
  }

  if (view === 'drafting') {
    return (
      <>
        <StepTitle title={t('setup_notes.title')} />
        <NotesDrafting way={way === 'text' ? 'text' : 'website'} source={way === 'text' ? text.trim() : withScheme(website.trim())} />
      </>
    );
  }

  if (view === 'start' || !draft) {
    return (
      <NotesStart
        way={way}
        onWay={setWay}
        text={text}
        onText={setText}
        website={website}
        onWebsite={setWebsite}
        onSubmit={begin}
        failed={start.isError}
        hasNotes={apiState(status, 'knowledge') === 'done'}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:gap-[18px]">
      <div className="flex flex-none flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-6">
        <StepTitle title={t('setup_notes.title')} />
        <Coverage sections={draft.sections} />
      </div>

      <div className="flex-none xl:hidden">
        <SegTabs
          label={t('setup_notes.tabs_label')}
          value={tab}
          onChange={openTab}
          tabs={[
            { key: 'chat', label: t('setup_notes.tab_chat') },
            {
              key: 'draft',
              label: (
                <>
                  {t('setup_notes.tab_draft')}
                  {draftDot && <span className="sr-only">, {t('setup_notes.tab_draft_updated')}</span>}
                </>
              ),
              dot: draftDot,
            },
          ]}
        />
      </div>

      {save.isError && (
        <Alert tone="error" title={t('setup_notes.save_failed')} action={<SetUpForMeButton look="inline" step="knowledge" />} className="flex-none">
          {t('setup_notes.save_failed_text')}
        </Alert>
      )}

      <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:grid-rows-[minmax(0,1fr)] xl:gap-5">
        <NotesChat
          messages={notes?.messages ?? []}
          pending={chat.isPending}
          failed={chat.isError}
          message={message}
          onMessage={setMessage}
          onSend={send}
          onFocusChange={setComposerFocused}
          visible={tab === 'chat'}
          // With the keyboard open the footer and the pill are hidden, so the composer can sit low.
        />
        <NotesDraftEditor
          draft={draft}
          onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          fresh={fresh}
          onStartOver={startOver}
          visible={tab === 'draft'}
        />
      </div>
    </div>
  );
}

/** The key sections in a fixed order: green with a tick once filled, grey while still empty. */
function Coverage({ sections }: { sections: NotesDraft['sections'] }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap gap-1.5 lg:gap-2">
      {KEY_SECTIONS.map((s) =>
        filled(sections[s]) ? (
          <Chip key={s} tone="ok" icon={<Check className="h-4 w-4" aria-hidden="true" />}>
            {t(`setup_notes.chip_${s}`)}
          </Chip>
        ) : (
          <Chip key={s} tone="muted">
            {t(`setup_notes.chip_${s}`)}
            <span className="sr-only">, {t('setup_notes.chip_empty')}</span>
          </Chip>
        ),
      )}
    </div>
  );
}
