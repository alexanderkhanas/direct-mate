// Cosmetics-vertical demo builder. Orchestrates the full seed pipeline for a
// cosmetics demo tenant: tenant + settings + store_config (with skin-type
// preQualify, no sizeChart) + 10 products + 13 variants + 18 templates from
// getTemplatesForBusinessType('cosmetics').
//
// Image files are downloaded once into apps/api/test-assets/cosmetics/ and
// served at /uploads/cosmetics/<file> after the seed copies them to uploads/.

import { DataSource } from 'typeorm';
import { COSMETICS_PRODUCTS } from '../data/cosmetics-products';
import { getTemplatesForBusinessType } from '../templates';
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

const COSMETICS_FLOW_CONFIG = {
  businessType: 'cosmetics',
  // Cosmetics demo defaults to before_search: skin type drives the entire
  // recommendation, so asking up-front is the natural UX. Clothing demo,
  // by contrast, defaults to after_search_offered (browse-first).
  preQualifyStrategy: 'before_search',
  preQualify: {
    enabled: true,
    fields: ['skinType'],
    prompt: 'Який у вас тип шкіри? (жирна / суха / нормальна / комбінована / чутлива) 💛',
  },
  // No sizeChart for cosmetics — engine reads businessType=cosmetics and
  // routes to handlePreQualifyCosmetics which uses classifier.entities.skinType.
};

const COSMETICS_TENANT_SETTINGS = {
  brandTonePrompt:
    'Тепла, експертна українська. Орієнтована на рекомендації за типом шкіри. Емодзі 💛 акуратно.',
  supportedLanguages: ['uk'],
  businessHours: { mon_fri: '09:00-18:00', sat: '10:00-15:00', sun: 'closed' },
  handoffRules: { maxFailedTurns: 5 },
  aiSettings: { fallbackPolicy: 'template_first_with_safe_fallback' },
};

export async function buildCosmeticsTenant(
  ds: DataSource,
  opts: CreateTenantOpts,
): Promise<string> {
  console.log(`\n→ Building cosmetics tenant: ${opts.slug}`);

  const tenantId = await createTenant(ds, opts);
  console.log(`  tenant: ${tenantId}`);

  await createTenantSettings(ds, tenantId, COSMETICS_TENANT_SETTINGS);
  console.log(`  tenant_settings: ✓`);

  await createStoreConfig(ds, tenantId, {
    brandConfig: {},
    flowConfig: COSMETICS_FLOW_CONFIG,
    checkoutConfig: { fields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'] },
    escalationConfig: {},
    recommendationConfig: {},
    handoffConfig: {},
    fallbackConfig: { mode: 'template_first_with_safe_fallback' },
    operatingMode: 'active',
  });
  console.log(`  store_config: ✓ (businessType=cosmetics, preQualifyStrategy=after_search_offered)`);

  const catalog = await seedCatalog(ds, tenantId, COSMETICS_PRODUCTS);
  console.log(
    `  catalog: ${catalog.productsCreated} products, ${catalog.variantsCreated} variants`,
  );

  // Collect all image filenames referenced by products + variant overrides
  const imageFiles = Array.from(
    new Set(
      COSMETICS_PRODUCTS.flatMap((p) => [
        p.imageFile,
        ...p.variants.map((v) => v.imageFile),
      ]).filter((f): f is string => Boolean(f)),
    ),
  );
  const urlPrefix = await copyImages('cosmetics', 'cosmetics', imageFiles);
  await seedProductMedia(ds, tenantId, COSMETICS_PRODUCTS, urlPrefix);

  const templates = getTemplatesForBusinessType('cosmetics');
  await seedResponseTemplates(ds, tenantId, templates);

  console.log(`✓ Cosmetics tenant ready: ${opts.slug}\n`);
  return tenantId;
}
