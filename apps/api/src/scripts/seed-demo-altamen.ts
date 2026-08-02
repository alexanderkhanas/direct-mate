// Seed entry: demo-altamen tenant (Alta Men lead demo — men's clothing,
// catalog scraped from altamen.com.ua; see seed/data/altamen/README.md).
// Run via: npm run seed:demo:altamen (or seed:demo:prod:altamen in prod).

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { buildAltamenTenant } from './seed/builders/altamen-builder';
import {
  assertNoOrphans,
  deleteTenantBySlug,
} from './seed/builders/tenant-builder';

const DEMO_SLUG = 'demo-altamen';

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await deleteTenantBySlug(AppDataSource, DEMO_SLUG);
    await assertNoOrphans(AppDataSource, [DEMO_SLUG]);

    await buildAltamenTenant(AppDataSource, {
      slug: DEMO_SLUG,
      name: 'ÁLTA MEN (demo)',
      businessType: 'fashion',
    });

    console.log('✓ demo-altamen seed complete.');
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
