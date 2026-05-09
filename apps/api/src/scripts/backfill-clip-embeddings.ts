// Backfill CLIP image embeddings for existing product_media rows.
//
// Run via: npm run backfill:clip-embeddings -- --tenant=<tenantId|slug>
// Or for all tenants:    npm run backfill:clip-embeddings
//
// Required after the ProductMediaClipEmbedding migration to populate
// `product_media.clip_embedding` for catalog rows that existed before
// CLIP rollout. Without this, customer-photo Stage 2 has no candidates
// and falls back to linked-only / handoff. New catalog syncs populate
// the column inline alongside pHash.
//
// Per-image failures are logged and skipped — they leave the row with
// `clip_embedding = NULL` and the script continues. We do NOT fail the
// whole backfill on a single download/decode error.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';

// Lazy `@xenova/transformers` load (ESM-only). Function-constructor
// thunk dodges TypeScript's CJS rewrite of dynamic `import()`.
const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as <T = unknown>(specifier: string) => Promise<T>;

const CLIP_DIM = 512;

interface TransformersModule {
  pipeline: (
    task: string,
    model: string,
  ) => Promise<(images: unknown) => Promise<{ data: Float32Array | number[] }>>;
  RawImage: { fromURL: (url: string) => Promise<unknown> };
}

function parseTenantArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--tenant='));
  return arg ? arg.split('=', 2)[1] || null : null;
}

async function resolveTenantId(
  tenantArg: string | null,
): Promise<{ id: string; slug?: string } | null> {
  if (!tenantArg) return null;

  // Try as UUID first (raw query — no entity for tenants in scripts dir).
  const byId: Array<{ id: string; slug: string }> = await AppDataSource.query(
    `SELECT id, slug FROM tenants WHERE id::text = $1 LIMIT 1`,
    [tenantArg],
  );
  if (byId.length === 1) return byId[0];

  const bySlug: Array<{ id: string; slug: string }> = await AppDataSource.query(
    `SELECT id, slug FROM tenants WHERE slug = $1 LIMIT 1`,
    [tenantArg],
  );
  if (bySlug.length === 1) return bySlug[0];

  return null;
}

async function main(): Promise<void> {
  const tenantArg = parseTenantArg();
  await AppDataSource.initialize();

  let tenantFilter = '';
  const params: unknown[] = [];
  if (tenantArg) {
    const tenant = await resolveTenantId(tenantArg);
    if (!tenant) {
      console.error(
        `Tenant "${tenantArg}" not found (tried as id and slug). Aborting.`,
      );
      await AppDataSource.destroy();
      process.exit(1);
    }
    console.log(
      `Backfilling CLIP embeddings for tenant ${tenant.slug ?? tenant.id} (${tenant.id})`,
    );
    tenantFilter = ' AND p.tenant_id = $1';
    params.push(tenant.id);
  } else {
    console.log('Backfilling CLIP embeddings for ALL tenants');
  }

  type Row = { id: string; url: string; product_id: string };
  const rows: Row[] = await AppDataSource.query(
    `SELECT pm.id, pm.url, pm.product_id
       FROM product_media pm
       JOIN products p ON p.id = pm.product_id
      WHERE pm.clip_embedding IS NULL${tenantFilter}
      ORDER BY pm.created_at DESC`,
    params,
  );

  console.log(`Found ${rows.length} product_media row(s) without CLIP embedding`);
  if (rows.length === 0) {
    await AppDataSource.destroy();
    return;
  }

  // Boot CLIP pipeline (~30s cold start, model is cached after).
  console.log('Loading Xenova/clip-vit-base-patch32 model...');
  const transformers = await dynamicImport<TransformersModule>(
    '@xenova/transformers',
  );
  const extractor = await transformers.pipeline(
    'image-feature-extraction',
    'Xenova/clip-vit-base-patch32',
  );
  console.log('Model loaded. Embedding...');

  let success = 0;
  let failure = 0;
  const start = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const image = await transformers.RawImage.fromURL(row.url);
      const out = await extractor(image);
      const raw = out.data;
      const v =
        raw instanceof Float32Array ? new Float32Array(raw) : Float32Array.from(raw);

      if (v.length !== CLIP_DIM) {
        console.warn(`[${i + 1}/${rows.length}] dim=${v.length} mismatch — skipping`);
        failure++;
        continue;
      }

      // L2-normalize (cosine == dot product downstream).
      let norm = 0;
      for (let k = 0; k < v.length; k++) norm += v[k] * v[k];
      norm = Math.sqrt(norm);
      if (!Number.isFinite(norm) || norm <= 0) {
        console.warn(`[${i + 1}/${rows.length}] zero/NaN norm — skipping`);
        failure++;
        continue;
      }
      for (let k = 0; k < v.length; k++) v[k] /= norm;

      const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      await AppDataSource.query(
        `UPDATE product_media SET clip_embedding = $1 WHERE id = $2`,
        [buf, row.id],
      );
      success++;

      if ((i + 1) % 25 === 0 || i + 1 === rows.length) {
        const elapsedSec = Math.round((Date.now() - start) / 1000);
        console.log(
          `[${i + 1}/${rows.length}] ok=${success} fail=${failure} elapsed=${elapsedSec}s`,
        );
      }
    } catch (err) {
      console.warn(
        `[${i + 1}/${rows.length}] embed failed for media ${row.id}: ${err}`,
      );
      failure++;
    }
  }

  const totalSec = Math.round((Date.now() - start) / 1000);
  console.log(
    `\nBackfill complete: ${success} succeeded, ${failure} failed, ${totalSec}s total`,
  );

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
