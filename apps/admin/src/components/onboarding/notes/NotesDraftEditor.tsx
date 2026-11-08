import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { useT } from '../../../i18n';
import { cn } from '../../../lib/cn';
import { Field, NewTag, SetupButton, TextArea } from '../../setup/ui';
import { NOTE_SECTIONS, filled, type FreshKey, type NoteSection, type NotesDraft } from './draft';

/** A draft section's card: filled (white), empty (dashed) or just changed by the chat (blue). */
export function sectionCardClass(look: 'filled' | 'empty' | 'fresh'): string {
  return cn(
    'flex flex-col gap-1.5 rounded-[14px] border px-3.5 py-3 transition-[border-color,background-color,box-shadow]',
    look === 'fresh' && 'border-blue-200 bg-[#FAFCFF] shadow-[0_0_0_3px_theme(colors.blue.50)]',
    look === 'empty' && 'border-dashed border-dm-line2 bg-transparent',
    look === 'filled' && 'border-dm-line bg-white',
  );
}

/**
 * The editable notes draft (boards m23, d20): one card per section, then the
 * payment details the bot sends word for word. Empty sections are dashed:
 * the bot hands those questions to a manager.
 */
export function NotesDraftEditor({
  draft,
  onChange,
  fresh,
  onStartOver,
  visible,
}: {
  draft: NotesDraft;
  onChange: (patch: Partial<NotesDraft>) => void;
  /** Parts the chat just changed: «щойно оновлено» for a few seconds. */
  fresh: FreshKey[];
  onStartOver: () => void;
  /** Below xl only one of chat and draft shows; at xl both always do. */
  visible: boolean;
}) {
  const { t } = useT();
  const editSection = (section: NoteSection, value: string) => onChange({ sections: { ...draft.sections, [section]: value } });

  return (
    <section
      aria-label={t('setup_notes.draft_label')}
      // At xl the column scrolls itself, beside the chat.
      className={cn(visible ? 'flex' : 'hidden', 'flex-col gap-2.5 xl:-m-1 xl:flex xl:overflow-y-auto xl:p-1')}
    >
      <div className="hidden items-center justify-between gap-3 xl:flex">
        <span className="text-sm font-medium text-dm-ink2">{t('setup_notes.draft_heading')}</span>
        <StartOverButton onClick={onStartOver} />
      </div>

      {NOTE_SECTIONS.map((section) => (
        <SectionCard
          key={section}
          title={t(`setup_notes.section_${section}`)}
          value={draft.sections[section] ?? ''}
          placeholder={t(section === 'other' ? 'setup_notes.section_other_placeholder' : 'setup_notes.section_empty')}
          fresh={fresh.includes(section)}
          onChange={(value) => editSection(section, value)}
        />
      ))}

      <Field
        className="mt-2.5"
        label={
          <span className="flex items-center gap-2">
            {t('setup_notes.payment_details')}
            {fresh.includes('paymentDetails') && <NewTag>{t('setup_notes.fresh')}</NewTag>}
          </span>
        }
        hint={t('setup_notes.payment_details_hint')}
      >
        {({ id, describedBy }) => (
          <TextArea
            id={id}
            aria-describedby={describedBy}
            rows={3}
            value={draft.paymentDetails ?? ''}
            onChange={(e) => onChange({ paymentDetails: e.target.value || null })}
            placeholder={t('setup_notes.payment_details_placeholder')}
          />
        )}
      </Field>

      <p className="mt-1 text-[13px] text-dm-muted">
        {t('setup_notes.settings_note')}
        <Link to="/settings" className="font-medium text-blue-800 underline decoration-1 underline-offset-[3px] hover:text-blue-700">
          {t('setup_notes.settings_link')}
        </Link>
        {t('setup_notes.settings_note_end')}
      </p>
      <StartOverButton onClick={onStartOver} className="-ml-3 self-start xl:hidden" />
    </section>
  );
}

function StartOverButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useT();
  return (
    <SetupButton variant="ghost" size="sm" onClick={onClick} className={cn('min-h-11', className)}>
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
      {t('setup_notes.start_over')}
    </SetupButton>
  );
}

/**
 * One section: the title, then a borderless text box that grows with its text.
 * The invisible copy underneath sizes the grid cell, so the box fits its
 * content without measuring (also while the tab is hidden).
 */
function SectionCard({
  title,
  value,
  placeholder,
  fresh,
  onChange,
}: {
  title: string;
  value: string;
  placeholder: string;
  fresh: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useT();
  return (
    <label
      className={cn(
        sectionCardClass(fresh ? 'fresh' : filled(value) ? 'filled' : 'empty'),
        'cursor-text focus-within:border-blue-600 focus-within:bg-white focus-within:shadow-[0_0_0_3px_theme(colors.blue.100)]',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-dm-ink">
        {title}
        {fresh && <NewTag className="ml-auto">{t('setup_notes.fresh')}</NewTag>}
      </span>
      <span className="grid">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words text-base leading-normal">
          {`${value || placeholder} `}
        </span>
        <textarea
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="col-start-1 row-start-1 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-base leading-normal text-dm-ink outline-none placeholder:text-dm-muted"
        />
      </span>
    </label>
  );
}
