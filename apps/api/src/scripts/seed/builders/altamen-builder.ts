// Alta Men demo builder — men's clothing vertical using the scraped
// altamen.com.ua catalog (merged to 128 products / 1169 variants). Same
// clothing businessType as the women-clothes demo, but `before_search`:
// height/weight are collected up front, mapped through a men's size chart
// covering S–3XL. No size-chart images (the site has none), so
// sizeHelpMode is 'measurements'. Templates come from the men's copy pack.
//
// Shoes (37 products, numeric sizes 40–45) are included; the measurements
// flow doesn't map shoe sizes — a shoe-size question falls through to the
// generic variant-choice path, which is acceptable for the demo.

import { DataSource } from 'typeorm';
import { getAltamenProducts } from '../data/altamen-products';
import { getTemplatesForBusinessType } from '../templates';
import { ALTAMEN_KNOWLEDGE_DOC } from '../knowledge/clothing-men';
import {
  DEMO_HANDOFF_ANNOUNCE_NO_EMOJI,
  DEMO_PAYMENT_DETAILS,
  DEMO_WELCOME_LINE,
} from '../knowledge/demo-store-copy';
import {
  CreateTenantOpts,
  copyImages,
  createStoreConfig,
  createTenant,
  createTenantSettings,
  seedCatalog,
  seedProductMedia,
  seedResponseTemplates,
} from './tenant-builder';

const ALTAMEN_FLOW_CONFIG = {
  // Engine routing vertical. The TEMPLATE pack is 'clothing-men' (see
  // below) — a copy variant, not a separate engine vertical.
  businessType: 'clothing',
  // Ask height/weight up front rather than offering size help after a
  // browse. Note the engine skips the gate when the turn names a product
  // («Хочу замовити сорочку» → entities.productName), so the question
  // lands on category-only openers.
  preQualifyStrategy: 'before_search',
  sizeHelpMode: 'measurements',
  // v2 agent: recommend a size from the ranges below and offer a manager's
  // check to anyone who wants to be sure. Measurements are not asked up
  // front: the agent shows options first and asks when sizes come up.
  sizing: { advice: 'recommend', askMeasurementsFirst: false },
  // One line per product, colour counts instead of colour names. The detailed
  // renderer put a 5-product list at 573 chars / 23 lines — a full phone screen
  // in a DM, before the product photos. Opt-in per tenant: production tenants
  // keep the detailed form.
  productListStyle: 'compact',
  preQualify: {
    enabled: true,
    fields: ['height', 'weight'],
    prompt: 'Підкажіть ваш зріст та вагу — підберу розмір 👌',
  },
  // Men's ranges; keys match the catalog's size labels (incl. 2XL/3XL).
  sizeChart: {
    S: { heightMin: 165, heightMax: 175, weightMin: 55, weightMax: 70 },
    M: { heightMin: 170, heightMax: 180, weightMin: 65, weightMax: 80 },
    L: { heightMin: 175, heightMax: 185, weightMin: 75, weightMax: 90 },
    XL: { heightMin: 178, heightMax: 190, weightMin: 85, weightMax: 100 },
    '2XL': { heightMin: 180, heightMax: 195, weightMin: 95, weightMax: 115 },
    '3XL': { heightMin: 182, heightMax: 200, weightMin: 110, weightMax: 130 },
  },
};

const ALTAMEN_TENANT_SETTINGS = {
  brandTonePrompt:
    'Стримана, впевнена українська — преміальний чоловічий одяг. Тепло, але без фамільярності. Емодзі мінімально (👌 зрідка), без 💛.',
  supportedLanguages: ['uk'],
  businessHours: { mon_fri: '09:00-19:00', sat: '10:00-16:00', sun: 'closed' },
  handoffRules: { maxFailedTurns: 5 },
  aiSettings: { fallbackPolicy: 'template_first_with_safe_fallback' },
};

export async function buildAltamenTenant(
  ds: DataSource,
  opts: CreateTenantOpts,
): Promise<string> {
  console.log(`\n→ Building Alta Men tenant: ${opts.slug}`);

  const tenantId = await createTenant(ds, opts);
  console.log(`  tenant: ${tenantId}`);

  await createTenantSettings(ds, tenantId, ALTAMEN_TENANT_SETTINGS);
  console.log(`  tenant_settings: ✓`);

  await createStoreConfig(ds, tenantId, {
    // Menswear voice: no 💛 anywhere. The template pack enforces it at seed
    // time; disallowedPhrases makes the agent's style guard enforce it too.
    brandConfig: { welcomeLine: DEMO_WELCOME_LINE, disallowedPhrases: ['💛'] },
    flowConfig: ALTAMEN_FLOW_CONFIG,
    checkoutConfig: {
      fields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'],
      paymentDetails: DEMO_PAYMENT_DETAILS,
    },
    escalationConfig: {},
    recommendationConfig: {},
    handoffConfig: { announceText: DEMO_HANDOFF_ANNOUNCE_NO_EMOJI },
    fallbackConfig: { mode: 'template_first_with_safe_fallback' },
    operatingMode: 'active',
    knowledgeDoc: ALTAMEN_KNOWLEDGE_DOC,
  });
  console.log(
    `  store_config: ✓ (businessType=${ALTAMEN_FLOW_CONFIG.businessType}, ` +
      `preQualifyStrategy=${ALTAMEN_FLOW_CONFIG.preQualifyStrategy}, ` +
      `sizeHelpMode=${ALTAMEN_FLOW_CONFIG.sizeHelpMode})`,
  );

  const products = getAltamenProducts();
  const catalog = await seedCatalog(ds, tenantId, products);
  console.log(
    `  catalog: ${catalog.productsCreated} products, ${catalog.variantsCreated} variants`,
  );

  // Product-level AND per-variant images. The loader emits each colour's
  // `imageFile` on that colour's FIRST variant, and `seedProductMedia` inserts
  // a colour-keyed `product_media` row for every one of them — so a
  // product-level-only copy list leaves those rows pointing at files that were
  // never copied. It went unnoticed locally because `uploads/` accumulates
  // across seed runs; a fresh box exposed it as 266 media rows against 128
  // files (the cosmetics builder already collects both).
  const imageFiles = products
    .flatMap((p) => [p.imageFile, ...p.variants.map((v) => v.imageFile)])
    .filter((f): f is string => Boolean(f));
  const urlPrefix = await copyImages('altamen', 'altamen', Array.from(new Set(imageFiles)));
  await seedProductMedia(ds, tenantId, products, urlPrefix);

  // Men's copy variant: same scenarios, restrained voice, no 💛.
  const templates = getTemplatesForBusinessType('clothing-men');
  await seedResponseTemplates(ds, tenantId, templates);

  console.log(`✓ Alta Men tenant ready: ${opts.slug}\n`);
  return tenantId;
}
