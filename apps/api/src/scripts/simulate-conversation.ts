#!/usr/bin/env ts-node
/**
 * Conversation simulator — runs scenarios through the same turn runner real
 * messages use (v2 agent), in demo mode, without Instagram. Orders are really
 * placed and payment details really claimed in the local DB, so assertions
 * check outcomes: the reply, the handoff, the order draft, the placed order.
 *
 * Usage:
 *   npm run simulate -- --scenario demo_altamen_shirt_measurements_order
 *   npm run simulate -- --tenant demo-altamen
 *   npm run simulate -- --tenant demo-altamen --message "Привіт || а чорна є?"
 *   npm run simulate -- --tenant demo-altamen --image photos/delivery-details.png --message "ось дані"
 *       (--image: a file under test-assets/ or a URL, sent as a photo before the first message)
 *   npm run simulate -- --all --out agent-run.json
 *   npm run simulate -- --list
 *   ... --model gpt-5.4          run every turn on another model
 *
 * Costs real model calls. Scenarios written for the classifier engine still
 * run: their route-only assertions are dropped and listed per turn (see
 * modules/testing/scenario-assertions.ts).
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import {
  ScenarioIdentity,
  ScenarioRunner,
  ScenarioTurnLog,
  TenantNotFoundError,
} from '../modules/testing/scenario-runner.service';
import { deepMerge } from '../common/deep-merge';
import { describeLook } from '../modules/catalog/attributes/product-attributes';
import { SCENARIOS, SimulatorScenario } from './scenarios';

// ─── Colors ──────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  white: '\x1b[37m',
};

// ─── Constants ───────────────────────────────────────────────────

const IDENTITY: ScenarioIdentity = {
  externalUserId: 'sim-customer-001',
  channel: 'instagram',
  channelAccountId: 'sim-channel',
};

// ─── flow_config override safety (SIMULATOR-ONLY) ────────────────
//
// `flowConfigOverride` mutates a REAL store_configs row for the duration of a
// scenario. If the process dies before the restore runs, the tenant is left
// permanently misconfigured and nothing detects it: demo-women-clothes sat with
// preQualify disabled (and preQualify.fields / .prompt deleted outright by the
// shallow merge) until a config audit turned it up, and the only symptom was a
// handful of scenarios failing in ways that looked like classifier noise.
//
// A `finally` block cannot fix this — SIGKILL, an OOM kill and a hard crash all
// skip it. So recovery must not depend on the dying process: the pre-mutation
// value is written to disk FIRST, and the next simulator boot replays any
// backup it finds. Everything here is confined to this script; no engine or
// production code path knows about flow_config overrides.

const FLOW_CONFIG_BACKUP_DIR = path.join(process.cwd(), '.simulator-backups');

const backupPathFor = (tenantId: string): string =>
  path.join(FLOW_CONFIG_BACKUP_DIR, `flow-config-${tenantId}.json`);

function writeFlowConfigBackup(
  tenantId: string,
  original: Record<string, unknown>,
): void {
  fs.mkdirSync(FLOW_CONFIG_BACKUP_DIR, { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated backup that
  // would then be replayed as if it were the real config.
  const tmp = `${backupPathFor(tenantId)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tenantId, flowConfig: original }, null, 2));
  fs.renameSync(tmp, backupPathFor(tenantId));
}

function clearFlowConfigBackup(tenantId: string): void {
  try {
    fs.unlinkSync(backupPathFor(tenantId));
  } catch {
    /* already gone — nothing to do */
  }
}

/**
 * Self-heal. Runs before any scenario: if a previous run died holding an
 * override, its backup is still on disk — replay it and clear it. Idempotent,
 * so a clean run is a no-op.
 */
