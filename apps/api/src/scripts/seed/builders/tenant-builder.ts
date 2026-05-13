// Shared seed primitives used by both clothing-builder and cosmetics-builder.
// Replaces the legacy copy-from-clothes-store approach with explicit per-tenant
// inserts driven by TypeScript-source data files.

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { ProductSpec, VariantSpec } from '../data/types';
import { TemplateSpec } from '../templates/types';

// ─── Tenant lifecycle ───────────────────────────────────────────

/**
 * Hard-delete a tenant by slug. CASCADE removes all dependent rows across
 * 25 FK relationships (verified via Phase 0 audit). No-op if the tenant
 * doesn't exist.
 */
export async function deleteTenantBySlug(
  ds: DataSource,
  slug: string,
): Promise<void> {
  await ds.query(`DELETE FROM tenants WHERE slug = $1`, [slug]);
}

/**
 * Defensive verification — call AFTER deleteTenantBySlug calls and BEFORE
 * building. Catches edge cases where deletion silently failed (FK constraint,
 * permissions, race condition with another process) by failing loudly rather
 * than INSERTing duplicates.
 */
export async function assertNoOrphans(
  ds: DataSource,
  slugs: string[],
): Promise<void> {
  const rows: Array<{ slug: string }> = await ds.query(
    `SELECT slug FROM tenants WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  if (rows.length > 0) {
    throw new Error(
      `Orphan tenant(s) found after delete: ${rows.map((r) => r.slug).join(', ')}`,
    );
  }
}

export interface CreateTenantOpts {
  slug: string;
  name: string;
  /** Loose `tenants.business_type` text column (separate from engine-routing flow_config.businessType). */
  businessType: 'fashion' | 'cosmetics' | 'general';
  timezone?: string;
  /** Defaults to true. Set false for non-demo test tenants that need full engine behavior (orders, no rate limits). */
  isDemo?: boolean;
}

export async function createTenant(
  ds: DataSource,
  opts: CreateTenantOpts,
): Promise<string> {
  const inserted: Array<{ id: string }> = await ds.query(
    `INSERT INTO tenants (name, slug, business_type, timezone, is_active, is_demo)
     VALUES ($1, $2, $3, $4, true, $5)
     RETURNING id`,
    [opts.name, opts.slug, opts.businessType, opts.timezone ?? 'Europe/Kyiv', opts.isDemo ?? true],
  );
  return inserted[0].id;
}

// ─── tenant_settings + store_configs ────────────────────────────

export interface TenantSettingsSpec {
  brandTonePrompt: string;
  supportedLanguages: string[];
  businessHours?: Record<string, unknown> | null;
  handoffRules?: Record<string, unknown> | null;
  aiSettings?: Record<string, unknown> | null;
}

export async function createTenantSettings(
  ds: DataSource,
  tenantId: string,
  spec: TenantSettingsSpec,
): Promise<void> {
  await ds.query(
    `INSERT INTO tenant_settings (tenant_id, brand_tone_prompt, supported_languages,
                                   business_hours, handoff_rules, ai_settings)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tenantId,
      spec.brandTonePrompt,
      JSON.stringify(spec.supportedLanguages),
      spec.businessHours ? JSON.stringify(spec.businessHours) : null,
      spec.handoffRules ? JSON.stringify(spec.handoffRules) : null,
      spec.aiSettings ? JSON.stringify(spec.aiSettings) : null,
    ],
  );
}

export interface StoreConfigSpec {
  brandConfig: Record<string, unknown>;
  flowConfig: Record<string, unknown>;
  checkoutConfig: Record<string, unknown>;
  escalationConfig: Record<string, unknown>;
  recommendationConfig: Record<string, unknown>;
  handoffConfig: Record<string, unknown>;
  fallbackConfig: Record<string, unknown>;
  operatingMode?: 'learning' | 'active' | 'paused';
}

