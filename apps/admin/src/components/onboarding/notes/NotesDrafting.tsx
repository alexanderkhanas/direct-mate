import { Loader2 } from 'lucide-react';
import { useT } from '../../../i18n';
import { cn } from '../../../lib/cn';
import { usePlural } from '../../../lib/plural';
import { Card, Skeleton } from '../../setup/ui';
import { sectionCardClass } from './NotesDraftEditor';

/** Skeleton line widths per section card, as on the board. */
const SKELETON: Array<{ section: 'delivery' | 'payment' | 'returns'; lines: string[] }> = [
  { section: 'delivery', lines: ['w-[92%]', 'w-[70%]'] },
  { section: 'payment', lines: ['w-[80%]'] },
  { section: 'returns', lines: ['w-[86%]', 'w-[40%]'] },
];

/**
 * While the notes are drafted from pasted text or a website (board m21, up to
 * a minute): what the owner gave, one plain line about what's happening, and
 * skeleton section cards.
 */
export function NotesDrafting({ way, source }: { way: 'text' | 'website'; source: string }) {
  const { t } = useT();
  const plural = usePlural();
  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-dm-ink2">{t(way === 'text' ? 'setup_notes.your_text' : 'setup_notes.your_website')}</span>
            {way === 'text' && <span className="text-[13px] text-dm-muted">{plural(source.length, 'setup_notes.chars')}</span>}
          </div>
          <p className={cn('text-sm leading-normal text-dm-ink2', way === 'text' ? 'line-clamp-3 whitespace-pre-line' : 'break-all')}>{source}</p>
        </div>
      </Card>

      <div role="status" className="flex items-center gap-3 rounded-[14px] border border-blue-100 bg-blue-50 p-3.5 text-blue-800">
        <Loader2 className="h-5 w-5 flex-none animate-spin" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <b className="text-[15px] font-semibold">{t('setup_notes.drafting_title')}</b>
          <p className="text-sm text-dm-ink2">{t(way === 'text' ? 'setup_notes.drafting_text' : 'setup_notes.drafting_website')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5" aria-hidden="true">
        {SKELETON.map(({ section, lines }) => (
          <div key={section} className={sectionCardClass('filled')}>
            <span className="text-sm font-semibold text-dm-ink">{t(`setup_notes.section_${section}`)}</span>
            {lines.map((width) => (
              <Skeleton key={width} className={cn('h-3', width)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
