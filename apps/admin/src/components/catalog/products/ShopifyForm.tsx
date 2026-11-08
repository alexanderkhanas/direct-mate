import type { FormEvent } from 'react';
import { ChevronDown, Info } from '../../icons';
import { useT } from '../../../i18n';
import { Alert, Field, TextInput } from '../../setup/ui';
import { SetUpForMeButton } from '../../onboarding/SetUpForMeButton';
import type { ProductSourceFlow } from './useProductSource';

/**
 * The Shopify screen (m12): store address and Admin API token, where to get the
 * token, and the free-setup link. Its own form; the Connections page keeps the
 * old one.
 */
export function ShopifyForm({ flow, onSubmit }: { flow: ProductSourceFlow; onSubmit: () => void }) {
  const { t } = useT();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-3.5">
      <Field label={t('setup_products.shopify_domain')}>
        {({ id }) => (
          <TextInput
            id={id}
            value={flow.shopDomain}
            onChange={(e) => flow.setShopDomain(e.target.value)}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="your-store.myshopify.com"
          />
        )}
      </Field>
      <Field label={t('setup_products.shopify_token')} hint={t('setup_products.shopify_token_hint')}>
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            type="password"
            value={flow.shopToken}
            onChange={(e) => flow.setShopToken(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="shpat_…"
          />
        )}
      </Field>
      {/* Enter submits from either field; the visible primary sits in the footer or the panel. */}
      <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only" />

      {flow.shopifyFailed && (
        <Alert tone="error" title={t('setup_products.shopify_failed_title')}>
          {t('setup_products.shopify_failed_text')}
        </Alert>
      )}

      <details open className="group rounded-[14px] border border-dm-line bg-white px-3.5 pb-3.5 pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-dm-ink [&::-webkit-details-marker]:hidden">
          <Info className="h-4 w-4 flex-none text-blue-600" aria-hidden="true" />
          {t('setup_products.shopify_where')}
          <ChevronDown className="ml-auto h-4 w-4 flex-none text-dm-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-dm-ink2">
          <li>{t('setup_products.shopify_where_1')}</li>
          <li>{t('setup_products.shopify_where_2')}</li>
          <li>{t('setup_products.shopify_where_3')}</li>
        </ol>
      </details>

      <SetUpForMeButton
        look="inline"
        step="products"
        topic="shopify"
        lead={t('setup_products.shopify_hard')}
        label={t('setup_products.shopify_help')}
        available={flow.supportAvailable}
      />
    </form>
  );
}