export async function createStoreConfig(
  ds: DataSource,
  tenantId: string,
  spec: StoreConfigSpec,
): Promise<void> {
  await ds.query(
    `INSERT INTO store_configs (tenant_id, brand_config, flow_config,
                                 checkout_config, escalation_config,
                                 recommendation_config, handoff_config,
                                 fallback_config, operating_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      tenantId,
      JSON.stringify(spec.brandConfig),
      JSON.stringify(spec.flowConfig),
      JSON.stringify(spec.checkoutConfig),
      JSON.stringify(spec.escalationConfig),
      JSON.stringify(spec.recommendationConfig),
      JSON.stringify(spec.handoffConfig),
      JSON.stringify(spec.fallbackConfig),
      spec.operatingMode ?? 'active',
    ],
  );
}

// ─── Catalog (products + variants + stock) ──────────────────────

export interface CatalogSeedResult {
  productsCreated: number;
  variantsCreated: number;
}

export async function seedCatalog(
  ds: DataSource,
  tenantId: string,
  products: ProductSpec[],
): Promise<CatalogSeedResult> {
  let productsCreated = 0;
  let variantsCreated = 0;
  for (const spec of products) {
    const inserted: Array<{ id: string }> = await ds.query(
      `INSERT INTO products (tenant_id, external_product_id, title,
                              description, category, brand, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id`,
      [tenantId, spec.externalId, spec.title, spec.description, spec.category, spec.brand],
    );
    const productId = inserted[0].id;
    productsCreated++;

    for (const v of spec.variants) {
      const variantId = await insertVariant(ds, tenantId, productId, spec.externalId, v);
      variantsCreated++;
      await insertStock(ds, variantId, v.stock);
    }
  }
  return { productsCreated, variantsCreated };
}

async function insertVariant(
  ds: DataSource,
  tenantId: string,
  productId: string,
  productExternalId: string,
  v: VariantSpec,
): Promise<string> {
  const externalVariantId = `${productExternalId}-${(v.color ?? '_')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}-${(v.size ?? '_').toLowerCase().replace(/\s+/g, '-')}`;
  const inserted: Array<{ id: string }> = await ds.query(
    `INSERT INTO product_variants (tenant_id, product_id, external_variant_id,
                                    color, size, price, currency, active)
     VALUES ($1, $2, $3, $4, $5, $6, 'UAH', true)
     RETURNING id`,
    [tenantId, productId, externalVariantId, v.color, v.size, v.price],
  );
  return inserted[0].id;
}

async function insertStock(
  ds: DataSource,
  variantId: string,
  stock: number,
): Promise<void> {
  await ds.query(
    `INSERT INTO stock_balances (variant_id, available_qty, last_synced_at)
     VALUES ($1, $2, now())`,
    [variantId, stock],
  );
}

// ─── Image copy + product_media ─────────────────────────────────

/**
 * Copy a list of image filenames from a test-assets subdir to
 * uploads/<urlSubdir>/. urlSubdir empty = serve from /uploads/<file>;
 * 'cosmetics' = serve from /uploads/cosmetics/<file>.
 *
 * Returns the URL prefix to embed in product_media.url ('/uploads/' or
 * '/uploads/<urlSubdir>/').
 */
export async function copyImages(
  testAssetsSubdir: string,
  urlSubdir: string,
  filenames: string[],
): Promise<string> {
  const cwd = process.cwd();
  const uploadsDir = urlSubdir
    ? path.join(cwd, 'uploads', urlSubdir)
    : path.join(cwd, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // __dirname points at apps/api/src/scripts/seed/builders/; test-assets
  // lives at apps/api/test-assets/ (4 levels up).
  const testAssetsDir = testAssetsSubdir
    ? path.join(__dirname, '..', '..', '..', '..', 'test-assets', testAssetsSubdir)
    : path.join(__dirname, '..', '..', '..', '..', 'test-assets');

  let copied = 0;
  let skipped = 0;
  let missing = 0;
  for (const file of filenames) {
    const src = path.join(testAssetsDir, file);
    const dest = path.join(uploadsDir, file);
    if (!fs.existsSync(src)) {
      console.warn(`! image source missing: ${src}`);
      missing++;
      continue;
    }
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    fs.copyFileSync(src, dest);
    copied++;
  }
  console.log(
    `  images: ${copied} copied, ${skipped} existed, ${missing} missing`,
  );
  return urlSubdir ? `/uploads/${urlSubdir}/` : '/uploads/';
}

/**
 * Insert one product_media row per product (variant-level media is added
 * separately for products whose variants override imageFile).
 */
export async function seedProductMedia(
  ds: DataSource,
  tenantId: string,
  products: ProductSpec[],
  urlPrefix: string,
): Promise<void> {
  let created = 0;
  for (const spec of products) {
    if (!spec.imageFile) continue;
    const url = `${urlPrefix}${spec.imageFile}`;
    const result: Array<{ id: string }> = await ds.query(
      `INSERT INTO product_media (product_id, url, sort_order, color)
       SELECT p.id, $1, 0, NULL
       FROM products p
       WHERE p.tenant_id = $2 AND p.external_product_id = $3
       RETURNING id`,
      [url, tenantId, spec.externalId],
    );
    if (result.length > 0) created++;

    // Variant-level media: when a variant has its own imageFile (different
    // from the parent product's), insert one row per variant tagged with
    // the variant color so the engine can pick the right image at render time.
    let order = 1;
    for (const v of spec.variants) {
      if (!v.imageFile || v.imageFile === spec.imageFile) continue;
      await ds.query(
        `INSERT INTO product_media (product_id, url, sort_order, color)
         SELECT p.id, $1, $2, $3
         FROM products p
         WHERE p.tenant_id = $4 AND p.external_product_id = $5`,
        [`${urlPrefix}${v.imageFile}`, order, v.color, tenantId, spec.externalId],
      );
      order++;
    }
  }
  console.log(`  product_media: ${created} primary + variant overrides inserted`);
}

// ─── Templates / phrases / faq insert ────────────────────────────

export async function seedResponseTemplates(
  ds: DataSource,
  tenantId: string,
  templates: TemplateSpec[],
): Promise<void> {
  for (const t of templates) {
    await ds.query(
      `INSERT INTO response_templates (tenant_id, scenario, stage, blocks,
                                        required_variables, tone_tags,
                                        priority, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        t.scenario,
        t.stage,
        JSON.stringify(t.blocks),
        JSON.stringify(t.requiredVariables),
        JSON.stringify(t.toneTags),
        t.priority,
        t.active,
      ],
    );
  }
  console.log(`  response_templates: ${templates.length} inserted`);
}
