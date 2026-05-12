// Seed entry: showcase-cosmetics tenant.
// Run via: npm run seed:showcase:cosmetics
//          (or seed:showcase:prod:cosmetics in prod).
//
// Non-demo (`is_demo=false`) twin of `demo-cosmetics`. Same
// catalog + templates + flow config but as a real production
// tenant: orders persist, analytics include it, the public
// `/demo/message` widget does NOT auto-resolve it. Intended use:
// live test shop for sales demos with potential customers, linked
// to a real Instagram Business Account via the admin Connections
// page.

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { buildCosmeticsTenant } from './seed/builders/cosmetics-builder';
import {
  assertNoOrphans,
  deleteTenantBySlug,
} from './seed/builders/tenant-builder';

const SHOWCASE_SLUG = 'showcase-cosmetics';

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await deleteTenantBySlug(AppDataSource, SHOWCASE_SLUG);
    await assertNoOrphans(AppDataSource, [SHOWCASE_SLUG]);

    await buildCosmeticsTenant(AppDataSource, {
      slug: SHOWCASE_SLUG,
      name: 'Косметика',
      businessType: 'cosmetics',
      isDemo: false,
    });

    console.log('✓ showcase-cosmetics seed complete.');
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