async function restoreLeakedFlowConfigs(dataSource: DataSource): Promise<void> {
  if (!fs.existsSync(FLOW_CONFIG_BACKUP_DIR)) return;
  const files = fs
    .readdirSync(FLOW_CONFIG_BACKUP_DIR)
    .filter((f) => f.startsWith('flow-config-') && f.endsWith('.json'));
  if (files.length === 0) return;

  for (const file of files) {
    const full = path.join(FLOW_CONFIG_BACKUP_DIR, file);
    try {
      const { tenantId, flowConfig } = JSON.parse(fs.readFileSync(full, 'utf8'));
      await dataSource.query(
        `UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`,
        [JSON.stringify(flowConfig ?? {}), tenantId],
      );
      fs.unlinkSync(full);
      console.log(
        `${c.yellow}⚠ Recovered leaked flow_config override for tenant ${String(tenantId).slice(0, 8)}… ` +
          `(a previous run was killed before it could restore). Config reverted.${c.reset}`,
      );
    } catch (err) {
      console.error(
        `${c.red}Failed to replay flow_config backup ${file}: ${(err as Error).message}${c.reset}`,
      );
    }
  }
}

// ─── CLI args ────────────────────────────────────────────────────

interface CliArgs {
  scenario: string | null;
  list: boolean;
  all: boolean;
  tenant: string | null;
  message: string | null;
  image: string | null;
  out: string | null;
  model: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    scenario: null,
    list: false,
    all: false,
    tenant: null,
    message: null,
    image: null,
    out: null,
    model: null,
  };
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === '--scenario' && next) result.scenario = args[++i];
    else if (args[i] === '--list') result.list = true;
    else if (args[i] === '--all') result.all = true;
    else if (args[i] === '--tenant' && next) result.tenant = args[++i];
    else if (args[i] === '--message' && next) result.message = args[++i];
    else if (args[i] === '--image' && next) result.image = args[++i];
    else if (args[i] === '--out' && next) result.out = args[++i];
    else if (args[i] === '--model' && next) result.model = args[++i];
  }
  return result;
}

// ─── Flow config override ────────────────────────────────────────

/** Restores still armed for the scenario in flight; drained on SIGINT/SIGTERM. */
const pendingRestores = new Set<() => Promise<void>>();

/**
 * Deep-merge `scenario.flowConfigOverride` onto the tenant's flow_config and
 * return the restore. The original is backed up to disk first, so a killed
 * run is repaired on the next boot (`restoreLeakedFlowConfigs`).
 */
