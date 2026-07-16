// Backfill: demo-tenant conversation hardening pack.
//
// Adds three rows every demo tenant needs to survive adversarial cold-reach
// dialogues (discount haggling, off-topic questions, explicit human
// requests):
//
//   1. faq_items «Знижки» — deterministic polite decline for «а знижка
//      буде?» / «дайте знижку» / «є промокод?». Without it the turn lands
//      in general_question → handoff, or in the AI fallback with no
//      discount guardrail.
//   2. response_templates `off_topic_redirect` — opt-in template that turns
//      on the engine's off-topic gate (no focus + no product entities +
//      no FAQ → steer back to the catalog instead of a coin flip between
//      AI fallback and a handoff over small talk).
//   3. response_templates `handoff_ack` — the escalation notice `doHandoff`
//      appends to EVERY handoff. Optional: the engine falls back to identical
//      hardcoded copy, so this row exists only so a tenant can rewrite the
//      wording in the admin panel. See the handoff rule in CLAUDE.md.
//
// Why a script instead of a reseed: the demo tenants that exist in
// PRODUCTION (Men Demo Store among them) are not all reproducible from
// this repo's seed builders, and a full reseed hard-deletes the tenant
// with CASCADE — taking its conversations with it. This adds the missing
// rows in place.
//
// Scoped to `tenants.is_demo = true` deliberately: slug-agnostic, so it
// picks up prod-only demo tenants whatever they're named, and it leaves
// production tenants' DB-authored templates alone (per CLAUDE.md, only
// demo tenants take templates from code).
//
// Idempotent — skips any tenant that already has the row.
//
// Run: npm run backfill:demo-hardening        (local, ts-node)
//      npm run backfill:prod:demo-hardening   (prod, compiled)

import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import { BASE_TEMPLATES } from './seed/templates/base';

const TEMPLATE_SCENARIOS = [
  'off_topic_redirect',
  'handoff_ack',
  'show_categories',
  'ask_cart_removal',
];

// Tags are STEMS on purpose: the FAQ matcher does literal substring matching
// against the raw message, so «знижк» covers знижка/знижки/знижку/знижок and
// «дешевш» covers дешевше/подешевше. Keep them lowercase.
const DISCOUNT_FAQ = {
  tags: ['знижк', 'скидк', 'промокод', 'дешевш', 'торг', 'уступ'],
  answer:
    'Ціни в нас фіксовані, тож знижку зробити не зможу 💛 Всі акції ' +
    'анонсуємо в профілі — слідкуйте за сторіс, щоб не пропустити.',
};

async function backfill(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const tenants: Array<{ id: string; slug: string }> =
      await AppDataSource.query(
        `SELECT t.id, t.slug
           FROM tenants t
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
      // 1+2. The two opt-in templates, sourced from the base pack so
      // seed/templates stays the single source of truth for demo copy.
      for (const scenario of TEMPLATE_SCENARIOS) {
        const existing: Array<{ id: string }> = await AppDataSource.query(
          `SELECT id FROM response_templates
            WHERE tenant_id = $1 AND scenario = $2`,
          [tenant.id, scenario],
        );
        if (existing.length > 0) {
          console.log(`  ${tenant.slug}: already has ${scenario} — skipped`);
          skipped++;
          continue;
        }

        const spec = BASE_TEMPLATES.find((t) => t.scenario === scenario);
        if (!spec) {
          throw new Error(
            `${scenario} missing from base templates — seed/templates and this backfill are out of sync`,
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
        console.log(`  ${tenant.slug}: inserted template ${scenario}`);
        inserted++;
      }

      // 3. Discount-decline FAQ item. Idempotency key: any active FAQ row
      // already carrying the «знижк» tag.
      const existingFaq: Array<{ id: string }> = await AppDataSource.query(
        `SELECT id FROM faq_items
          WHERE tenant_id = $1
            AND question_tags::text ILIKE '%знижк%'`,
        [tenant.id],
      );
      if (existingFaq.length > 0) {
        console.log(`  ${tenant.slug}: already has знижки FAQ — skipped`);
        skipped++;
      } else {
        await AppDataSource.query(
          `INSERT INTO faq_items (tenant_id, question_tags, answer_template, active)
           VALUES ($1, $2, $3, true)`,
          [tenant.id, JSON.stringify(DISCOUNT_FAQ.tags), DISCOUNT_FAQ.answer],
        );
        console.log(`  ${tenant.slug}: inserted знижки FAQ`);
        inserted++;
      }
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
