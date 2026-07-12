#!/usr/bin/env ts-node
/**
 * Compare two simulator runs (model A vs model B) turn-by-turn.
 *
 * The simulator writes one JSON file per run. Run the same scenario set twice
 * with a different OPENAI_CLASSIFIER_MODEL, then diff the outputs here.
 *
 * Usage:
 *   ts-node src/scripts/compare-simulator-runs.ts \
 *     --a ab/a-<tenant>.json --b ab/b-<tenant>.json [--label-a gpt-5.4-mini] \
 *     [--md ab/report.md]
 *
 * Multiple --a/--b pairs may be passed (repeat the flags in matching order) to
 * aggregate several tenants into one report.
 */

import * as fs from 'fs';
import * as path from 'path';

interface Assertion {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
}

interface Turn {
  turnIndex: number;
  message: string;
  classification: Record<string, any> | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  assertions: Assertion[];
}

interface ScenarioRun {
  scenario: string;
  name: string;
  tenantId: string;
  flaky: boolean;
  turns: Turn[];
}

interface ScenarioVerdict {
  key: string;
  flaky: boolean;
  failed: number; // failed assertion count
  total: number; // total assertion count
}

// ─── CLI ─────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  const a: string[] = [];
  const b: string[] = [];
  let labelA = 'A';
  let labelB = 'B';
  let md: string | null = null;
  let exclude: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--a' && next) { a.push(next); i++; }
    else if (argv[i] === '--b' && next) { b.push(next); i++; }
    else if (argv[i] === '--label-a' && next) { labelA = next; i++; }
    else if (argv[i] === '--label-b' && next) { labelB = next; i++; }
    else if (argv[i] === '--md' && next) { md = next; i++; }
    else if (argv[i] === '--exclude' && next) { exclude = next; i++; }
  }
  if (a.length === 0 || a.length !== b.length) {
    console.error('Usage: --a <fileA> --b <fileB> [repeatable, matching order] [--label-a X --label-b Y] [--md out.md]');
    process.exit(1);
  }
  return { a, b, labelA, labelB, md, exclude };
}

function load(file: string): ScenarioRun[] {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as ScenarioRun[];
}

function verdict(run: ScenarioRun): ScenarioVerdict {
  let failed = 0;
  let total = 0;
  for (const t of run.turns) {
    for (const as of t.assertions ?? []) {
      total++;
      if (!as.pass) failed++;
    }
  }
  return { key: run.scenario, flaky: run.flaky === true, failed, total };
}

function ent(c: Record<string, any> | null): string {
  if (!c?.entities) return '-';
  const e = c.entities;
  const parts = ['productName', 'category', 'color', 'size']
    .filter((k) => e[k])
    .map((k) => `${k}=${e[k]}`);
  return parts.length ? parts.join(',') : '-';
}

// ─── Main ────────────────────────────────────────────────────────

const args = parseArgs();

const runsA: ScenarioRun[] = args.a.flatMap(load);
const runsB: ScenarioRun[] = args.b.flatMap(load);

const byKeyA = new Map(runsA.map((r) => [r.scenario, r]));
const byKeyB = new Map(runsB.map((r) => [r.scenario, r]));

// Scenarios where a classifier call errored: the engine hands off on classifier
// failure (`classify: ai_failure → handoff`), which corrupts state for every
// later turn. Those scenarios say nothing about classification quality, so they
// are excluded from the fair basis and reported separately as a reliability stat.
const excluded: string[] = args.exclude
  ? (JSON.parse(fs.readFileSync(path.resolve(args.exclude), 'utf8')) as string[])
  : [];
const excludedSet = new Set(excluded);

const keys = [...byKeyA.keys()].filter((k) => byKeyB.has(k) && !excludedSet.has(k));

const onlyA = [...byKeyA.keys()].filter((k) => !byKeyB.has(k));
const onlyB = [...byKeyB.keys()].filter((k) => !byKeyA.has(k));

// ─── Scenario-level pass/fail ────────────────────────────────────

interface Row {
  key: string;
  tenant: string;
  flaky: boolean;
  aFailed: number;
  bFailed: number;
  aTotal: number;
  bTotal: number;
}