async function applyFlowConfigOverride(
  dataSource: DataSource,
  scenario: SimulatorScenario,
): Promise<() => Promise<void>> {
  if (!scenario.flowConfigOverride) return async () => {};
  const rows: Array<{ flow_config: Record<string, unknown> | null }> = await dataSource.query(
    `SELECT flow_config FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
    [scenario.tenantId],
  );
  const original = rows[0]?.flow_config ?? {};
  writeFlowConfigBackup(scenario.tenantId, original);
  await dataSource.query(`UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`, [
    JSON.stringify(deepMerge(original, scenario.flowConfigOverride)),
    scenario.tenantId,
  ]);
  const restore = async () => {
    await dataSource.query(`UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`, [
      JSON.stringify(original),
      scenario.tenantId,
    ]);
    clearFlowConfigBackup(scenario.tenantId);
  };
  pendingRestores.add(restore);
  return async () => {
    pendingRestores.delete(restore);
    await restore();
  };
}

// ─── Printing ────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function printHeader(scenario: SimulatorScenario): void {
  console.log('');
  console.log(`${c.bold}${c.blue}${'═'.repeat(65)}${c.reset}`);
  console.log(`${c.bold}${c.blue}  ${scenario.name}${c.reset}`);
  console.log(`${c.dim}  ${scenario.description}${c.reset}`);
  if (scenario.expectedFailure) console.log(`${c.yellow}  expected to fail: ${scenario.expectedFailure}${c.reset}`);
  console.log(`${c.bold}${c.blue}${'═'.repeat(65)}${c.reset}`);
}

const KIND_COLOR: Record<string, string> = {
  welcome: c.dim,
  reply: c.green,
  payment_details: c.cyan,
  handoff_announce: c.red,
};

function printTurn(log: ScenarioTurnLog): void {
  const media = log.mediaReference ? ` ${c.magenta}[${log.mediaReference.type}]${c.reset}` : '';
  const later = log.advanceHours ? ` ${c.yellow}[+${log.advanceHours}h]${c.reset}` : '';
  console.log('');
  console.log(`${c.cyan}${'─'.repeat(65)}${c.reset}`);
  console.log(`${c.bold}${c.cyan} Turn ${log.turnIndex + 1}: "${log.message}"${c.reset}${media}${later}`);
  console.log(`${c.cyan}${'─'.repeat(65)}${c.reset}`);

  for (const call of log.toolCalls) {
    console.log(`  ${c.dim}[${call.attempt}]${c.reset} → ${call.toolName}${c.dim}(${truncate(JSON.stringify(call.input), 160)})${c.reset}`);
  }
  log.attempts.slice(0, -1).forEach((a, i) => {
    const problems = [...a.grounding.map((g) => `${g.kind} «${g.value}»`), ...a.style.map((s) => `«${s.match}»`)];
    console.log(`  ${c.yellow}⚠ attempt ${i + 1} retried: ${problems.join(', ')}${c.reset}`);
  });
  if (log.status !== 'replied' && log.status !== 'handed_off') console.log(`  ${c.red}status: ${log.status}${c.reset}`);

  for (const m of log.messages) {
    const color = KIND_COLOR[m.kind] ?? '';
    const [first, ...more] = m.text.split('\n');
    console.log(`  ${color}${m.kind.padEnd(16)} "${first}"${c.reset}`);
    for (const line of more) console.log(`  ${color}${' '.repeat(17)}"${line}"${c.reset}`);
    if (m.imageUrls?.length) console.log(`  ${c.dim}${' '.repeat(17)}${m.imageUrls.length} image(s)${c.reset}`);
  }
  if (log.handoff) {
    console.log(`  ${c.red}handoff: ${log.handoff.reason}${log.handoff.summaryForManager ? ` — ${log.handoff.summaryForManager}` : ''}${c.reset}`);
  }

  if (log.draft) {
    const items = log.draft.items.map((i) => `${i.title} (${[i.color, i.size].filter(Boolean).join(', ')}) ×${i.quantity}`);
    const missing = log.draft.missingFields.length ? `missing: ${log.draft.missingFields.join(', ')}` : 'complete';
    console.log(`  ${c.yellow}draft: ${log.draft.status} — ${items.join('; ') || 'no items'} — ${missing}${c.reset}`);
  }
  if (log.orderPlaced) console.log(`  ${c.yellow}order placed${log.paymentDetailsSent ? ', payment details sent' : ''}${c.reset}`);
  for (const item of log.shortlist) {
    const look = describeLook(item.attributes, { withColour: true }) ?? 'no look yet';
    console.log(`  ${c.dim}offered: ${item.title} [${look}] (${item.via})${c.reset}`);
  }

  const failed = log.assertions.filter((a) => !a.pass);
  const explicit = log.assertions.filter((a) => !a.field.startsWith('implicit.'));
  if (failed.length === 0) {
    console.log(`  ${c.green}✓ ${explicit.length} assertion(s) + implicit checks passed${c.reset}`);
  } else {
    console.log(`  ${c.red}✗ ${failed.length}/${log.assertions.length} failed${c.reset}`);
    for (const a of failed) {
      console.log(`    ${c.red}✗ ${a.field}: expected ${JSON.stringify(a.expected)}, got ${truncate(JSON.stringify(a.actual) ?? 'undefined', 200)}${c.reset}`);
    }
  }
  if (log.legacyDropped.length) console.log(`  ${c.dim}legacy route checks dropped: ${log.legacyDropped.join(', ')}${c.reset}`);
  if (log.usage) {
    console.log(
      `  ${c.dim}${log.model}, ${log.durationMs}ms, tokens in ${log.usage.inputTokens} (cached ${log.usage.cachedInputTokens}) / out ${log.usage.outputTokens}${c.reset}`,
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────

interface ScenarioRunLog {
  scenario: string;
  name: string;
  tenantId: string;
  flaky: boolean;
  expectedFailure: string | null;
  timestamp: string;
  turns: ScenarioTurnLog[];
}

function failed(run: ScenarioRunLog): boolean {
  return run.turns.some((t) => t.assertions.some((a) => !a.pass));
}

function selectScenarios(args: CliArgs): Array<[string, SimulatorScenario]> | 'ad-hoc' | null {
  if (args.message && !args.tenant) {
    console.error(`${c.red}--message requires --tenant.${c.reset}`);
    process.exit(1);
  }
  if (args.tenant && args.message) return 'ad-hoc';
  if (args.all) return Object.entries(SCENARIOS);
  if (args.scenario) {
    const s = SCENARIOS[args.scenario];
    if (!s) {
      console.error(`${c.red}Unknown scenario: "${args.scenario}". Use --list to see available scenarios.${c.reset}`);
      process.exit(1);
    }
    return [[args.scenario, s]];
  }
  if (args.tenant) {
    const matching = Object.entries(SCENARIOS).filter(([, s]) => s.tenantId === args.tenant);
    if (matching.length === 0) {
      console.error(`${c.red}No scenarios for tenant "${args.tenant}". Pass --message for an ad-hoc run, or --list.${c.reset}`);
      process.exit(1);
    }
    console.log(`${c.dim}Tenant filter: ${args.tenant} → ${matching.length} scenario(s)${c.reset}`);
    return matching;
  }
  return null;
}

function printSummary(runs: ScenarioRunLog[]): number {
  const gatingFailures = runs.filter((r) => failed(r) && !r.flaky && !r.expectedFailure);
  const flakyFailures = runs.filter((r) => failed(r) && r.flaky && !r.expectedFailure);
  const stillExpected = runs.filter((r) => failed(r) && r.expectedFailure);
  const nowPassing = runs.filter((r) => !failed(r) && r.expectedFailure);
  const turns = runs.flatMap((r) => r.turns);
  const assertions = turns.flatMap((t) => t.assertions);
  const explicit = assertions.filter((a) => !a.field.startsWith('implicit.'));
  const implicit = assertions.filter((a) => a.field.startsWith('implicit.'));
  const uncheckedTurns = turns.filter(
    (t) => t.legacyDropped.length > 0 && t.assertions.every((a) => a.field.startsWith('implicit.')),
  );
  const tokens = turns.reduce(
    (sum, t) => ({
      input: sum.input + (t.usage?.inputTokens ?? 0),
      cached: sum.cached + (t.usage?.cachedInputTokens ?? 0),
      output: sum.output + (t.usage?.outputTokens ?? 0),
    }),
    { input: 0, cached: 0, output: 0 },
  );
  const durations = turns.map((t) => t.durationMs).sort((a, b) => a - b);
  const p = (q: number) => durations[Math.min(durations.length - 1, Math.floor(q * durations.length))] ?? 0;

  console.log('');
  console.log(`${c.bold}${'═'.repeat(65)}${c.reset}`);
  console.log(`${c.bold}  Summary${c.reset}`);
  console.log(`${c.bold}${'═'.repeat(65)}${c.reset}`);
  console.log(`  Scenarios: ${runs.length - runs.filter(failed).length}/${runs.length} passing`);
  console.log(`  ${gatingFailures.length ? c.red : c.green}Failing (gating): ${gatingFailures.length}${c.reset}`);
  for (const r of gatingFailures) console.log(`    ${c.red}${r.scenario}${c.reset}`);
  console.log(`  ${c.dim}Failing (flaky, non-gating): ${flakyFailures.length}${c.reset}`);
  if (stillExpected.length) console.log(`  ${c.dim}Expected failures still failing: ${stillExpected.length}${c.reset}`);
  for (const r of nowPassing) {
    console.log(`  ${c.green}Now passing — remove expectedFailure from ${r.scenario}${c.reset}`);
  }
  console.log(
    `  Assertions: ${explicit.filter((a) => a.pass).length}/${explicit.length} explicit, ` +
      `${implicit.filter((a) => a.pass).length}/${implicit.length} implicit`,
  );
  if (uncheckedTurns.length) {
    console.log(
      `  ${c.yellow}${uncheckedTurns.length} turn(s) had only legacy route checks, so only implicit checks ran (see legacyDropped in the log)${c.reset}`,
    );
  }
  console.log(
    `  ${c.dim}Tokens: in ${tokens.input} (cached ${tokens.cached}) / out ${tokens.output} · turn time p50 ${p(0.5)}ms, p95 ${p(0.95)}ms${c.reset}`,
  );
  return gatingFailures.length;
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.list) {
    console.log(`\n${c.bold}Available scenarios:${c.reset}\n`);
    for (const [key, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${c.cyan}${key}${c.reset} ${c.dim}(${s.tenantId}, ${s.turns.length} turns)${c.reset}`);
      console.log(`    ${s.name}`);
    }
    return;
  }

  const selection = selectScenarios(args);
  if (!selection) {
    console.log(`Usage: npm run simulate -- --scenario <name> | --all | --list | --tenant <slug> [--message <text> [--image <file|url>]] [--model <id>] [--out <file>]`);
    return;
  }

  console.log(`${c.dim}Bootstrapping NestJS app...${c.reset}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const runner = app.get(ScenarioRunner);
  const dataSource = app.get(DataSource);

  // A killed run may have left a flow_config override behind; repair it first.
  await restoreLeakedFlowConfigs(dataSource);
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      const pending = [...pendingRestores];
      if (pending.length === 0) process.exit(130);
      console.log(`\n${c.yellow}${signal} — restoring ${pending.length} flow_config override(s) before exit…${c.reset}`);
      Promise.allSettled(pending.map((r) => r())).finally(() => process.exit(130));
    });
  }

  let scenarios: Array<[string, SimulatorScenario]>;
  if (selection === 'ad-hoc') {
    // `||` splits the message into sequential turns.
    scenarios = [
      [
        '__ad_hoc__',
        {
          name: `ad-hoc (${args.tenant})`,
          description: `ad-hoc message: "${args.message}"`,
          tenantId: args.tenant!,
          turns: args.message!.split('||').map((m, i) => ({
      message: m.trim(),
      ...(i === 0 && args.image && { image: args.image }),
    })),
        },
      ],
    ];
  } else {
    scenarios = selection;
  }

  const runs: ScenarioRunLog[] = [];
  const skipped: string[] = [];
  for (const [key, original] of scenarios) {
    let scenario: SimulatorScenario;
    try {
      scenario = { ...original, tenantId: await runner.resolveTenantId(original.tenantId) };
    } catch (err) {
      // Tenants that exist only on prod are skipped in batch runs, not fatal.
      if (err instanceof TenantNotFoundError && (args.all || args.tenant) && selection !== 'ad-hoc') {
        skipped.push(`${key} (${original.tenantId})`);
        continue;
      }
      throw err;
    }
    printHeader(scenario);
    const restore = await applyFlowConfigOverride(dataSource, scenario);
    let turns: ScenarioTurnLog[];
    try {
      turns = await runner.run(scenario, IDENTITY, {
        source: 'simulator_cli',
        modelOverride: args.model ?? undefined,
        onTurn: printTurn,
      });
    } finally {
      await restore();
    }
    runs.push({
      scenario: key,
      name: scenario.name,
      tenantId: scenario.tenantId,
      flaky: scenario.flaky === true,
      expectedFailure: scenario.expectedFailure ?? null,
      timestamp: new Date().toISOString(),
      turns,
    });
  }

  if (skipped.length) {
    console.log(`\n${c.yellow}Skipped ${skipped.length} scenario(s) — tenant not in this environment:${c.reset}`);
    for (const s of skipped) console.log(`  ${c.dim}${s}${c.reset}`);
  }
  const gatingFailures = printSummary(runs);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = args.all ? 'all' : (args.scenario ?? args.tenant ?? 'run');
  const logFile = args.out
    ? path.resolve(args.out)
    : path.join(process.cwd(), `simulator-output-${label}-${timestamp}.json`);
  fs.writeFileSync(logFile, JSON.stringify(runs, null, 2));
  console.log(`\n${c.dim}Log saved: ${logFile}${c.reset}`);

  await app.close();
  if (gatingFailures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
