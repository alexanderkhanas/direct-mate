// Seed entry: showcase-women-clothes tenant.
// Run via: npm run seed:showcase:women-clothes
//          (or seed:showcase:prod:women-clothes in prod).
//
// A non-demo (`is_demo=false`) twin of the `demo-women-clothes`
// tenant. Same catalog + templates + flow config so it behaves
// identically, but as a real production tenant — orders persist,
// analytics include it, the public `/demo/message` widget does NOT
// auto-resolve it. Intended use: live test shop for sales demos
// with potential customers, linked to a real Instagram Business
// Account via the admin Connections page.
//
// Idempotent (re-run safely): deletes the tenant by slug first.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { buildClothingTenant } from './seed/builders/clothing-builder';
import {
  assertNoOrphans,
  deleteTenantBySlug,
} from './seed/builders/tenant-builder';

const SHOWCASE_SLUG = 'showcase-women-clothes';

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await deleteTenantBySlug(AppDataSource, SHOWCASE_SLUG);
    await assertNoOrphans(AppDataSource, [SHOWCASE_SLUG]);

    await buildClothingTenant(AppDataSource, {
      slug: SHOWCASE_SLUG,
      name: 'Жіночий одяг',
      businessType: 'fashion',
      isDemo: false,
    });

    console.log('✓ showcase-women-clothes seed complete.');
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