const rows: Row[] = keys.map((k) => {
  const ra = byKeyA.get(k)!;
  const rb = byKeyB.get(k)!;
  const va = verdict(ra);
  const vb = verdict(rb);
  return {
    key: k,
    tenant: ra.tenantId,
    flaky: va.flaky,
    aFailed: va.failed,
    bFailed: vb.failed,
    aTotal: va.total,
    bTotal: vb.total,
  };
});

const bFixed = rows.filter((r) => r.aFailed > 0 && r.bFailed === 0);
const bBroke = rows.filter((r) => r.aFailed === 0 && r.bFailed > 0);
const bothFail = rows.filter((r) => r.aFailed > 0 && r.bFailed > 0);

const gating = rows.filter((r) => !r.flaky);
const flaky = rows.filter((r) => r.flaky);

const sum = (rs: Row[], f: (r: Row) => number) => rs.reduce((acc, r) => acc + f(r), 0);

// ─── Turn-level disagreements ────────────────────────────────────

interface Disagreement {
  key: string;
  turn: number;
  message: string;
  aIntent: string;
  bIntent: string;
  aSlot: string;
  bSlot: string;
  aEnt: string;
  bEnt: string;
  aScenario: string;
  bScenario: string;
  aDecision: string;
  bDecision: string;
  classifierDiff: boolean;
  routingDiff: boolean;
}

const disagreements: Disagreement[] = [];
let comparableTurns = 0;

for (const k of keys) {
  const ta = byKeyA.get(k)!.turns;
  const tb = byKeyB.get(k)!.turns;
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    comparableTurns++;
    const A = ta[i];
    const B = tb[i];
    const aIntent = A.classification?.primaryIntent ?? '-';
    const bIntent = B.classification?.primaryIntent ?? '-';
    const aSlot = A.classification?.slotAction ?? '-';
    const bSlot = B.classification?.slotAction ?? '-';
    const aEnt = ent(A.classification);
    const bEnt = ent(B.classification);
    const aScenario = A.scenario ?? '-';
    const bScenario = B.scenario ?? '-';
    const classifierDiff = aIntent !== bIntent || aSlot !== bSlot || aEnt !== bEnt;
    const routingDiff = aScenario !== bScenario || A.decision !== B.decision;
    if (classifierDiff || routingDiff) {
      disagreements.push({
        key: k,
        turn: i,
        message: A.message,
        aIntent, bIntent, aSlot, bSlot, aEnt, bEnt,
        aScenario, bScenario,
        aDecision: A.decision,
        bDecision: B.decision,
        classifierDiff,
        routingDiff,
      });
    }
  }
}

const routingDiffs = disagreements.filter((d) => d.routingDiff);
const classifierOnly = disagreements.filter((d) => d.classifierDiff && !d.routingDiff);

// ─── Report ──────────────────────────────────────────────────────

const L: string[] = [];
const p = (s = '') => L.push(s);

p(`# Simulator A/B — ${args.labelA} (A) vs ${args.labelB} (B)`);
p();
p(`Scenarios compared: **${keys.length}** (${gating.length} gating, ${flaky.length} flaky) · comparable turns: **${comparableTurns}**`);
if (excluded.length) {
  p();
  p(`> **${excluded.length} scenarios excluded** — B's classifier errored on at least one turn, and the engine hands off on classifier failure, corrupting all later turns. Judging model quality on those would measure the outage, not the model. They are counted as a reliability failure instead.`);
}
if (onlyA.length) p(`\n> Only in A: ${onlyA.join(', ')}`);
if (onlyB.length) p(`\n> Only in B: ${onlyB.join(', ')}`);
p();
p(`## Headline`);
p();
p(`| metric | ${args.labelA} | ${args.labelB} |`);
p(`|---|---|---|`);
p(`| Failing scenarios (gating) | ${gating.filter((r) => r.aFailed > 0).length}/${gating.length} | ${gating.filter((r) => r.bFailed > 0).length}/${gating.length} |`);
p(`| Failing scenarios (flaky) | ${flaky.filter((r) => r.aFailed > 0).length}/${flaky.length} | ${flaky.filter((r) => r.bFailed > 0).length}/${flaky.length} |`);
p(`| Failed assertions (gating) | ${sum(gating, (r) => r.aFailed)} | ${sum(gating, (r) => r.bFailed)} |`);
p(`| Failed assertions (flaky) | ${sum(flaky, (r) => r.aFailed)} | ${sum(flaky, (r) => r.bFailed)} |`);
p(`| Total assertions | ${sum(rows, (r) => r.aTotal)} | ${sum(rows, (r) => r.bTotal)} |`);
p();
p(`**B fixed (A✗ → B✓): ${bFixed.length}** · **B broke (A✓ → B✗): ${bBroke.length}** · both fail: ${bothFail.length}`);
p();

