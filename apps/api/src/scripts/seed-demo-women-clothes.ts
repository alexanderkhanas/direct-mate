// Seed entry: demo-women-clothes tenant.
// Run via: npm run seed:demo:women-clothes (or seed:demo:prod:women-clothes in prod).
//
// Steps:
//   1. Hard-delete legacy `demo` tenant (cascade) — Phase 4 transition.
//   2. Hard-delete `demo-women-clothes` (idempotency on re-run).
//   3. assertNoOrphans — fail loudly if either survived deletion.
//   4. Build demo-women-clothes from code via clothing-builder.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { buildClothingTenant } from './seed/builders/clothing-builder';
import {
  assertNoOrphans,
  deleteTenantBySlug,
} from './seed/builders/tenant-builder';

const DEMO_SLUG = 'demo-women-clothes';
const LEGACY_SLUG = 'demo';

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    // Step 1: hard-delete (CASCADE handles all dependent rows)
    await deleteTenantBySlug(AppDataSource, LEGACY_SLUG);
    await deleteTenantBySlug(AppDataSource, DEMO_SLUG);

    // Step 2: defensive verification — fails fast on FK / permission edge cases
    await assertNoOrphans(AppDataSource, [LEGACY_SLUG, DEMO_SLUG]);

    // Step 3: build from scratch via the shared clothing-builder
    await buildClothingTenant(AppDataSource, {
      slug: DEMO_SLUG,
      name: 'Жіночий одяг (demo)',
      businessType: 'fashion',
    });

    console.log('✓ demo-women-clothes seed complete.');
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
