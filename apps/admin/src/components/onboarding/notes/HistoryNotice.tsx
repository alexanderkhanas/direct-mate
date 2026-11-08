import { Loader2 } from '../../icons';
import { useT } from '../../../i18n';
import { Alert, TextLink } from '../../setup/ui';
import { factSections, historyPhase, useStartHistoryImport, type HistoryImportView } from '../historyImport';

/**
 * The notes start screen's word on the Instagram chat reading: a calm card
 * while it runs, one plain line when it couldn't help, or a link that starts
 * it when Instagram is connected but nothing was read (or the reading
 * failed). Nothing once there are terms to draft from (that's the «З ваших
 * переписок» way) or without Instagram.
 */
export function HistoryNotice({ view }: { view: HistoryImportView | undefined }) {
  const { t } = useT();
  const read = useStartHistoryImport();
  if (!view) return null;
  const imp = view.import;
  const phase = historyPhase(imp);

  if (phase === 'reading') {
    return (
      <Alert
        tone="info"
        icon={<Loader2 className="mt-px h-5 w-5 flex-none animate-spin" aria-hidden="true" />}
        title={t('setup_history.notes_reading_title')}
      >
        {t('setup_history.notes_reading_text')}
      </Alert>
    );
  }

  if (phase === 'none' || phase === 'failed') {
    if (!view.instagramConnected) return null;
    return (
      <div className="flex flex-col text-sm">
        <p className="text-dm-muted">{t(phase === 'failed' ? 'setup_history.notes_failed' : 'setup_history.notes_offer')}</p>
        <TextLink onClick={() => read.mutate()} disabled={read.isPending} className="inline-flex min-h-11 items-center self-start">
          {t('setup_history.read_link')}
        </TextLink>
        {read.isError && (
          <p role="alert" className="text-dm-red">
            {t('setup_history.read_failed')}
          </p>
        )}
      </div>
    );
  }

  const line =
    phase === 'done'
      ? factSections(imp).length > 0
        ? null
        : 'notes_no_terms'
      : { limited: 'notes_limited', waiting: 'notes_waiting', empty: 'notes_empty' }[phase];
  return line ? <p className="text-sm text-dm-muted">{t(`setup_history.${line}`)}</p> : null;
}
