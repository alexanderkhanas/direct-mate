// Re-apply normalized product titles to an already-seeded demo-altamen tenant.
//
// The scraped catalog titles products as «NAME - SKU» and shouts: 66 of 128 are
// ALL-CAPS, 16 end in a stripped-SKU remnant (` -` or ` - 05.30.70.51`), some
// carry double spaces. `normalizeProductTitle` (seed/data/altamen-products.ts)
// cleans that at load time — this script pushes the same result onto rows that
// were seeded before it existed.
//
// Deliberately NOT a reseed: `seed:demo:altamen` hard-deletes the tenant with
// CASCADE, taking its conversations and any flow_config edits made through the
// admin panel. Same shape as backfill-altamen-templates.ts.
//
// Keyed on `external_product_id`, not the title — the title is the thing
// changing, and matching on it would work exactly once. Idempotent: a second
// run reports 0 updated.
//
// Run via: npm run backfill:altamen-titles  (prod: backfill:prod:altamen-titles)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { getAltamenProducts } from './seed/data/altamen-products';

const SLUG = 'demo-altamen';

async function backfill(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [SLUG],
    );
    if (rows.length === 0) {
      throw new Error(`Tenant not found: ${SLUG} — run npm run seed:demo:altamen first.`);
    }
    const tenantId = rows[0].id;

    const products = getAltamenProducts();
    let updated = 0;
    let unchanged = 0;
    let missing = 0;
    const samples: string[] = [];

    for (const p of products) {
      const result: Array<{ title: string }> = await AppDataSource.query(
        `UPDATE products
            SET title = $1, updated_at = now()
          WHERE tenant_id = $2
            AND external_product_id = $3
            AND title IS DISTINCT FROM $1
        RETURNING (SELECT title FROM products x
                    WHERE x.tenant_id = $2 AND x.external_product_id = $3) AS title`,
        [p.title, tenantId, p.externalId],
      );
      if (result.length > 0) {
        updated++;
        if (samples.length < 5) samples.push(`  ${p.title}`);
        continue;
      }
      // No row updated: either the title already matches, or the product isn't
      // in this tenant at all. Distinguish them — a missing product means the
      // seeded catalog and the JSON have drifted, which is worth surfacing
      // rather than silently counting as "already correct".
      const exists: Array<{ n: string }> = await AppDataSource.query(
        `SELECT count(*)::text AS n FROM products
          WHERE tenant_id = $1 AND external_product_id = $2`,
        [tenantId, p.externalId],
      );
      if (exists[0].n === '0') missing++;
      else unchanged++;
    }

    console.log(
      `✓ ${SLUG}: ${updated} titles updated, ${unchanged} already normalized` +
        (missing > 0 ? `, ${missing} NOT FOUND in this tenant` : ''),
    );
    if (samples.length > 0) {
      console.log('  sample of new titles:');
      for (const s of samples) console.log(s);
    }
    if (missing > 0) {
      console.warn(
        `! ${missing} product(s) in the JSON have no row here — the seeded ` +
          `catalog has drifted from altamen-products-merged.json.`,
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
