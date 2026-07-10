// Backfill: add the `show_price_with_variants` template to demo tenants.
//
// Why a script instead of a reseed: the demo tenants that exist in
// PRODUCTION (Men Demo Store among them) are not all reproducible from
// this repo's seed builders, and a full reseed hard-deletes the tenant
// with CASCADE — taking its conversations with it. This adds the one
// missing row in place.
//
// Scoped to `tenants.is_demo = true` deliberately: slug-agnostic, so it
// picks up prod-only demo tenants whatever they're named, and it leaves
// production tenants' DB-authored templates alone (per CLAUDE.md, only
// demo tenants take templates from code).
//
// Idempotent — skips any tenant that already has the scenario.
//
// Run: npm run backfill:price-variants        (local, ts-node)
//      npm run backfill:prod:price-variants   (prod, compiled)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { getTemplatesForBusinessType, DemoBusinessType } from './seed/templates';

const SCENARIO = 'show_price_with_variants';

async function backfill(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const tenants: Array<{ id: string; slug: string; business_type: string | null }> =
      await AppDataSource.query(
        `SELECT t.id,
                t.slug,
                sc.flow_config->>'businessType' AS business_type
           FROM tenants t
           LEFT JOIN store_configs sc ON sc.tenant_id = t.id
          WHERE t.is_demo = true
          ORDER BY t.slug`,
      );

    if (tenants.length === 0) {
      console.log('No demo tenants found — nothing to backfill.');
      return;
    }

    let inserted = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      const existing: Array<{ id: string }> = await AppDataSource.query(
        `SELECT id FROM response_templates
          WHERE tenant_id = $1 AND scenario = $2`,
        [tenant.id, SCENARIO],
      );
      if (existing.length > 0) {
        console.log(`  ${tenant.slug}: already has ${SCENARIO} — skipped`);
        skipped++;
        continue;
      }

      // Demo tenants without an explicit businessType predate the
      // per-vertical split; they are all clothing.
      const businessType: DemoBusinessType =
        tenant.business_type === 'cosmetics' ? 'cosmetics' : 'clothing';

      const spec = getTemplatesForBusinessType(businessType).find(
        (t) => t.scenario === SCENARIO,
      );
      if (!spec) {
        throw new Error(
          `${SCENARIO} missing from ${businessType} templates — seed/templates and this backfill are out of sync`,
        );
      }

      await AppDataSource.query(
        `INSERT INTO response_templates (tenant_id, scenario, stage, blocks,
                                          required_variables, tone_tags,
                                          priority, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenant.id,
          spec.scenario,
          spec.stage,
          JSON.stringify(spec.blocks),
          JSON.stringify(spec.requiredVariables),
          JSON.stringify(spec.toneTags),
          spec.priority,
          spec.active,
        ],
      );
      console.log(`  ${tenant.slug} (${businessType}): inserted ${SCENARIO}`);
      inserted++;
    }

    console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`);
  } finally {
    await AppDataSource.destroy();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
