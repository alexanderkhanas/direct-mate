import { useId, type FormEvent, type ReactNode } from 'react';
import { Download, ExternalLink } from '../../icons';
import { useT } from '../../../i18n';
import { Alert, TextInput, buttonClass } from '../../setup/ui';
import { SetUpForMeButton } from '../../onboarding/SetUpForMeButton';
import { SHEET_CSV_TEMPLATE, knownErrorCode, type FeedErrorCode, type LinkSource } from './api';

interface Fix {
  /** `setup_products.fix_<key>_title` and `_1…_n`. */
  key: string;
  steps: number;
  /** A button that opens the owner's link, to check or change it there. */
  openLink?: boolean;
  csv?: boolean;
}

/** Numbered fix steps where the owner can fix it themselves; the other codes get the explanation only. */
const FIXES: Partial<Record<FeedErrorCode, Record<LinkSource, Fix>>> = {
  sheet_not_shared: {
    sheet: { key: 'access', steps: 3, openLink: true },
    feed: { key: 'access', steps: 3, openLink: true },
  },
  not_public: {
    sheet: { key: 'access', steps: 3, openLink: true },
    feed: { key: 'private', steps: 2, openLink: true },
  },
  unreachable: {
    sheet: { key: 'unreachable', steps: 2, openLink: true },
    feed: { key: 'unreachable', steps: 2, openLink: true },
  },
  unknown_format: {
    sheet: { key: 'sheet_format', steps: 2, csv: true },
    feed: { key: 'feed_format', steps: 2, openLink: true },
  },
};

/**
 * A link that didn't work (m15): the link, still editable; what happened; how
 * to fix it, with a button to open the sheet; and the free-setup link. The
 * footer's primary is «Спробувати ще раз».
 */
export function FeedErrorView({
  kind,
  code,
  url,
  onUrl,
  onSubmit,
  supportAvailable,
}: {
  kind: LinkSource;
  code: FeedErrorCode;
  url: string;
  onUrl: (url: string) => void;
  onSubmit: () => void;
  supportAvailable: boolean;
}) {
  const { t } = useT();
  const inputId = useId();
  const alertId = useId();
  const fix = FIXES[code]?.[kind];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-dm-ink2">
          {t(kind === 'sheet' ? 'setup_products.sheet_link_label' : 'setup_products.feed_link_label')}
        </label>
        <TextInput
          id={inputId}
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          invalid
          aria-describedby={alertId}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </form>

      <div id={alertId}>
        <FeedErrorAlert code={code} />
      </div>

      {fix && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-dm-line bg-white p-4">
          <b className="text-[15px] font-semibold text-dm-ink">{t(`setup_products.fix_${fix.key}_title`)}</b>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] text-dm-ink2">
            {Array.from({ length: fix.steps }, (_, i) => (
              <li key={i}>{t(`setup_products.fix_${fix.key}_${i + 1}`)}</li>
            ))}
          </ol>
          {fix.openLink && /^https?:\/\//i.test(url.trim()) && (
            <a href={url.trim()} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm', 'self-start')}>
              {t(kind === 'sheet' ? 'setup_products.open_sheet' : 'setup_products.open_link')}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          {fix.csv && (
            <a href={SHEET_CSV_TEMPLATE} download className={buttonClass('secondary', 'sm', 'self-start')}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('setup_products.sheet_csv')}
            </a>
          )}
        </div>
      )}

      <SetUpForMeButton
        look="inline"
        step="products"
        topic="feed"
        lead={t('setup_products.help_lead')}
        label={t('setup_products.help_label')}
        available={supportAvailable}
      />
    </div>
  );
}

/**
 * What happened to a link, in words: the error screen's alert, or (`lastSync`)
 * a connected feed whose hourly update failed while its products stay.
 */
export function FeedErrorAlert({ code, lastSync, action }: { code: string; lastSync?: boolean; action?: ReactNode }) {
  const { t } = useT();
  const known = knownErrorCode(code);
  const title = t(`setup_products.err_${known}_title`);
  const text = t(`setup_products.err_${known}_text`);
  return lastSync ? (
    <Alert tone="error" title={t('setup_products.last_error_title')} action={action}>
      {title}. {text}
    </Alert>
  ) : (
    <Alert tone="error" title={title} action={action}>
      {text}
    </Alert>
  );
}
