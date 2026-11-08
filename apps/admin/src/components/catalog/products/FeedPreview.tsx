import { useId, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import { cn } from '../../../lib/cn';
import { Alert, Badge, Skeleton, TextLink } from '../../setup/ui';
import { SourceIcon } from './SourceChoice';
import { FeedWarnings } from './FeedWarnings';
import { displayUrl, type FeedPreview, type FeedSample, type LinkSource } from './api';
import { formatPrice, sizeSummary } from './format';

/** Phones show two sample cards, desktop four in a row. */
const SAMPLE_CARDS = 4;

/**
 * What the bot will see before anything is imported (m14, d10): the product
 * count, variants and stock, the format, sample cards, the warnings, and
 * «Змінити посилання».
 */
export function FeedPreviewView({ preview, kind, onChangeLink }: { preview: FeedPreview; kind: LinkSource; onChangeLink: () => void }) {
  const { t } = useT();
  const plural = usePlural();
  const sampleId = useId();
  return (
    <>
      <div className="flex flex-col gap-1.5 rounded-2xl border border-dm-line bg-white p-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex items-start justify-between gap-3 lg:contents">
          <p className="flex flex-wrap items-baseline gap-2.5 text-dm-ink">
            <strong className="text-[44px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
              {preview.products.toLocaleString('uk-UA')}
            </strong>
            <span className="text-[17px] font-medium lg:text-lg">{plural(preview.products, 'setup_products.products_word')}</span>
          </p>
          <Badge tone="ok" className="lg:order-last">
            {t(`feeds.format_${preview.format}`)}
          </Badge>
        </div>
        <p className="text-sm tabular-nums text-dm-muted lg:flex-1 lg:text-[15px]">
          {plural(preview.variants, 'setup_products.variants')} · {t('setup_products.preview_in_stock', { n: preview.inStock.toLocaleString('uk-UA') })}
        </p>
      </div>

      <section className="flex flex-col gap-2.5" aria-labelledby={sampleId}>
        <h2 id={sampleId} className="text-sm font-medium text-dm-ink2 lg:sr-only">
          {t('setup_products.preview_as_bot')}
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {preview.sample.slice(0, SAMPLE_CARDS).map((product, i) => (
            <SampleCard key={`${product.title}-${i}`} product={product} />
          ))}
        </ul>
      </section>

      <FeedWarnings warnings={preview.warnings} kind={kind} />

      <TextLink onClick={onChangeLink} className="min-h-11 self-start text-[15px]">
        {t('setup_products.change_link')}
      </TextLink>
    </>
  );
}

function SampleCard({ product }: { product: FeedSample }) {
  const { t } = useT();
  const [broken, setBroken] = useState(false);
  const meta = [product.colors.join(', '), sizeSummary(product.sizes)].filter(Boolean).join(' · ');
  return (
    <li className="flex min-w-0 flex-col gap-1">
      {product.image && !broken ? (
        <img
          src={product.image}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="mb-1 aspect-[4/5] w-full rounded-xl bg-dm-bubble object-cover"
        />
      ) : (
        <span className="mb-1 grid aspect-[4/5] w-full place-items-center rounded-xl bg-dm-bubble text-dm-faint" aria-hidden="true">
          <ImageIcon className="h-7 w-7" />
        </span>
      )}
      <b className="line-clamp-2 text-sm font-medium leading-[1.3] text-dm-ink">{product.title}</b>
      <span className="text-[15px] font-semibold tabular-nums text-dm-ink">{formatPrice(product.price, product.currency, t)}</span>
      {product.inStock ? (
        meta && <span className="truncate text-xs text-dm-muted">{meta}</span>
      ) : (
        <span className="text-xs font-medium text-dm-red">{t('setup_products.out_of_stock')}</span>
      )}
    </li>
  );
}

/**
 * A wait the API answers only at the end (m13): the link being read, one plain
 * line about what's happening, and a skeleton of the result. Reading a link
 * shows the preview's shape; importing shows the connected source's.
 */
export function WaitState({ kind, url, title, text, result }: { kind: LinkSource; url: string; title: string; text: string; result: 'preview' | 'source' }) {
  return (
    <>
      <div className="flex items-center gap-2.5 rounded-xl border border-dm-line bg-white px-3 py-2.5">
        <SourceIcon kind={kind} small />
        <span className="min-w-0 flex-1 truncate text-sm text-dm-ink2">{displayUrl(url)}</span>
      </div>

      <Alert tone="info" title={title} icon={<Loader2 className="mt-px h-5 w-5 flex-none animate-spin" aria-hidden="true" />}>
        {text}
      </Alert>

      {result === 'preview' ? <PreviewSkeleton /> : <SourceSkeleton />}
    </>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-10 w-[120px]" />
        <Skeleton className="h-3.5 w-[220px]" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {['w-1/2', 'w-2/5', 'w-1/2', 'w-1/3'].map((width, i) => (
          <div key={i} className={cn('flex-col gap-1.5', i < 2 ? 'flex' : 'hidden lg:flex')}>
            <Skeleton className="aspect-[4/5]" />
            <Skeleton className="h-3 w-[85%]" />
            <Skeleton className={cn('h-3', width)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The connected-source card's shape, while the sources load or the first import runs. */
export function SourceSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dm-line bg-white p-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <Skeleton className="h-3 w-56" />
    </div>
  );
}
