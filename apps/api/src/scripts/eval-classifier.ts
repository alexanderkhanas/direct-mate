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
  ab?: string; // candidate model id to A/B against the current classifier model
  effort?: string; // reasoning_effort for the candidate model
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
    else if (t === '--ab') a.ab = argv[++i];
    else if (t === '--effort') a.effort = argv[++i];
  }
  if (!a.golden && !a.traces && !a.ab) a.golden = true; // default
  return a;
}

// Per-1M-token prices (USD), from the model research. Used only for the
// A/B cost estimate; update if pricing moves.
const PRICES: Record<string, { in: number; out: number }> = {
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-5.6-luna': { in: 1.0, out: 6.0 },
  'gpt-5.6-terra': { in: 2.5, out: 15 },
  'gpt-5.4': { in: 2.5, out: 15 },
  // Anthropic list prices (USD / 1M tokens).
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-5': { in: 3.0, out: 15.0 },
};

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

// ─── A/B mode: current model vs a candidate, over the golden set ─

interface Usage { model: string; promptTokens: number; completionTokens: number; latencyMs: number }

async function classifyGolden(
  classifier: ClassifierService,
  gc: GoldenCase,
  override?: { model: string; effort?: string },
): Promise<{ out: ClassificationResult; usage: Usage; error?: string }> {
  const empty = { model: override?.model ?? 'A', promptTokens: 0, completionTokens: 0, latencyMs: 0 };
  let lastErr = '';
  // Retry transient failures (the new model 401/429/500s intermittently).
  for (let attempt = 0; attempt < 3; attempt++) {
    const sink: Usage[] = [];
    try {
      const out = await classifier.classify({
        messageText: gc.params.messageText,
        recentMessages: gc.params.recentMessages,
        memory: gc.params.memory,
        categories: gc.params.categories ?? [],
        tenantBusinessType: gc.params.tenantBusinessType ?? 'clothing',
        usageSink: sink as any,
        modelOverride: override?.model,
        reasoningEffort: override?.effort,
      });
      return { out, usage: sink[0] ?? empty };
    } catch (err: any) {
      lastErr = err?.message ?? String(err);
    }
  }
  return { out: {} as ClassificationResult, usage: empty, error: lastErr };
}

function goldenVerdict(gc: GoldenCase, out: ClassificationResult): { pass: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const f of ROUTING_FIELDS) {
    const exp = gc.expect[f];
    if (exp !== undefined && out[f] !== exp) problems.push(`${f}: want ${exp}, got ${out[f] ?? '-'}`);
  }
  if (gc.expect.entities) {
    for (const [k, v] of Object.entries(gc.expect.entities)) {
      if (!entitiesEqual(out.entities ?? {}, k, v)) {
        const got = (out.entities as Record<string, unknown> ?? {})[k];
        problems.push(`entities.${k}: want ${v === null ? 'ABSENT' : v}, got ${got ?? 'ABSENT'}`);
      }
    }
  }
  return { pass: problems.length === 0, problems };
}

