import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../database/data-source';

// Tenant that provides the "source of truth" for settings, store config,
// response templates, phrase blocks, and FAQ items. Must exist already —
// seed logs a warning and continues if not.
const SOURCE_TENANT_SLUG = 'clothes-store';

const DEMO_SLUG = 'demo';
const DEMO_NAME = 'Demo Store';

// ─── Product catalog ─────────────────────────────────────────────

interface VariantSpec {
  color: string | null;
  size: string | null;
  price: number;
  stock: number;
}

interface ProductSpec {
  externalId: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  variants: VariantSpec[];
}

// 18 women's clothing items. Diversity:
//  - most cover both color + size
//  - p-02, p-06, p-12, p-13, p-14 are single-color multi-size (size-only axis)
//  - p-15 is multi-color one-size (color-only axis)
//  - p-17 is a single-variant product (auto-select path)
//  - p-04 has Blue M deliberately out-of-stock (variant_not_available path)
const PRODUCTS: ProductSpec[] = [
  // ── Zara (6) ────────────────────────────────────────────────
  {
    externalId: 'demo-p-01', title: 'Zara Базова футболка oversize', brand: 'Zara',
    category: 'Футболки', description: 'М\'яка бавовна, класичний oversize-крій.',
    variants: [
      { color: 'White', size: 'S', price: 799, stock: 15 },
      { color: 'White', size: 'M', price: 799, stock: 12 },
      { color: 'White', size: 'L', price: 799, stock: 10 },
      { color: 'Black', size: 'S', price: 799, stock: 15 },
      { color: 'Black', size: 'M', price: 799, stock: 8 },
      { color: 'Black', size: 'L', price: 799, stock: 5 },
      { color: 'Black', size: 'XL', price: 799, stock: 0 },
    ],
  },
  {
    externalId: 'demo-p-02', title: 'Zara Кремова блуза з рюшами', brand: 'Zara',
    category: 'Сорочки', description: 'Шифонова блуза на літо.',
    variants: [
      { color: 'Cream', size: 'S', price: 1299, stock: 5 },
      { color: 'Cream', size: 'M', price: 1299, stock: 5 },
      { color: 'Cream', size: 'L', price: 1299, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-03', title: 'Zara Спідниця плісе', brand: 'Zara',
    category: 'Спідниці', description: 'Плісерована спідниця міді.',
    variants: [
      { color: 'Black', size: 'XS', price: 1599, stock: 5 },
      { color: 'Black', size: 'S', price: 1599, stock: 15 },
      { color: 'Black', size: 'M', price: 1599, stock: 15 },
      { color: 'Black', size: 'L', price: 1599, stock: 5 },
      { color: 'Navy', size: 'S', price: 1599, stock: 15 },
      { color: 'Navy', size: 'M', price: 1599, stock: 15 },
      { color: 'Navy', size: 'L', price: 1599, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-04', title: 'Zara Сорочка оверсайз', brand: 'Zara',
    category: 'Сорочки', description: 'Класична сорочка oversize.',
    variants: [
      { color: 'White', size: 'S', price: 1199, stock: 5 },
      { color: 'White', size: 'M', price: 1199, stock: 15 },
      { color: 'White', size: 'L', price: 1199, stock: 5 },
      { color: 'Blue', size: 'S', price: 1199, stock: 15 },
      { color: 'Blue', size: 'M', price: 1199, stock: 0 },   // deliberately OOS
      { color: 'Blue', size: 'L', price: 1199, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-05', title: 'Zara Міні-спідниця джинсова', brand: 'Zara',
    category: 'Спідниці', description: 'Коротка джинсова спідниця.',
    variants: [
      { color: 'Light Blue', size: 'XS', price: 999, stock: 5 },
      { color: 'Light Blue', size: 'S', price: 999, stock: 15 },
      { color: 'Light Blue', size: 'M', price: 999, stock: 15 },
      { color: 'Dark Blue', size: 'XS', price: 999, stock: 5 },
      { color: 'Dark Blue', size: 'S', price: 999, stock: 15 },
      { color: 'Dark Blue', size: 'M', price: 999, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-06', title: 'Zara Футболка з принтом', brand: 'Zara',
    category: 'Футболки', description: 'Бавовняна футболка з графічним принтом.',
    variants: [
      { color: 'White', size: 'S', price: 599, stock: 15 },
      { color: 'White', size: 'M', price: 599, stock: 15 },
      { color: 'White', size: 'L', price: 599, stock: 15 },
    ],
  },

  // ── H&M (6) ─────────────────────────────────────────────────
  {
    externalId: 'demo-p-07', title: 'H&M Базові джинси скіні', brand: 'H&M',
    category: 'Джинси', description: 'Тягнучий деніма, середня посадка.',
    variants: [
      { color: 'Blue', size: 'W26', price: 1099, stock: 15 },
      { color: 'Blue', size: 'W28', price: 1099, stock: 15 },
      { color: 'Blue', size: 'W30', price: 1099, stock: 5 },
      { color: 'Black', size: 'W26', price: 1099, stock: 15 },
      { color: 'Black', size: 'W28', price: 1099, stock: 15 },
      { color: 'Black', size: 'W30', price: 1099, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-08', title: 'H&M Худі oversize', brand: 'H&M',
    category: 'Худі', description: 'Флісове худі з капюшоном.',
    variants: [
      { color: 'Grey', size: 'S', price: 899, stock: 15 },
      { color: 'Grey', size: 'M', price: 899, stock: 15 },
      { color: 'Grey', size: 'L', price: 899, stock: 15 },
      { color: 'Pink', size: 'S', price: 899, stock: 5 },
      { color: 'Pink', size: 'M', price: 899, stock: 5 },
      { color: 'Pink', size: 'L', price: 899, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-09', title: 'H&M Світшот з логотипом', brand: 'H&M',
    category: 'Світшоти', description: 'Класичний світшот з вишитим лого.',
    variants: [
      { color: 'White', size: 'S', price: 749, stock: 15 },
      { color: 'White', size: 'M', price: 749, stock: 15 },
      { color: 'White', size: 'L', price: 749, stock: 5 },
      { color: 'Black', size: 'S', price: 749, stock: 15 },
      { color: 'Black', size: 'M', price: 749, stock: 15 },
      { color: 'Black', size: 'L', price: 749, stock: 15 },
      { color: 'Black', size: 'XL', price: 749, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-10', title: 'H&M Сукня-сорочка', brand: 'H&M',
    category: 'Плаття', description: 'Легка сукня на кожен день.',
    variants: [
      { color: 'Beige', size: 'XS', price: 1399, stock: 5 },
      { color: 'Beige', size: 'S', price: 1399, stock: 15 },
      { color: 'Beige', size: 'M', price: 1399, stock: 15 },
      { color: 'Beige', size: 'L', price: 1399, stock: 5 },
      { color: 'Olive', size: 'S', price: 1399, stock: 15 },
      { color: 'Olive', size: 'M', price: 1399, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-11', title: 'H&M Джинси мом-фіт', brand: 'H&M',
    category: 'Джинси', description: 'Висока посадка, вільний крій.',
    variants: [
      { color: 'Light Blue', size: 'W26', price: 1199, stock: 15 },
      { color: 'Light Blue', size: 'W28', price: 1199, stock: 15 },
      { color: 'Light Blue', size: 'W30', price: 1199, stock: 5 },
      { color: 'Medium Blue', size: 'W26', price: 1199, stock: 15 },
      { color: 'Medium Blue', size: 'W28', price: 1199, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-12', title: 'H&M Плаття міді чорне', brand: 'H&M',
    category: 'Плаття', description: 'Класичне чорне плаття.',
    variants: [
      { color: 'Black', size: 'S', price: 1599, stock: 5 },
      { color: 'Black', size: 'M', price: 1599, stock: 5 },
      { color: 'Black', size: 'L', price: 1599, stock: 5 },
    ],
  },

  // ── Mango (6) — axis mix ─────────────────────────────────────
  {
    externalId: 'demo-p-13', title: 'Mango Шкіряна куртка байкер', brand: 'Mango',
    category: 'Куртки', description: 'Штучна шкіра, короткий фасон.',
    variants: [
      { color: 'Black', size: 'S', price: 2899, stock: 5 },
      { color: 'Black', size: 'M', price: 2899, stock: 5 },
      { color: 'Black', size: 'L', price: 2899, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-14', title: 'Mango Тренчкот класичний', brand: 'Mango',
    category: 'Куртки', description: 'Двобортний тренч з поясом.',
    variants: [
      { color: 'Beige', size: 'S', price: 3499, stock: 5 },
      { color: 'Beige', size: 'M', price: 3499, stock: 5 },
      { color: 'Beige', size: 'L', price: 3499, stock: 5 },
      { color: 'Beige', size: 'XL', price: 3499, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-15', title: 'Mango Блейзер oversize', brand: 'Mango',
    category: 'Блейзери', description: 'Подвійна застібка, one-size.',
    variants: [
      { color: 'Black', size: null, price: 2299, stock: 15 },
      { color: 'Navy', size: null, price: 2299, stock: 15 },
      { color: 'Beige', size: null, price: 2299, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-16', title: 'Mango Сукня міді', brand: 'Mango',
    category: 'Сукні', description: 'Трикотажна сукня з розрізом.',
    variants: [
      { color: 'Red', size: 'XS', price: 1899, stock: 5 },
      { color: 'Red', size: 'S', price: 1899, stock: 15 },
      { color: 'Red', size: 'M', price: 1899, stock: 15 },
      { color: 'Red', size: 'L', price: 1899, stock: 5 },
      { color: 'Black', size: 'S', price: 1899, stock: 15 },
      { color: 'Black', size: 'M', price: 1899, stock: 15 },
      { color: 'Black', size: 'L', price: 1899, stock: 15 },
    ],
  },
  {
    externalId: 'demo-p-17', title: 'Mango Сукня коктейльна', brand: 'Mango',
    category: 'Сукні', description: 'Лімітована колекція, залишок тільки розміру M.',
    variants: [
      { color: 'Black', size: 'M', price: 2499, stock: 5 },
    ],
  },
  {
    externalId: 'demo-p-18', title: 'Mango Штани палацо', brand: 'Mango',
    category: 'Штани', description: 'Широкі штани з високою посадкою.',
    variants: [
      { color: 'Black', size: 'S', price: 1799, stock: 15 },
      { color: 'Black', size: 'M', price: 1799, stock: 15 },
      { color: 'Black', size: 'L', price: 1799, stock: 5 },
      { color: 'White', size: 'S', price: 1799, stock: 15 },
      { color: 'White', size: 'M', price: 1799, stock: 15 },
    ],
  },
];

// ─── Size chart specs ────────────────────────────────────────────

interface SizeChartSpec {
  name: string;
  sourceFile: string;   // path under apps/api/test-assets/
  uploadFile: string;   // file name under uploads/
  brands: string[];     // already-lowercased
  categories: string[]; // already-lowercased
  isDefault: boolean;
}

const SIZE_CHARTS: SizeChartSpec[] = [
  {
    name: 'Zara footwear-free sizing',
    sourceFile: 'demo-chart-zara.png',
    uploadFile: 'demo-chart-zara.png',
    brands: ['zara'],
    categories: ['футболки', 'сорочки', 'спідниці'],
    isDefault: false,
  },
  {
    name: 'H&M casual sizes',
    sourceFile: 'demo-chart-hm.png',
    uploadFile: 'demo-chart-hm.png',
    brands: ['h&m'],
    categories: ['джинси', 'худі', 'світшоти'],
    isDefault: false,
  },
  {
    name: 'Generic women\'s chart',
    sourceFile: 'demo-chart-generic.png',
    uploadFile: 'demo-chart-generic.png',
    brands: [],
    categories: [],
    isDefault: true,
  },
];

// ─── Seed entry point ───────────────────────────────────────────

async function seed() {
  await AppDataSource.initialize();

  // 1. Demo tenant
  const demoTenantId = await findOrCreateDemoTenant();

  // 2. Source tenant for settings/templates copy
  const sourceTenantId = await resolveSourceTenantId();

  // 3. tenant_settings — copy from source, verbatim
  await copyTenantSettings(demoTenantId, sourceTenantId);

  // 4. store_configs — copy from source
  await copyStoreConfig(demoTenantId, sourceTenantId);

  // 5. Products, variants, stock
  await seedCatalog(demoTenantId);

  // 6. Size charts (copy files, then DB rows)
  await copyChartImages();
  await seedSizeCharts(demoTenantId);

  // 7. Response templates, phrase blocks, FAQ — copy from source
  await copyResponseTemplates(demoTenantId, sourceTenantId);
  await copyPhraseBlocks(demoTenantId, sourceTenantId);
  await copyFaqItems(demoTenantId, sourceTenantId);

  await AppDataSource.destroy();
  console.log('\n✓ Demo tenant seed complete.');
}

// ─── Section 1: tenant row ──────────────────────────────────────

async function findOrCreateDemoTenant(): Promise<string> {
  const existing = await AppDataSource.query(
    `SELECT id, is_demo FROM tenants WHERE slug = $1 LIMIT 1`,
    [DEMO_SLUG],
  );
  if (existing.length > 0) {
    const { id, is_demo } = existing[0];
    if (!is_demo) {
      await AppDataSource.query(
        `UPDATE tenants SET is_demo = true WHERE id = $1`,
        [id],
      );
      console.log(`✓ Demo tenant flag promoted to is_demo=true: ${id}`);
    } else {
      console.log(`- Demo tenant already exists: ${id}`);
    }
    return id;
  }
  const inserted = await AppDataSource.query(
    `INSERT INTO tenants (name, slug, business_type, timezone, is_active, is_demo)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [DEMO_NAME, DEMO_SLUG, 'fashion', 'Europe/Kyiv', true, true],
  );
  console.log(`✓ Demo tenant created: ${inserted[0].id}`);
  return inserted[0].id;
}

// ─── Section 2: resolve source tenant ───────────────────────────

async function resolveSourceTenantId(): Promise<string | null> {
  const row = await AppDataSource.query(
    `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
    [SOURCE_TENANT_SLUG],
  );
  if (row.length === 0) {
    console.warn(
      `! Source tenant "${SOURCE_TENANT_SLUG}" not found — settings / templates ` +
        `will be skipped. Demo tenant will fall back to AI replies.`,
    );
    return null;
  }
  return row[0].id;
}

// ─── Section 3: tenant_settings ─────────────────────────────────

async function copyTenantSettings(
  demoId: string,
  sourceId: string | null,
): Promise<void> {
  const existing = await AppDataSource.query(
    `SELECT id FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
    [demoId],
  );
  if (existing.length > 0) {
    console.log(`- tenant_settings already exists`);
    return;
  }
  if (!sourceId) {
    console.log(`! tenant_settings skipped (no source)`);
    return;
  }
  const src = await AppDataSource.query(
    `SELECT brand_tone_prompt, supported_languages, business_hours,
            handoff_rules, ai_settings
     FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
    [sourceId],
  );
  if (src.length === 0) {
    console.log(`! tenant_settings skipped (source has none)`);
    return;
  }
  const s = src[0];
  await AppDataSource.query(
    `INSERT INTO tenant_settings (tenant_id, brand_tone_prompt, supported_languages,
                                   business_hours, handoff_rules, ai_settings)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      demoId,
      s.brand_tone_prompt,
      JSON.stringify(s.supported_languages ?? []),
      s.business_hours ? JSON.stringify(s.business_hours) : null,
      s.handoff_rules ? JSON.stringify(s.handoff_rules) : null,
      s.ai_settings ? JSON.stringify(s.ai_settings) : null,
    ],
  );
  console.log(`✓ tenant_settings copied from ${SOURCE_TENANT_SLUG}`);
}

// ─── Section 4: store_configs ────────────────────────────────────

async function copyStoreConfig(
  demoId: string,
  sourceId: string | null,
): Promise<void> {
  const existing = await AppDataSource.query(
    `SELECT id FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
    [demoId],
  );
  if (existing.length > 0) {
    console.log(`- store_configs already exists`);
    return;
  }
  if (!sourceId) {
    console.log(`! store_configs skipped (no source)`);
    return;
  }
  const src = await AppDataSource.query(
    `SELECT brand_config, flow_config, checkout_config, escalation_config,
            recommendation_config, handoff_config, fallback_config, operating_mode
     FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
    [sourceId],
  );
  if (src.length === 0) {
    console.log(`! store_configs skipped (source has none)`);
    return;
  }
  const c = src[0];
  await AppDataSource.query(
    `INSERT INTO store_configs (tenant_id, brand_config, flow_config,
                                 checkout_config, escalation_config,
                                 recommendation_config, handoff_config,
                                 fallback_config, operating_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      demoId,
      JSON.stringify(c.brand_config ?? {}),
      JSON.stringify(c.flow_config ?? {}),
      JSON.stringify(c.checkout_config ?? {}),
      JSON.stringify(c.escalation_config ?? {}),
      JSON.stringify(c.recommendation_config ?? {}),
      JSON.stringify(c.handoff_config ?? {}),
      JSON.stringify(c.fallback_config ?? {}),
      c.operating_mode ?? 'active',
    ],
  );
  console.log(`✓ store_configs copied from ${SOURCE_TENANT_SLUG}`);
}

// ─── Section 5: catalog ─────────────────────────────────────────

async function seedCatalog(tenantId: string): Promise<void> {
  let productsCreated = 0;
  let productsExisting = 0;
  let variantsCreated = 0;
  let variantsExisting = 0;

  for (const spec of PRODUCTS) {
    const existing = await AppDataSource.query(
      `SELECT id FROM products
       WHERE tenant_id = $1 AND external_product_id = $2 LIMIT 1`,
      [tenantId, spec.externalId],
    );
    let productId: string;
    if (existing.length > 0) {
      productId = existing[0].id;
      productsExisting++;
    } else {
      const inserted = await AppDataSource.query(
        `INSERT INTO products (tenant_id, external_product_id, title,
                                description, category, brand, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         RETURNING id`,
        [
          tenantId, spec.externalId, spec.title,
          spec.description, spec.category, spec.brand,
        ],
      );
      productId = inserted[0].id;
      productsCreated++;
    }

    for (const v of spec.variants) {
      const variantId = await upsertVariant(productId, spec.externalId, v);
      if (variantId.created) variantsCreated++;
      else variantsExisting++;
      await upsertStock(variantId.id, v.stock);
    }
  }

  console.log(
    `✓ Catalog: ${productsCreated} products created, ${productsExisting} existed; ` +
      `${variantsCreated} variants created, ${variantsExisting} existed`,
  );
}

async function upsertVariant(
  productId: string,
  productExternalId: string,
  v: VariantSpec,
): Promise<{ id: string; created: boolean }> {
  // Variant identity: (product_id, color, size) tuple with NULL-safe equality.
  const existing = await AppDataSource.query(
    `SELECT id FROM product_variants
     WHERE product_id = $1
       AND color IS NOT DISTINCT FROM $2
       AND size IS NOT DISTINCT FROM $3
     LIMIT 1`,
    [productId, v.color, v.size],
  );
  if (existing.length > 0) {
    return { id: existing[0].id, created: false };
  }
  // Deterministic external_variant_id so re-runs stay stable even if a
  // catalog row is deleted by hand.
  const externalVariantId = `${productExternalId}-${(v.color ?? '_')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-${(v.size ?? '_').toLowerCase()}`;
  const inserted = await AppDataSource.query(
    `INSERT INTO product_variants (product_id, external_variant_id,
                                    color, size, price, currency, active)
     VALUES ($1, $2, $3, $4, $5, 'UAH', true)
     RETURNING id`,
    [productId, externalVariantId, v.color, v.size, v.price],
  );
  return { id: inserted[0].id, created: true };
}

async function upsertStock(variantId: string, stock: number): Promise<void> {
  const existing = await AppDataSource.query(
    `SELECT id FROM stock_balances WHERE variant_id = $1 LIMIT 1`,
    [variantId],
  );
  if (existing.length > 0) {
    await AppDataSource.query(
      `UPDATE stock_balances
       SET available_qty = $2, last_synced_at = now(), updated_at = now()
       WHERE id = $1`,
      [existing[0].id, stock],
    );
  } else {
    await AppDataSource.query(
      `INSERT INTO stock_balances (variant_id, available_qty, last_synced_at)
       VALUES ($1, $2, now())`,
      [variantId, stock],
    );
  }
}

// ─── Section 6: size charts ─────────────────────────────────────

async function copyChartImages(): Promise<void> {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const testAssetsDir = path.join(__dirname, '..', '..', 'test-assets');
  for (const chart of SIZE_CHARTS) {
    const src = path.join(testAssetsDir, chart.sourceFile);
    const dest = path.join(uploadsDir, chart.uploadFile);
    if (!fs.existsSync(src)) {
      console.warn(`! chart source missing: ${src} — skipped`);
      continue;
    }
    if (fs.existsSync(dest)) {
      console.log(`- chart image already exists: uploads/${chart.uploadFile}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    console.log(`✓ chart image copied: uploads/${chart.uploadFile}`);
  }
}

async function seedSizeCharts(tenantId: string): Promise<void> {
  let created = 0;
  let existing = 0;
  for (const chart of SIZE_CHARTS) {
    const found = await AppDataSource.query(
      `SELECT id FROM size_charts
       WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
      [tenantId, chart.name],
    );
    if (found.length > 0) {
      existing++;
      continue;
    }
    await AppDataSource.query(
      `INSERT INTO size_charts (tenant_id, name, image_path,
                                 brands, categories, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        chart.name,
        `uploads/${chart.uploadFile}`,
        chart.brands,
        chart.categories,
        chart.isDefault,
      ],
    );
    created++;
  }
  console.log(`✓ size_charts: ${created} created, ${existing} existed`);
}

// ─── Section 7: copy templates / phrases / faq ──────────────────

async function copyResponseTemplates(
  demoId: string,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId) {
    console.log(`! response_templates skipped (no source)`);
    return;
  }
  const before = await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM response_templates WHERE tenant_id = $1`,
    [demoId],
  );
  const result = await AppDataSource.query(
    `INSERT INTO response_templates (tenant_id, scenario, stage, blocks,
                                      required_variables, tone_tags,
                                      priority, active)
     SELECT $1, scenario, stage, blocks,
            required_variables, tone_tags, priority, active
     FROM response_templates src
     WHERE src.tenant_id = $2
       AND src.active = true
       AND NOT EXISTS (
         SELECT 1 FROM response_templates rt2
         WHERE rt2.tenant_id = $1
           AND rt2.scenario = src.scenario
           AND rt2.blocks::text = src.blocks::text
       )`,
    [demoId, sourceId],
  );
  const after = await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM response_templates WHERE tenant_id = $1`,
    [demoId],
  );
  const added = after[0].n - before[0].n;
  console.log(
    `✓ response_templates: ${added} new rows (${after[0].n} total for demo tenant)`,
  );
}

async function copyPhraseBlocks(
  demoId: string,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId) {
    console.log(`! phrase_blocks skipped (no source)`);
    return;
  }
  const before = await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM phrase_blocks WHERE tenant_id = $1`,
    [demoId],
  );
  await AppDataSource.query(
    `INSERT INTO phrase_blocks (tenant_id, type, text, scenario_tags, active)
     SELECT $1, type, text, scenario_tags, active
     FROM phrase_blocks src
     WHERE src.tenant_id = $2
       AND src.active = true
       AND NOT EXISTS (
         SELECT 1 FROM phrase_blocks pb2
         WHERE pb2.tenant_id = $1
           AND pb2.type = src.type
           AND pb2.text = src.text
       )`,
    [demoId, sourceId],
  );
  const after = await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM phrase_blocks WHERE tenant_id = $1`,
    [demoId],
  );
  const added = after[0].n - before[0].n;
  console.log(
    `✓ phrase_blocks: ${added} new rows (${after[0].n} total for demo tenant)`,
  );
}

async function copyFaqItems(
  demoId: string,
  sourceId: string | null,
): Promise<void> {
  if (!sourceId) {
    console.log(`! faq_items skipped (no source)`);
    return;
  }
  const before = await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM faq_items WHERE tenant_id = $1`,
    [demoId],
  );
  await AppDataSource.query(
    `INSERT INTO faq_items (tenant_id, question_tags, answer_template, active)
     SELECT $1, question_tags, answer_template, active
     FROM faq_items src
     WHERE src.tenant_id = $2
       AND src.active = true
       AND NOT EXISTS (
         SELECT 1 FROM faq_items fi2
         WHERE fi2.tenant_id = $1
           AND fi2.answer_template = src.answer_template
       )`,
    [demoId, sourceId],
  );
  const after = await AppDataSource.query(
    `SELECT COUNT(*)::int AS n FROM faq_items WHERE tenant_id = $1`,
    [demoId],
  );
  const added = after[0].n - before[0].n;
  console.log(
    `✓ faq_items: ${added} new rows (${after[0].n} total for demo tenant)`,
  );
}

// ─── Run ────────────────────────────────────────────────────────

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
