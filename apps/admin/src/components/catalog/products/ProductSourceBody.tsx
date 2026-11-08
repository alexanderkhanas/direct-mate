import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import { SourceChoice } from './SourceChoice';
import { FeedLinkForm, SheetSteps } from './LinkForms';
import { ShopifyForm } from './ShopifyForm';
import { FeedPreviewView, SourceSkeleton, WaitState } from './FeedPreview';
import { FeedErrorView } from './FeedError';
import type { ProductSourceFlow } from './useProductSource';

/**
 * The products flow's screens before a source is connected: choose, a
 * source's screen, reading, preview, importing, error. The setup step and
 * the Catalog panel each add the heading and the buttons; done and waiting
 * are `ConnectedSources`.
 */
export function ProductSourceBody({ flow, wide }: { flow: ProductSourceFlow; wide?: boolean }) {
  const { t } = useT();
  const plural = usePlural();
  // Enter in a field does what the screen's primary does.
  const submit = () => {
    const action = flow.primary;
    if (action && !action.disabled && !action.loading) action.onClick();
  };

  switch (flow.view) {
    case 'pending':
      return <SourceSkeleton />;
    case 'choose':
      return <SourceChoice onPick={flow.pick} supportAvailable={flow.supportAvailable} wide={wide} />;
    case 'sheet':
      return <SheetSteps url={flow.url} onUrl={flow.setUrl} onSubmit={submit} />;
    case 'feed':
      return <FeedLinkForm url={flow.url} onUrl={flow.setUrl} onSubmit={submit} />;
    case 'shopify':
      return <ShopifyForm flow={flow} onSubmit={submit} />;
    case 'loading':
      return (
        <WaitState
          kind={flow.kind}
          url={flow.url}
          title={t(`setup_products.reading_${flow.kind}`)}
          text={t('setup_products.reading_text')}
          result="preview"
        />
      );
    case 'importing':
      return (
        <WaitState
          kind={flow.kind}
          url={flow.url}
          title={plural(flow.previewCount, 'setup_products.importing')}
          text={t('setup_products.importing_text')}
          result="source"
        />
      );
    case 'preview':
      return flow.preview ? <FeedPreviewView preview={flow.preview} kind={flow.kind} onChangeLink={flow.editLink} /> : null;
    case 'error':
      return flow.errorCode ? (
        <FeedErrorView
          kind={flow.kind}
          code={flow.errorCode}
          url={flow.url}
          onUrl={flow.setUrl}
          onSubmit={submit}
          supportAvailable={flow.supportAvailable}
        />
      ) : null;
    default:
      return null;
  }
}
