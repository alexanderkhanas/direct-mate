// Replace demo-altamen's response_templates with the men's pack
// (clothing-men: restrained voice, no 💛).
//
// Deliberately NOT a reseed: `seed:demo:altamen` hard-deletes the tenant
// with CASCADE, which would take its conversations and any flow_config
// edits made through the admin panel. Same shape as
// backfill-show-price-with-variants.ts — the documented pattern for
// demo-only template changes.
//
// Idempotent: deletes the tenant's templates, re-inserts from code.
// Run via: npm run backfill:altamen-templates

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { getTemplatesForBusinessType } from './seed/templates';
import { seedResponseTemplates } from './seed/builders/tenant-builder';

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

    const [{ count: before }] = await AppDataSource.query(
      `SELECT count(*)::int FROM response_templates WHERE tenant_id = $1`,
      [tenantId],
    );
    await AppDataSource.query(
      `DELETE FROM response_templates WHERE tenant_id = $1`,
      [tenantId],
    );

    const templates = getTemplatesForBusinessType('clothing-men');
    await seedResponseTemplates(AppDataSource, tenantId, templates);

    console.log(`✓ ${SLUG}: ${before} templates replaced with ${templates.length} (clothing-men)`);
  } finally {
    await AppDataSource.destroy();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
