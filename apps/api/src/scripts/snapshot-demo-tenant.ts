// Snapshot / drift-check / repair for a DB-only demo tenant.
//
// Why this exists: men-demo-store is the tenant we point prospects at during
// cold outreach, and it is NOT reproducible from this repo's seed builders —
// it was authored in prod and copied down. A reseed would hard-delete it with
// CASCADE (taking its conversations), so there is no "just re-run the seed"
// recovery path. Anything that silently edits it — a stray admin-panel save, a
// half-applied backfill, a hand-run UPDATE, a local DB rebuilt from a stale
// dump — breaks a live demo with no warning and no way back.
//
// (This is not hypothetical: the local copy was found with is_demo=false,
// which silently excluded it from every is_demo-scoped backfill.)
//
// So: freeze the tenant's configuration to a committed JSON file, diff the
// live DB against it before a demo, and repair drift in place.
//
//   npm run snapshot:men-demo   → --export   write the snapshot file
//   npm run verify:men-demo     → --check    read-only diff, exit 1 on drift
//   npm run restore:men-demo    → --restore  upsert the differences back
//
// Covers CONFIGURATION only — catalog, variants, stock, templates, FAQ, size
// charts, store config, settings. Conversations, customers, messages and
// orders are never read and never written: restore must be safe to run on a
// tenant mid-demo.

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../database/data-source';

const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');

interface Snapshot {
  slug: string;
  capturedAt: string;
  tenant: Record<string, unknown>;
  storeConfig: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  products: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  faqItems: Array<Record<string, unknown>>;
  sizeCharts: Array<Record<string, unknown>>;
}

// Natural keys, so a snapshot diffs cleanly across environments: prod and
// local have different row UUIDs for the same logical rows.
const productKey = (p: any) => String(p.title);
const variantKey = (v: any) => `${v.color ?? '-'}/${v.size ?? '-'}`;
const templateKey = (t: any) => String(t.scenario);
const faqKey = (f: any) => JSON.stringify(f.question_tags);
const chartKey = (c: any) => String(c.name);

