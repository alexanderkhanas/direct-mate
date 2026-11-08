import { useId, type FormEvent, type ReactNode } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { useT } from '../../../i18n';
import { Field, TextInput, Tick, buttonClass } from '../../setup/ui';
import { SHEET_CSV_TEMPLATE, SHEET_TEMPLATE_URL } from './api';

interface LinkFormProps {
  url: string;
  onUrl: (url: string) => void;
  /** Enter in the field: the screen's primary action. */
  onSubmit: () => void;
}

function submitted(onSubmit: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
}

/** The Google Sheet screen (m11): copy the template, one row per colour and size, share it, paste the link. */
export function SheetSteps({ url, onUrl, onSubmit }: LinkFormProps) {
  const { t } = useT();
  const inputId = useId();
  return (
    <ol className="flex max-w-[640px] flex-col gap-3.5">
      <SheetStep n={1} title={t('setup_products.sheet_step_copy')}>
        <div className="flex flex-wrap gap-2">
          {SHEET_TEMPLATE_URL && (
            <a href={SHEET_TEMPLATE_URL} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
              {t('setup_products.sheet_open_template')}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          <a href={SHEET_CSV_TEMPLATE} download className={buttonClass('ghost', 'sm')}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('setup_products.sheet_csv')}
          </a>
        </div>
      </SheetStep>
      <SheetStep n={2} title={t('setup_products.sheet_step_rows')}>
        <SheetExample />
      </SheetStep>
      <SheetStep n={3} title={t('setup_products.sheet_step_share')}>
        <span className="text-sm text-dm-muted">{t('setup_products.sheet_step_share_how')}</span>
      </SheetStep>
      <li className="flex gap-3">
        <Tick state="now" n={4} size={26} />
        <form onSubmit={submitted(onSubmit)} className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={inputId} className="text-[15px] font-semibold text-dm-ink">
            {t('setup_products.sheet_step_paste')}
          </label>
          <TextInput
            id={inputId}
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </form>
      </li>
    </ol>
  );
}

function SheetStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <Tick state="now" n={n} size={26} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <b className="text-[15px] font-semibold text-dm-ink">{title}</b>
        {children}
      </div>
    </li>
  );
}

/** Two rows of the template: same product and colour, two sizes, one of them out of stock. */
function SheetExample() {
  const { t } = useT();
  const cols = ['title', 'color', 'size', 'price', 'stock'] as const;
  const rows = [
    ['M', '3'],
    ['L', '0'],
  ];
  return (
    <div className="overflow-x-auto rounded-[10px] border border-dm-line bg-white">
      <table className="w-full text-left text-xs tabular-nums">
        <caption className="sr-only">{t('setup_products.sheet_example')}</caption>
        <thead className="bg-dm-sunken text-dm-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" className="px-2 py-1.5 font-medium">
                {t(`setup_products.sheet_col_${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-dm-ink">
          {rows.map(([size, stock]) => (
            <tr key={size} className="border-t border-dm-line">
              <td className="px-2 py-1.5">{t('setup_products.sheet_example_title')}</td>
              <td className="px-2 py-1.5">{t('setup_products.sheet_example_color')}</td>
              <td className="px-2 py-1.5">{size}</td>
              <td className="px-2 py-1.5">2450</td>
              <td className="px-2 py-1.5">{stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The website feed screen: one link field. */
export function FeedLinkForm({ url, onUrl, onSubmit }: LinkFormProps) {
  const { t } = useT();
  return (
    <form onSubmit={submitted(onSubmit)} className="max-w-[640px]">
      <Field label={t('setup_products.feed_link_label')} hint={t('setup_products.feed_link_hint')}>
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://…/feed.xml"
          />
        )}
      </Field>
    </form>
  );
}
