import type { ReactNode } from 'react';
import { useT } from '../../../i18n';
import { Alert, Badge, ChoiceCard, Field, StepTitle, TextArea, TextInput } from '../../setup/ui';
import { SetUpForMeButton } from '../SetUpForMeButton';
import { TEXT_MAX, type NotesWay } from './draft';

/**
 * The notes step's start (board m20): three ways in, plus a fourth at the top
 * once the owner's Instagram chats have been read («З ваших переписок»). The
 * short interview is the default otherwise, so no website is needed; pasted
 * text and the website reveal their field when chosen. The footer's primary
 * starts whichever is picked.
 */
export function NotesStart({
  way,
  onWay,
  text,
  onText,
  website,
  onWebsite,
  onSubmit,
  failed,
  hasNotes,
  historySections,
  notice,
}: {
  way: NotesWay;
  onWay: (way: NotesWay) => void;
  text: string;
  onText: (text: string) => void;
  website: string;
  onWebsite: (url: string) => void;
  /** Enter in the website field: same as the footer's primary. */
  onSubmit: () => void;
  failed: boolean;
  /** The store already has saved notes (the owner chose «Скласти заново»). */
  hasNotes: boolean;
  /** What the chats covered, in words («доставка, оплата»); set only when there's something to draft from. */
  historySections?: string | null;
  /** Where the chat reading is (a status card, a plain line, or the link that starts it). */
  notice?: ReactNode;
}) {
  const { t, lang } = useT();
  const format = (n: number) => n.toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-US');
  const select = (value: string) => onWay(value as NotesWay);

  return (
    <div className="flex flex-col gap-4">
      <StepTitle title={t('setup_notes.title')} lead={t('setup_notes.lead')} />
      {notice}

      <fieldset className="mt-1 min-w-0">
        <legend className="mb-2.5 text-sm font-medium text-dm-ink2">{t('setup_notes.how_label')}</legend>
        <div className="flex flex-col gap-2.5">
          {historySections && (
            <ChoiceCard
              name="notes-way"
              value="history"
              selected={way === 'history'}
              onSelect={select}
              title={t('setup_history.way_history')}
              badge={<Badge tone="ok">{t('setup_history.way_history_badge')}</Badge>}
              description={t('setup_history.way_history_desc', { sections: historySections })}
            />
          )}
          <ChoiceCard
            name="notes-way"
            value="interview"
            selected={way === 'interview'}
            onSelect={select}
            title={t('setup_notes.way_interview')}
            badge={historySections ? undefined : <Badge tone="ok">{t('setup_notes.way_interview_badge')}</Badge>}
            description={t('setup_notes.way_interview_desc')}
          />
          <ChoiceCard
            name="notes-way"
            value="text"
            selected={way === 'text'}
            onSelect={select}
            title={t('setup_notes.way_text')}
            description={t('setup_notes.way_text_desc')}
          />
          {way === 'text' && (
            <Field hint={t('setup_notes.text_count', { n: format(text.length), max: format(TEXT_MAX) })}>
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  aria-label={t('setup_notes.text_label')}
                  rows={7}
                  maxLength={TEXT_MAX}
                  value={text}
                  onChange={(e) => onText(e.target.value)}
                  placeholder={t('setup_notes.text_placeholder')}
                />
              )}
            </Field>
          )}
          <ChoiceCard
            name="notes-way"
            value="website"
            selected={way === 'website'}
            onSelect={select}
            title={t('setup_notes.way_website')}
            description={t('setup_notes.way_website_desc')}
          />
          {way === 'website' && (
            <Field>
              {({ id }) => (
                <TextInput
                  id={id}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label={t('setup_notes.website_label')}
                  value={website}
                  onChange={(e) => onWebsite(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && website.trim()) onSubmit();
                  }}
                  placeholder={t('setup_notes.website_placeholder')}
                />
              )}
            </Field>
          )}
        </div>
      </fieldset>

      {failed && (
        <Alert tone="error" title={t('setup_notes.draft_failed')} action={<SetUpForMeButton look="inline" step="knowledge" />}>
          {t('setup_notes.draft_failed_text')}
        </Alert>
      )}
      {!hasNotes && <Alert tone="info">{t('setup_notes.no_notes')}</Alert>}
    </div>
  );
}