async function capture(slug: string): Promise<Snapshot> {
  const [tenant] = await AppDataSource.query(
    `SELECT id, slug, name, is_demo FROM tenants WHERE slug = $1`,
    [slug],
  );
  if (!tenant) throw new Error(`Tenant "${slug}" not found`);
  const tenantId = tenant.id;

  const [storeConfig] = await AppDataSource.query(
    `SELECT flow_config, checkout_config, escalation_config, fallback_config,
            brand_config, recommendation_config
       FROM store_configs WHERE tenant_id = $1`,
    [tenantId],
  );

  const [settings] = await AppDataSource.query(
    `SELECT brand_tone_prompt, handoff_rules, supported_languages
       FROM tenant_settings WHERE tenant_id = $1`,
    [tenantId],
  );

  const products = await AppDataSource.query(
    `SELECT p.title, p.category, p.brand, p.material, p.status,
            p.description, p.search_keywords,
            COALESCE(
              json_agg(
                json_build_object(
                  'color', v.color,
                  'size', v.size,
                  'price', v.price,
                  'currency', v.currency,
                  'active', v.active,
                  'available_qty', COALESCE(sb.available_qty, 0)
                ) ORDER BY v.color, v.size
              ) FILTER (WHERE v.id IS NOT NULL), '[]'
            ) AS variants
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN stock_balances sb ON sb.variant_id = v.id
      WHERE p.tenant_id = $1
      GROUP BY p.id
      ORDER BY p.title`,
    [tenantId],
  );

  const templates = await AppDataSource.query(
    `SELECT scenario, stage, blocks, required_variables, tone_tags,
            priority, active
       FROM response_templates WHERE tenant_id = $1 ORDER BY scenario`,
    [tenantId],
  );

  const faqItems = await AppDataSource.query(
    `SELECT question_tags, answer_template, active
       FROM faq_items WHERE tenant_id = $1 ORDER BY question_tags::text`,
    [tenantId],
  );

  const sizeCharts = await AppDataSource.query(
    `SELECT name, image_path, categories, brands, is_default
       FROM size_charts WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );

  return {
    slug,
    capturedAt: new Date().toISOString(),
    tenant: { slug: tenant.slug, name: tenant.name, is_demo: tenant.is_demo },
    storeConfig: storeConfig ?? null,
    settings: settings ?? null,
    products,
    templates,
    faqItems,
    sizeCharts,
  };
}

// ─── Diff ────────────────────────────────────────────────────────

type Drift = { kind: 'missing' | 'extra' | 'changed'; what: string; detail?: string };

function diffCollection(
  name: string,
  expected: Array<Record<string, unknown>>,
  actual: Array<Record<string, unknown>>,
  key: (row: any) => string,
): Drift[] {
  const drifts: Drift[] = [];
  const actualByKey = new Map(actual.map((r) => [key(r), r]));
  const expectedKeys = new Set(expected.map(key));

  for (const exp of expected) {
    const k = key(exp);
    const act = actualByKey.get(k);
    if (!act) {
      drifts.push({ kind: 'missing', what: `${name}[${k}]` });
      continue;
    }
    // JSON round-trip both sides: pg returns jsonb as objects and numerics as
    // strings, and the snapshot went through JSON.stringify — compare in the
    // same shape rather than chasing driver-level type differences.
    const a = JSON.stringify(exp);
    const b = JSON.stringify(JSON.parse(JSON.stringify(act)));
    if (a !== b) {
      drifts.push({ kind: 'changed', what: `${name}[${k}]`, detail: firstDiff(exp, act) });
    }
  }
  for (const act of actual) {
    if (!expectedKeys.has(key(act))) {
      drifts.push({ kind: 'extra', what: `${name}[${key(act)}]` });
    }
  }
  return drifts;
}

function firstDiff(expected: any, actual: any): string {
  for (const field of Object.keys(expected)) {
    const e = JSON.stringify(expected[field]);
    const a = JSON.stringify(actual[field]);
    if (e !== a) {
      const trim = (s: string) => (s.length > 70 ? `${s.slice(0, 70)}…` : s);
      return `${field}: expected ${trim(e)}, got ${trim(a)}`;
    }
  }
  return 'field order / shape differs';
}

function diffSnapshots(expected: Snapshot, actual: Snapshot): Drift[] {
  const drifts: Drift[] = [];

  for (const field of Object.keys(expected.tenant)) {
    const e = JSON.stringify((expected.tenant as any)[field]);
    const a = JSON.stringify((actual.tenant as any)[field]);
    if (e !== a) {
      drifts.push({ kind: 'changed', what: `tenant.${field}`, detail: `expected ${e}, got ${a}` });
    }
  }
  for (const [name, exp, act] of [
    ['storeConfig', expected.storeConfig, actual.storeConfig],
    ['settings', expected.settings, actual.settings],
  ] as const) {
    if (JSON.stringify(exp) !== JSON.stringify(act)) {
      drifts.push({
        kind: 'changed',
        what: name,
        detail: firstDiff(exp ?? {}, act ?? {}),
      });
    }
  }

  drifts.push(...diffCollection('product', expected.products, actual.products, productKey));
  drifts.push(...diffCollection('template', expected.templates, actual.templates, templateKey));
  drifts.push(...diffCollection('faq', expected.faqItems, actual.faqItems, faqKey));
  drifts.push(...diffCollection('sizeChart', expected.sizeCharts, actual.sizeCharts, chartKey));
  return drifts;
}

// ─── Restore ─────────────────────────────────────────────────────
//
// Repairs the rows a demo depends on. Deliberately NOT a mirror of every
// drift kind: it never DELETEs (an "extra" template someone added on purpose
// is reported, not destroyed) and it never touches catalog rows — a product
// or price that changed in prod is a business decision, not corruption, and
// the right response is to re-export the snapshot after reviewing it. What it
// does own is the config surface a demo silently depends on: the is_demo flag,
// the templates, and the FAQ items.

async function restore(snapshot: Snapshot): Promise<number> {
  const [tenant] = await AppDataSource.query(
    `SELECT id FROM tenants WHERE slug = $1`,
    [snapshot.slug],
  );
  if (!tenant) throw new Error(`Tenant "${snapshot.slug}" not found — cannot restore.`);
  const tenantId = tenant.id;
  let repaired = 0;

  const isDemo = (snapshot.tenant as any).is_demo;
  const updated = await AppDataSource.query(
    `UPDATE tenants SET is_demo = $2 WHERE slug = $1 AND is_demo IS DISTINCT FROM $2
     RETURNING slug`,
    [snapshot.slug, isDemo],
  );
  if (updated.length > 0) {
    console.log(`  repaired tenant.is_demo → ${isDemo}`);
    repaired++;
  }

  for (const t of snapshot.templates as any[]) {
    const [existing] = await AppDataSource.query(
      `SELECT id, stage, blocks, required_variables, tone_tags, priority, active
         FROM response_templates WHERE tenant_id = $1 AND scenario = $2`,
      [tenantId, t.scenario],
    );
    const params = [
      tenantId,
      t.scenario,
      t.stage,
      JSON.stringify(t.blocks),
      JSON.stringify(t.required_variables),
      JSON.stringify(t.tone_tags),
      t.priority,
      t.active,
    ];
    if (!existing) {
      await AppDataSource.query(
        `INSERT INTO response_templates (tenant_id, scenario, stage, blocks,
                                          required_variables, tone_tags, priority, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        params,
      );
      console.log(`  restored template ${t.scenario} (was missing)`);
      repaired++;
    } else if (JSON.stringify(existing.blocks) !== JSON.stringify(t.blocks)) {
      await AppDataSource.query(
        `UPDATE response_templates
            SET stage = $3, blocks = $4, required_variables = $5,
                tone_tags = $6, priority = $7, active = $8
          WHERE tenant_id = $1 AND scenario = $2`,
        params,
      );
      console.log(`  restored template ${t.scenario} (copy changed)`);
      repaired++;
    }
  }

  for (const f of snapshot.faqItems as any[]) {
    const [existing] = await AppDataSource.query(
      `SELECT id FROM faq_items WHERE tenant_id = $1 AND question_tags::text = $2`,
      [tenantId, JSON.stringify(f.question_tags)],
    );
    if (!existing) {
      await AppDataSource.query(
        `INSERT INTO faq_items (tenant_id, question_tags, answer_template, active)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, JSON.stringify(f.question_tags), f.answer_template, f.active],
      );
      console.log(`  restored FAQ ${faqKey(f)} (was missing)`);
      repaired++;
    }
  }

  return repaired;
}

// ─── Entry point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf('--slug');
  const slug = slugIdx >= 0 ? args[slugIdx + 1] : undefined;
  const mode = ['--export', '--check', '--restore'].find((m) => args.includes(m));

  if (!slug || !mode) {
    console.error(
      'Usage: snapshot-demo-tenant --slug <tenant-slug> (--export | --check | --restore)',
    );
    process.exit(2);
  }

  const file = path.join(SNAPSHOT_DIR, `${slug}.json`);
  await AppDataSource.initialize();
  try {
    if (mode === '--export') {
      const snapshot = await capture(slug);
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
      console.log(
        `Snapshot written: ${path.relative(process.cwd(), file)}\n` +
          `  ${snapshot.products.length} products, ${snapshot.templates.length} templates, ` +
          `${snapshot.faqItems.length} FAQ, ${snapshot.sizeCharts.length} size charts`,
      );
      return;
    }

    if (!fs.existsSync(file)) {
      console.error(`No snapshot at ${file}. Run --export first (against a known-good DB).`);
      process.exit(2);
    }
    const expected: Snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (mode === '--check') {
      const actual = await capture(slug);
      const drifts = diffSnapshots(expected, actual);
      if (drifts.length === 0) {
        console.log(`✓ ${slug} matches the snapshot (taken ${expected.capturedAt}).`);
        return;
      }
      console.error(`✗ ${slug} has drifted from the snapshot (${drifts.length}):\n`);
      for (const d of drifts) {
        console.error(`  [${d.kind}] ${d.what}${d.detail ? `\n           ${d.detail}` : ''}`);
      }
      console.error(
        '\nIf the drift is intentional, re-export the snapshot. Otherwise: --restore',
      );
      process.exit(1);
    }

    if (mode === '--restore') {
      const repaired = await restore(expected);
      console.log(
        repaired === 0
          ? 'Nothing to restore — config already matches the snapshot.'
          : `\nRestored ${repaired} row(s). Conversations untouched.`,
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
