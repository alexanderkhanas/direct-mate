// Seed entry: non-demo test tenant cloned from demo-women-clothes content.
//
// Produces a real (is_demo=false) tenant with the same catalog/templates/
// size charts/config as `demo-women-clothes`, plus an admin user you can
// log into the panel with. Useful for end-to-end testing the full engine
// without the demo restrictions (rate limits, ordersService skip).
//
// Run via: npm run seed:test-tenant
//
// Override defaults via env vars:
//   TEST_TENANT_SLUG     (default: test-clothes)
//   TEST_TENANT_NAME     (default: Test Clothes Store)
//   TEST_TENANT_EMAIL    (default: test@directmate.local)
//   TEST_TENANT_PASSWORD (default: test1234)
//
// Idempotent: deletes any existing tenant with the same slug before rebuilding.

import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { UserRole } from '@direct-mate/shared';
import { AppDataSource } from '../database/data-source';
import { buildClothingTenant } from './seed/builders/clothing-builder';
import {
  assertNoOrphans,
  deleteTenantBySlug,
} from './seed/builders/tenant-builder';

const SLUG = process.env.TEST_TENANT_SLUG ?? 'test-clothes';
const NAME = process.env.TEST_TENANT_NAME ?? 'Test Clothes Store';
const EMAIL = process.env.TEST_TENANT_EMAIL ?? 'test@directmate.local';
const PASSWORD = process.env.TEST_TENANT_PASSWORD ?? 'test1234';

async function createAdminUser(
  ds: DataSource,
  tenantId: string,
  email: string,
  password: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 10);
  await ds.query(
    `INSERT INTO users (tenant_id, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, true)`,
    [tenantId, email, passwordHash, UserRole.Owner],
  );
}

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  try {
    await deleteTenantBySlug(AppDataSource, SLUG);
    await assertNoOrphans(AppDataSource, [SLUG]);

    const tenantId = await buildClothingTenant(AppDataSource, {
      slug: SLUG,
      name: NAME,
      businessType: 'fashion',
      isDemo: false,
    });

    // Test-tenant-only: conversation_start_greeting fires once at the start
    // of every conversation (DM, story reply, post reply). Demo tenants don't
    // get this template so they keep their existing behavior.
    await AppDataSource.query(
      `INSERT INTO response_templates
         (tenant_id, scenario, stage, blocks, required_variables, tone_tags, priority, active)
       VALUES ($1, 'conversation_start_greeting', '', $2, '[]', '["warm"]', 90, true)`,
      [tenantId, JSON.stringify(['Вітаю! З вами АІ помічник DirectMate.'])],
    );
    console.log(`  conversation_start_greeting template: ✓`);

    await createAdminUser(AppDataSource, tenantId, EMAIL, PASSWORD);
    console.log(`  admin user: ✓`);

    console.log('\n✓ Test tenant seed complete.');
    console.log(`  slug:     ${SLUG}`);
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${PASSWORD}`);
    console.log(`  tenantId: ${tenantId}\n`);
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
