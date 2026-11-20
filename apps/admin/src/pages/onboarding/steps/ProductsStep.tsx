import { useEffect } from 'react';
import { useT } from '../../../i18n';
import { usePlural } from '../../../lib/plural';
import { Alert, SkillRow, Skeleton, StepTitle } from '../../../components/setup/ui';
import { ProductSourceBody } from '../../../components/catalog/products/ProductSourceBody';
import { ConnectedSources } from '../../../components/catalog/products/ConnectedSources';
import { useProductSource, type ProductSourceFlow } from '../../../components/catalog/products/useProductSource';
import { SetUpWithClaudeCard } from '../../../components/onboarding/SetUpWithClaudeCard';
import { useSetup, useSetupStep } from '../SetupContext';

/** How often setup re-reads the status while a connected Shopify has no products in stock yet. */
const SHOPIFY_POLL_MS = 10_000;

/**
 * Товари (m10–m16, d10): choose a source → the sheet, feed or Shopify screen →
 * reading → preview → import → done. Opens on done when the store already has
 * a source or products. The footer carries the one primary for each screen.
 */
export default function ProductsStep() {
  const { t } = useT();
  const { refresh } = useSetup();
  const flow = useProductSource({ refresh });
  const settled = flow.view === 'done' || flow.view === 'waiting';
  const busy = flow.view === 'loading' || flow.view === 'importing';

  useSetupStep({
    // Done and waiting keep the default «Далі»: Shopify's first sync needn't hold up the next steps.
    primary: settled ? undefined : flow.primary,
    hint: flow.view === 'choose' ? t('setup_products.choose_hint') : undefined,
    onBack: flow.back ?? undefined,
    back: busy ? false : undefined,
  });

  // Products from Shopify arrive with the operator's first sync; pick them up when they do.
  const awaitingShopify = !!flow.shopify && flow.products.inStock === 0 && settled;
  useEffect(() => {
    if (!awaitingShopify) return;
    const timer = window.setInterval(() => void refresh(), SHOPIFY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [awaitingShopify, refresh]);

  if (flow.view === 'pending') {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (settled) {
    return (
      <>
        <StepTitle title={t('setup_products.done_title')} />
        {flow.view === 'waiting' ? (
          <Alert tone="info" title={t('setup_products.shopify_waiting_title')}>
            {t('setup_products.shopify_waiting_text')}
          </Alert>
        ) : (
          <DoneAlert flow={flow} />
        )}
        <ConnectedSources flow={flow} />
        {flow.view === 'done' && flow.products.total > 0 && <BotSkills flow={flow} />}
      </>
    );
  }

  return (
    <>
      <StepTitle title={flow.heading.title} lead={flow.heading.lead} />
      <ProductSourceBody flow={flow} />
      {/* The first step every owner sees, intro or not: the other road through setup. */}
      {flow.view === 'choose' && <SetUpWithClaudeCard className="mt-2" />}
    </>
  );
}

/** «AI-агент тепер знає N товарів», or, when nothing is in stock, why the bot won't offer anything yet. */
function DoneAlert({ flow }: { flow: ProductSourceFlow }) {
  const { t } = useT();
  const plural = usePlural();
  const { total, inStock } = flow.products;
  if (total === 0) return null;
  return inStock > 0 ? (
    <Alert tone="success" title={plural(total, 'setup_products.done_alert')}>
      {t('setup_products.done_alert_text')}
    </Alert>
  ) : (
    <Alert tone="warn" title={t('setup_products.done_none_in_stock_title')}>
      {t('setup_products.done_none_in_stock_text')}
    </Alert>
  );
}

/** A short «Налаштовуємо AI-агента»: the account, the products (fresh after an import), and the next step. */
function BotSkills({ flow }: { flow: ProductSourceFlow }) {
  const { t } = useT();
  const plural = usePlural();
  const { status, steps, goTo } = useSetup();
  const knowledge = steps.find((s) => s.key === 'knowledge');
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-dm-line bg-dm-sunken p-2.5">
      <span className="px-2.5 py-1 text-[13px] font-medium text-dm-muted">{t('setup_products.skills_title')}</span>
      <div className="flex flex-col gap-0.5">
        <SkillRow state="done" label={t('setup_products.skill_account', { store: status.store.name })} />
        <SkillRow
          state="done"
          label={t('setup_products.skill_products')}
          trailing={<span className="whitespace-nowrap text-xs text-dm-muted">{plural(flow.products.total, 'setup_shell.products')}</span>}
          fresh={flow.justImported}
          freshLabel={t('setup_products.fresh')}
        />
        {knowledge &&
          (knowledge.state === 'done' ? (
            <SkillRow state="done" label={t('setup_products.skill_knowledge')} />
          ) : (
            <SkillRow state="todo" n={knowledge.n} label={t('setup_products.skill_knowledge')} onClick={() => goTo('knowledge')} />
          ))}
      </div>
    </div>
  );
}
