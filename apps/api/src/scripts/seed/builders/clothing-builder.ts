// Clothing-vertical demo builder. Orchestrates the full seed pipeline for a
// clothing demo tenant: tenant + settings + store_config (with sizeChart and
// preQualify height/weight flow) + 18 products + 100 variants + size charts +
// 22 templates from getTemplatesForBusinessType('clothing').

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import {
  CLOTHING_WOMEN_PRODUCTS,
  CLOTHING_SIZE_CHARTS,
} from '../data/clothing-women-products';
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

const CLOTHING_FLOW_CONFIG = {
  businessType: 'clothing',
  preQualifyStrategy: 'after_search_offered',
  preQualify: {
    enabled: true,
    fields: ['height', 'weight'],
    prompt: 'Підкажіть ваш зріст та вагу, щоб підібрати розмір 💛',
  },
  sizeChart: {
    XS: { heightMin: 150, heightMax: 160, weightMin: 45, weightMax: 55 },
    S: { heightMin: 160, heightMax: 170, weightMin: 50, weightMax: 65 },
    M: { heightMin: 165, heightMax: 175, weightMin: 60, weightMax: 75 },
    L: { heightMin: 170, heightMax: 180, weightMin: 70, weightMax: 85 },
    XL: { heightMin: 175, heightMax: 190, weightMin: 80, weightMax: 100 },
  },
  sizeChartMappings: [
    { brands: ['zara'], categories: ['футболки', 'сорочки', 'спідниці'], sizeChart: 'XS-XL' },
  ],
};

const CLOTHING_TENANT_SETTINGS = {
  brandTonePrompt:
    'Тепла, дружня українська. Без формальностей, без сухих корпоративних фраз. Емодзі 💛 акуратно.',
  supportedLanguages: ['uk'],
  businessHours: { mon_fri: '09:00-18:00', sat: '10:00-15:00', sun: 'closed' },
  handoffRules: { maxFailedTurns: 5 },
  aiSettings: { fallbackPolicy: 'template_first_with_safe_fallback' },
};

export async function buildClothingTenant(
  ds: DataSource,
  opts: CreateTenantOpts,
): Promise<string> {
  console.log(`\n→ Building clothing tenant: ${opts.slug}`);

  const tenantId = await createTenant(ds, opts);
  console.log(`  tenant: ${tenantId}`);

  await createTenantSettings(ds, tenantId, CLOTHING_TENANT_SETTINGS);
  console.log(`  tenant_settings: ✓`);

  await createStoreConfig(ds, tenantId, {
    brandConfig: {},
    flowConfig: CLOTHING_FLOW_CONFIG,
    checkoutConfig: { fields: ['fullName', 'phone', 'city', 'novaPoshtaBranch'] },
    escalationConfig: {},
    recommendationConfig: {},
    handoffConfig: {},
    fallbackConfig: { mode: 'template_first_with_safe_fallback' },
    operatingMode: 'active',
  });
  console.log(`  store_config: ✓ (businessType=clothing, preQualifyStrategy=after_search_offered)`);

  const catalog = await seedCatalog(ds, tenantId, CLOTHING_WOMEN_PRODUCTS);
  console.log(
    `  catalog: ${catalog.productsCreated} products, ${catalog.variantsCreated} variants`,
  );

  // Image filenames (product + variant overrides — clothing has no variant
  // overrides so just product-level files).
  const imageFiles = CLOTHING_WOMEN_PRODUCTS.flatMap((p) => [
    p.imageFile,
    ...p.variants.map((v) => v.imageFile),
  ]).filter((f): f is string => Boolean(f));
  const urlPrefix = await copyImages('', '', Array.from(new Set(imageFiles)));
  await seedProductMedia(ds, tenantId, CLOTHING_WOMEN_PRODUCTS, urlPrefix);

  // Size charts — copy chart PNGs (also from test-assets/ root) + insert rows
  await copyTestAssetsToUploads(CLOTHING_SIZE_CHARTS.map((c) => c.imageFile), 'size_charts (images)');
  await seedSizeCharts(ds, tenantId);

  // Demo widget static assets — story/post reply previews referenced by
  // hardcoded scenario data in the admin frontend (apps/admin/src/components/
  // demo/scenarios/clothing-scenarios.ts). Live in test-assets/ (tracked) so
  // they ship with rsync; the seed copies them into uploads/ where the
  // /uploads static route serves them.
  await copyTestAssetsToUploads(DEMO_WIDGET_ASSETS, 'demo_widget (images)');

  const templates = getTemplatesForBusinessType('clothing');
  await seedResponseTemplates(ds, tenantId, templates);

  console.log(`✓ Clothing tenant ready: ${opts.slug}\n`);
  return tenantId;
}

const DEMO_WIDGET_ASSETS = [
  'story-reply-demo.JPG',  // Mango Сукня міді 2x2 collage — clothing story scenario
  'post-reply-demo.avif',  // standalone — kept available for future post variant
];

async function copyTestAssetsToUploads(
  filenames: string[],
  label: string,
): Promise<void> {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  // __dirname is apps/api/src/scripts/seed/builders/; test-assets is 4 levels up.
  const testAssetsDir = path.join(__dirname, '..', '..', '..', '..', 'test-assets');
  let copied = 0;
  let skipped = 0;
  for (const file of filenames) {
    const src = path.join(testAssetsDir, file);
    const dest = path.join(uploadsDir, file);
    if (!fs.existsSync(src)) {
      console.warn(`  ! source missing: ${src}`);
      continue;
    }
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    fs.copyFileSync(src, dest);
    copied++;
  }
  console.log(`  ${label}: ${copied} copied, ${skipped} existed`);
}

async function seedSizeCharts(ds: DataSource, tenantId: string): Promise<void> {
  for (const chart of CLOTHING_SIZE_CHARTS) {
    await ds.query(
      `INSERT INTO size_charts (tenant_id, name, image_path,
                                 brands, categories, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, chart.name, `uploads/${chart.imageFile}`, chart.brands, chart.categories, chart.isDefault],
    );
  }
  console.log(`  size_charts (rows): ${CLOTHING_SIZE_CHARTS.length} inserted`);
}