// Per-tenant breakdown
const tenants = [...new Set(rows.map((r) => r.tenant))];
p(`## Per-tenant`);
p();
p(`| tenant | scenarios | A failing | B failing | B fixed | B broke |`);
p(`|---|---|---|---|---|---|`);
for (const t of tenants) {
  const rs = rows.filter((r) => r.tenant === t);
  p(
    `| ${t} | ${rs.length} | ${rs.filter((r) => r.aFailed > 0).length} | ${rs.filter((r) => r.bFailed > 0).length} | ` +
      `${rs.filter((r) => r.aFailed > 0 && r.bFailed === 0).length} | ${rs.filter((r) => r.aFailed === 0 && r.bFailed > 0).length} |`,
  );
}
p();

const listScenarios = (title: string, rs: Row[]) => {
  p(`## ${title} (${rs.length})`);
  p();
  if (rs.length === 0) { p('_none_'); p(); return; }
  p(`| scenario | tenant | flaky | A failed | B failed |`);
  p(`|---|---|---|---|---|`);
  for (const r of rs) {
    p(`| ${r.key} | ${r.tenant} | ${r.flaky ? 'yes' : ''} | ${r.aFailed}/${r.aTotal} | ${r.bFailed}/${r.bTotal} |`);
  }
  p();
};

listScenarios(`B fixed (A✗ → B✓)`, bFixed);
listScenarios(`B broke (A✓ → B✗)`, bBroke);
listScenarios(`Both fail`, bothFail);

p(`## Turn-level disagreements`);
p();
p(`Routing differs (template scenario or decision): **${routingDiffs.length}/${comparableTurns}** turns`);
p(`Classifier differs but routing identical: **${classifierOnly.length}/${comparableTurns}** turns`);
p();
if (routingDiffs.length) {
  p(`### Routing disagreements`);
  p();
  p(`| scenario | turn | message | A intent/slot → scenario | B intent/slot → scenario |`);
  p(`|---|---|---|---|---|`);
  for (const d of routingDiffs) {
    const msg = d.message.replace(/\n/g, ' ⏎ ').slice(0, 48);
    p(
      `| ${d.key} | ${d.turn} | ${msg} | ${d.aIntent}/${d.aSlot} → **${d.aScenario}** (${d.aDecision}) | ${d.bIntent}/${d.bSlot} → **${d.bScenario}** (${d.bDecision}) |`,
    );
  }
  p();
}
if (classifierOnly.length) {
  p(`### Classifier-only disagreements (same routing)`);
  p();
  p(`| scenario | turn | message | A | B |`);
  p(`|---|---|---|---|---|`);
  for (const d of classifierOnly) {
    const msg = d.message.replace(/\n/g, ' ⏎ ').slice(0, 48);
    p(`| ${d.key} | ${d.turn} | ${msg} | ${d.aIntent}/${d.aSlot} [${d.aEnt}] | ${d.bIntent}/${d.bSlot} [${d.bEnt}] |`);
  }
  p();
}

const out = L.join('\n');
console.log(out);
if (args.md) {
  fs.mkdirSync(path.dirname(path.resolve(args.md)), { recursive: true });
  fs.writeFileSync(path.resolve(args.md), out);
  console.error(`\nReport written: ${args.md}`);
}
