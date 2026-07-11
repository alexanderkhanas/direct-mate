/**
 * Offline classifier evaluation harness.
 *
 * Runs the classifier against stored inputs — without the reply engine —
 * so a prompt/model change can be checked before it ships. Two corpora:
 *
 *   --golden          hand-authored cases with explicit expectations
 *                     (src/scripts/eval/golden-cases.json). Self-contained;
 *                     no baseline needed. This is the primary gate for the
 *                     "L підійде" family and the failure inventory.
 *
 *   --traces          real conversation_traces rows from the LOCAL DB.
 *     --save <file>     run current prompt, write outputs to <file>.
 *     --diff <file>     run current prompt, compare to a saved snapshot
 *                       (regression detection). FAIL on any change to
 *                       primaryIntent / slotAction / recommendedAction /
 *                       entities; warn on stage/sentiment/dialogueAct.
 *
 * The classifier calls OpenAI, so this is run manually (not in CI).
 *
 *   npm run eval:classifier -- --golden
 *   npm run eval:classifier -- --traces --save baseline.json   # BEFORE prompt change
 *   npm run eval:classifier -- --traces --diff baseline.json   # AFTER prompt change
 *
 * Capture a baseline against the pre-change prompt: `git stash` the
 * classifier edits, run --save, `git stash pop`, run --diff.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import {
  ClassifierService,
  ClassificationResult,
  AssistantMemory,
} from '../modules/engine/classifier.service';
import { AvailabilityService } from '../modules/availability/availability.service';

// ─── CLI ─────────────────────────────────────────────────────────

interface Args {
  golden: boolean;
  traces: boolean;
  save?: string;
  diff?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { golden: false, traces: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--golden') a.golden = true;
    else if (t === '--traces') a.traces = true;
    else if (t === '--save') a.save = argv[++i];
    else if (t === '--diff') a.diff = argv[++i];
    else if (t === '--limit') a.limit = Number(argv[++i]);
  }
  if (!a.golden && !a.traces) a.golden = true; // default
  return a;
}

const c = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m',
};

// ─── Golden case schema ──────────────────────────────────────────

interface GoldenCase {
  id: string;
  description: string;
  params: {
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories?: string[];
    tenantBusinessType?: 'clothing' | 'cosmetics';
  };
  expect: {
    primaryIntent?: string;
    slotAction?: string;
    recommendedAction?: string;
    // key → expected value, or null = the key MUST be absent/empty
    entities?: Record<string, string | number | null>;
    maxConfidence?: number;
    minConfidence?: number;
  };
}

const ROUTING_FIELDS = ['primaryIntent', 'slotAction', 'recommendedAction'] as const;

function entitiesEqual(
  actual: ClassificationResult['entities'],
  key: string,
  expected: string | number | null,
): boolean {
  const got = (actual as Record<string, unknown>)[key];
  if (expected === null) return got === undefined || got === null || got === '';
  if (typeof expected === 'string' && typeof got === 'string') {
    return got.toLowerCase().trim() === expected.toLowerCase().trim();
  }
  return got === expected;
}

// ─── Golden mode ─────────────────────────────────────────────────

async function runGolden(classifier: ClassifierService): Promise<boolean> {
  const file = path.join(__dirname, 'eval', 'golden-cases.json');
  const cases: GoldenCase[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${c.bold}Golden set: ${cases.length} cases${c.reset}\n`);

  let passed = 0;
  const failures: string[] = [];

  for (const gc of cases) {
    const out = await classifier.classify({
      messageText: gc.params.messageText,
      recentMessages: gc.params.recentMessages,
      memory: gc.params.memory,
      categories: gc.params.categories ?? [],
      tenantBusinessType: gc.params.tenantBusinessType ?? 'clothing',
    });

    const problems: string[] = [];
    for (const f of ROUTING_FIELDS) {
      const exp = gc.expect[f];
      if (exp !== undefined && out[f] !== exp) {
        problems.push(`${f}: expected ${exp}, got ${out[f]}`);
      }
    }
    if (gc.expect.entities) {
      for (const [k, v] of Object.entries(gc.expect.entities)) {
        if (!entitiesEqual(out.entities, k, v)) {
          const got = (out.entities as Record<string, unknown>)[k];
          problems.push(`entities.${k}: expected ${v === null ? 'ABSENT' : v}, got ${got ?? 'ABSENT'}`);
        }
      }
    }
    if (gc.expect.maxConfidence !== undefined && out.confidence > gc.expect.maxConfidence) {
      problems.push(`confidence ${out.confidence} > max ${gc.expect.maxConfidence}`);
    }
    if (gc.expect.minConfidence !== undefined && out.confidence < gc.expect.minConfidence) {
      problems.push(`confidence ${out.confidence} < min ${gc.expect.minConfidence}`);
    }

    if (problems.length === 0) {
      passed++;
      console.log(`  ${c.green}✓${c.reset} ${gc.id} ${c.dim}"${gc.params.messageText}"${c.reset}`);
    } else {
      failures.push(gc.id);
      console.log(`  ${c.red}✗${c.reset} ${gc.id} ${c.dim}"${gc.params.messageText}"${c.reset}`);
      for (const p of problems) console.log(`      ${c.red}${p}${c.reset}`);
    }
  }

  console.log(`\n${c.bold}Golden: ${passed}/${cases.length} passed${c.reset}`);
  if (failures.length) console.log(`${c.red}Failed: ${failures.join(', ')}${c.reset}`);
  return failures.length === 0;
}

// ─── Trace mode ──────────────────────────────────────────────────

interface TraceCase {
  traceId: string;
  tenantId: string;
  messageText: string;
  recentMessages: Array<{ role: string; text: string | null }>;
  memory: AssistantMemory;
  baseline: Record<string, unknown> | null; // stored classifierOutput
}

async function loadTraces(ds: DataSource, limit?: number): Promise<TraceCase[]> {
  const rows: Array<{
    trace_id: string;
    tenant_id: string;
    inbound_message_text: string;
    recent_messages: Array<{ role: string; text: string | null }>;
    memory_before: AssistantMemory;
    classifier_output: Record<string, unknown> | null;
    openai_calls: Array<{ source?: string }> | null;
  }> = await ds.query(
    `SELECT trace_id, tenant_id, inbound_message_text, recent_messages,
            memory_before, classifier_output, openai_calls
       FROM conversation_traces
      WHERE classifier_output IS NOT NULL
        AND memory_before IS NOT NULL
        AND recent_messages IS NOT NULL
        AND inbound_message_text IS NOT NULL
      ORDER BY started_at ASC
      ${limit ? `LIMIT ${limit}` : ''}`,
  );
  // Skip rows whose classification came from the fallback model — not the
  // primary classifier prompt under test.
  return rows
    .filter((r) => !(r.openai_calls ?? []).some((cl) => cl.source === 'classifier_fallback'))
    .map((r) => ({
      traceId: r.trace_id,
      tenantId: r.tenant_id,
      messageText: r.inbound_message_text,
      recentMessages: r.recent_messages,
      memory: r.memory_before,
      baseline: r.classifier_output,
    }));
}

async function runTraces(
  classifier: ClassifierService,
  availability: AvailabilityService,
  ds: DataSource,
  args: Args,
): Promise<boolean> {
  const traces = await loadTraces(ds, args.limit);
  console.log(`${c.bold}Trace corpus: ${traces.length} usable rows${c.reset}\n`);

  // Reconstruct categories/businessType per tenant (traces don't store them).
  const catCache = new Map<string, string[]>();
  const bizCache = new Map<string, 'clothing' | 'cosmetics'>();
  const getCats = async (t: string) => {
    if (!catCache.has(t)) catCache.set(t, await availability.getCategories(t));
    return catCache.get(t)!;
  };
  const getBiz = async (t: string) => {
    if (!bizCache.has(t)) {
      const rows: Array<{ bt: string | null }> = await ds.query(
        `SELECT flow_config->>'businessType' AS bt FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
        [t],
      );
      bizCache.set(t, rows[0]?.bt === 'cosmetics' ? 'cosmetics' : 'clothing');
    }
    return bizCache.get(t)!;
  };

  const outputs: Record<string, ClassificationResult> = {};
  for (const tc of traces) {
    outputs[tc.traceId] = await classifier.classify({
      messageText: tc.messageText,
      recentMessages: tc.recentMessages,
      memory: tc.memory,
      categories: await getCats(tc.tenantId),
      tenantBusinessType: await getBiz(tc.tenantId),
    });
  }

  if (args.save) {
    fs.writeFileSync(args.save, JSON.stringify(outputs, null, 2));
    console.log(`${c.green}Saved ${Object.keys(outputs).length} outputs → ${args.save}${c.reset}`);
    return true;
  }

  // Diff against snapshot (or against the stored baseline if no snapshot).
  const snapshot: Record<string, Record<string, unknown>> = args.diff
    ? JSON.parse(fs.readFileSync(args.diff, 'utf8'))
    : Object.fromEntries(traces.map((t) => [t.traceId, t.baseline ?? {}]));

  let regressions = 0;
  let warnings = 0;
  for (const tc of traces) {
    const now = outputs[tc.traceId] as unknown as Record<string, unknown>;
    const was = snapshot[tc.traceId];
    if (!was) continue;
    const fails: string[] = [];
    const warns: string[] = [];

    for (const f of ROUTING_FIELDS) {
      if (now[f] !== was[f]) fails.push(`${f}: ${was[f]} → ${now[f]}`);
    }
    // entities: any key added/removed/changed is a FAIL
    const eNow = (now.entities ?? {}) as Record<string, unknown>;
    const eWas = (was.entities ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(eNow), ...Object.keys(eWas)])) {
      const a = eNow[k], b = eWas[k];
      const na = a === undefined || a === null || a === '';
      const nb = b === undefined || b === null || b === '';
      if (na && nb) continue;
      const eq = typeof a === 'string' && typeof b === 'string'
        ? a.toLowerCase().trim() === b.toLowerCase().trim() : a === b;
      if (!eq) fails.push(`entities.${k}: ${b ?? 'ABSENT'} → ${a ?? 'ABSENT'}`);
    }
    for (const f of ['conversationStage', 'sentiment', 'dialogueAct']) {
      if (now[f] !== was[f]) warns.push(`${f}: ${was[f]} → ${now[f]}`);
    }
    const dc = Math.abs((now.confidence as number ?? 0) - (was.confidence as number ?? 0));
    if (dc > 0.2) warns.push(`confidence Δ${dc.toFixed(2)}`);

    if (fails.length) {
      regressions++;
      console.log(`  ${c.red}✗ ${tc.traceId.slice(0, 8)}${c.reset} ${c.dim}"${tc.messageText.slice(0, 50)}"${c.reset}`);
      for (const f of fails) console.log(`      ${c.red}${f}${c.reset}`);
    } else if (warns.length) {
      warnings++;
      console.log(`  ${c.yellow}~ ${tc.traceId.slice(0, 8)}${c.reset} ${c.dim}${warns.join('; ')}${c.reset}`);
    }
  }

  console.log(`\n${c.bold}Traces: ${regressions} routing regressions, ${warnings} warnings, over ${traces.length} rows${c.reset}`);
  return regressions === 0;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const classifier = app.get(ClassifierService);
    const availability = app.get(AvailabilityService);
    const ds = app.get(DataSource);

    let ok = true;
    if (args.golden) ok = (await runGolden(classifier)) && ok;
    if (args.traces) ok = (await runTraces(classifier, availability, ds, args)) && ok;

    process.exitCode = ok ? 0 : 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