async function runAB(classifier: ClassifierService, args: Args): Promise<boolean> {
  const file = path.join(__dirname, 'eval', 'golden-cases.json');
  const cases: GoldenCase[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const modelA = (classifier as any).model as string;
  const modelB = args.ab!;
  console.log(`${c.bold}A/B over ${cases.length} golden cases${c.reset}`);
  console.log(`  A = ${modelA} (current)`);
  console.log(`  B = ${modelB}${args.effort ? ` (effort=${args.effort})` : ''}\n`);

  let aPass = 0, bPass = 0, aErrors = 0, bErrors = 0;
  let comparable = 0; // cases where BOTH models answered — the only fair basis
  const disagree: string[] = [];
  const bOnlyFail: string[] = [];
  const bOnlyPass: string[] = [];
  const usageA: Usage[] = [];
  const usageB: Usage[] = [];
  const pause = () => new Promise((r) => setTimeout(r, 400)); // ease rate limits

  for (const gc of cases) {
    const a = await classifyGolden(classifier, gc);
    await pause();
    const b = await classifyGolden(classifier, gc, { model: modelB, effort: args.effort });
    await pause();

    // Score each model independently — a failure on one side must NEVER
    // silently suppress the other side's score (the bug in the first run).
    const va = a.error ? { pass: false, problems: [] } : goldenVerdict(gc, a.out);
    const vb = b.error ? { pass: false, problems: [] } : goldenVerdict(gc, b.out);
    if (a.error) { aErrors++; } else { usageA.push(a.usage); if (va.pass) aPass++; }
    if (b.error) { bErrors++; } else { usageB.push(b.usage); if (vb.pass) bPass++; }

    if (a.error || b.error) {
      const who = a.error ? `A-ERR ${a.error}` : `B-ERR ${b.error}`;
      console.log(`  ${c.red}${who.slice(0, 90)}${c.reset}  ${gc.id}`);
      continue;
    }

    comparable++;
    if (va.pass && !vb.pass) bOnlyFail.push(gc.id);
    if (!va.pass && vb.pass) bOnlyPass.push(gc.id);

    const routingDiff = ROUTING_FIELDS
      .filter((f) => a.out[f] !== b.out[f])
      .map((f) => `${f}: A=${a.out[f] ?? '-'} B=${b.out[f] ?? '-'}`);
    console.log(
      `  A${va.pass ? c.green + '✓' : c.red + '✗'}${c.reset} B${vb.pass ? c.green + '✓' : c.red + '✗'}${c.reset}  ${gc.id} ${c.dim}"${gc.params.messageText.slice(0, 32)}"${c.reset}`,
    );
    if (!va.pass) console.log(`        ${c.red}A: ${va.problems.join('; ')}${c.reset}`);
    if (!vb.pass) console.log(`        ${c.red}B: ${vb.problems.join('; ')}${c.reset}`);
    if (routingDiff.length) { disagree.push(gc.id); console.log(`        ${c.yellow}${routingDiff.join(' | ')}${c.reset}`); }
  }

  const avg = (u: Usage[], k: 'promptTokens' | 'completionTokens' | 'latencyMs') =>
    u.length ? u.reduce((s, x) => s + x[k], 0) / u.length : 0;
  const costPer1k = (model: string, u: Usage[]) => {
    const p = PRICES[model];
    if (!p) return null;
    return ((avg(u, 'promptTokens') * p.in + avg(u, 'completionTokens') * p.out) / 1e6) * 1000;
  };

  console.log(`\n${c.bold}═══ A/B RESULT ═══${c.reset}`);
  console.log(`Cases: ${cases.length} total | ${comparable} answered by BOTH (fair basis)`);
  console.log(`Reliability:      A ${aErrors} errors   B ${c.bold}${bErrors} errors${c.reset}`);
  console.log(`Golden accuracy (all cases; an error counts as a miss):`);
  console.log(`                  A ${aPass}/${cases.length}   B ${bPass}/${cases.length}`);
  console.log(`B fixed (A✗→B✓): ${bOnlyPass.length}${bOnlyPass.length ? ' — ' + bOnlyPass.join(', ') : ''}`);
  console.log(`B broke (A✓→B✗): ${bOnlyFail.length}${bOnlyFail.length ? ' — ' + bOnlyFail.join(', ') : ''}`);
  console.log(`Routing disagreements: ${disagree.length}/${comparable} of comparable cases`);
  console.log(`\nLatency (avg ms):  A ${avg(usageA, 'latencyMs').toFixed(0)}   B ${avg(usageB, 'latencyMs').toFixed(0)}`);
  console.log(`Tokens (avg in+out): A ${avg(usageA, 'promptTokens').toFixed(0)}+${avg(usageA, 'completionTokens').toFixed(0)}   B ${avg(usageB, 'promptTokens').toFixed(0)}+${avg(usageB, 'completionTokens').toFixed(0)}`);
  const ca = costPer1k(modelA, usageA), cb = costPer1k(modelB, usageB);
  if (ca != null && cb != null) {
    console.log(`Cost per 1k calls: A $${ca.toFixed(2)}   B $${cb.toFixed(2)}   (B is ${((cb / ca - 1) * 100).toFixed(0)}% ${cb >= ca ? 'more' : 'less'})`);
  }
  console.log(`\n${c.bold}Verdict:${c.reset} B ${bPass > aPass ? c.green + 'MORE accurate' : bPass < aPass ? c.red + 'LESS accurate' : 'EQUAL accuracy'}${c.reset} on the golden set (${bPass} vs ${aPass}).`);
  return bErrors === 0;
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
    if (args.ab) ok = (await runAB(classifier, args)) && ok;
    else if (args.golden) ok = (await runGolden(classifier)) && ok;
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
