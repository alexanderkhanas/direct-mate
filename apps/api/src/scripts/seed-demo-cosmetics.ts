// Seed entry: demo-cosmetics tenant.
// Run via: npm run seed:demo:cosmetics (or seed:demo:prod:cosmetics in prod).
//
// Steps:
//   1. Hard-delete `demo-cosmetics` (idempotency on re-run).
//   2. assertNoOrphans — fail loudly if it survived deletion.
//   3. Build demo-cosmetics from code via cosmetics-builder.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { buildCosmeticsTenant } from './seed/builders/cosmetics-builder';
import {
  assertNoOrphans,
  deleteTenantBySlug,
} from './seed/builders/tenant-builder';

const DEMO_SLUG = 'demo-cosmetics';

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await deleteTenantBySlug(AppDataSource, DEMO_SLUG);
    await assertNoOrphans(AppDataSource, [DEMO_SLUG]);

    await buildCosmeticsTenant(AppDataSource, {
      slug: DEMO_SLUG,
      name: 'Косметика (demo)',
      businessType: 'cosmetics',
    });

    console.log('✓ demo-cosmetics seed complete.');
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
