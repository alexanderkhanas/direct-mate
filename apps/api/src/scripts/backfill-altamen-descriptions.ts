// Switch an already-seeded demo-altamen tenant to Alta Men's own product
// descriptions (see `originalDescriptions` in seed/data/altamen-products.ts).
//
// Not a reseed: `seed:demo:altamen` hard-deletes the tenant with CASCADE,
// taking its conversations. Keyed on `external_product_id`, like
// backfill-altamen-titles.ts. Idempotent: a second run reports 0 updated.
//
// A changed description makes the product's attributes stale, so the next
// `npm run attributes:extract -- --tenant demo-altamen` reads it again.
//
// Run via: npm run backfill:altamen-descriptions  (prod: backfill:prod:altamen-descriptions)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { returnedRows } from '../common/db';
import { getAltamenProducts } from './seed/data/altamen-products';

const SLUG = 'demo-altamen';

async function backfill(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const rows: Array<{ id: string }> = await AppDataSource.query(`SELECT id FROM tenants WHERE slug = $1 LIMIT 1`, [
      SLUG,
    ]);
    if (rows.length === 0) throw new Error(`Tenant not found: ${SLUG} — run npm run seed:demo:altamen first.`);
    const tenantId = rows[0].id;

    let updated = 0;
    let unchanged = 0;
    for (const p of getAltamenProducts()) {
      const changed = returnedRows<{ id: string }>(
        await AppDataSource.query(
          `UPDATE products SET description = $1, updated_at = now()
            WHERE tenant_id = $2 AND external_product_id = $3 AND description IS DISTINCT FROM $1
          RETURNING id`,
          [p.description ?? null, tenantId, p.externalId],
        ),
      );
      if (changed.length > 0) updated++;
      else unchanged++;
    }
    console.log(`✓ ${SLUG}: ${updated} descriptions updated, ${unchanged} unchanged or not found`);
  } finally {
    await AppDataSource.destroy();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
