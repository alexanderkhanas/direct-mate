#!/usr/bin/env ts-node
/**
 * CLI Entry Point — E2E Conversation Tests
 *
 * Usage:
 *   npm run test:conversations                          # run all scenarios
 *   npm run test:conversations -- --only 1              # run only scenario 01
 *   npm run test:conversations -- --scenario 03         # run scenario by number prefix
 *   npm run test:conversations -- --verbose             # show step-by-step detail
 *   npm run test:conversations -- --only 1 --verbose    # combine flags
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import {
  ConversationTestRunner,
  TestScenario,
  ScenarioResult,
} from './conversation-test-runner';

// js-yaml is available from root node_modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

// ─── Colors ───────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// ─── Parse CLI args ───────────────────────────────────────────────

interface CliArgs {
  only: number | null;
  scenario: string | null;
  verbose: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { only: null, scenario: null, verbose: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) {
      result.only = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--scenario' && args[i + 1]) {
      result.scenario = args[i + 1];
      i++;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      result.verbose = true;
    }
  }

  return result;
}

// ─── Load scenario files ──────────────────────────────────────────

function loadScenarios(filter: CliArgs): Array<{ scenario: TestScenario; fileName: string }> {
  const scenariosDir = path.join(__dirname, 'scenarios');

  if (!fs.existsSync(scenariosDir)) {
    console.error(`Scenarios directory not found: ${scenariosDir}`);
    process.exit(1);
  }

  let files = fs
    .readdirSync(scenariosDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();

  // Apply filters
  if (filter.only !== null) {
    const prefix = String(filter.only).padStart(2, '0');
    files = files.filter((f) => f.startsWith(prefix));
  }
  if (filter.scenario !== null) {
    const prefix = filter.scenario.padStart(2, '0');
    files = files.filter((f) => f.startsWith(prefix) || f.includes(filter.scenario!));
  }

  if (files.length === 0) {
    console.error('No matching scenario files found.');
    process.exit(1);
  }

  return files.map((fileName) => {
    const filePath = path.join(scenariosDir, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    const scenario = yaml.load(content) as TestScenario;
    return { scenario, fileName };
  });
}

// ─── Print results ────────────────────────────────────────────────

function printResults(results: ScenarioResult[]): void {
  console.log('');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const idx = `[${i + 1}/${results.length}]`;
    const stepCount = r.steps.length;
    const duration = (r.totalDuration / 1000).toFixed(1);

    if (r.passed) {
      console.log(
        `${c.green}  PASS${c.reset} ${idx} ${r.scenarioName} ${c.dim}(${stepCount} messages, ${duration}s)${c.reset}`,
      );
    } else {
      console.log(
        `${c.red}  FAIL${c.reset} ${idx} ${r.scenarioName}`,
      );

      if (r.error) {
        console.log(`${c.red}   Error: ${r.error}${c.reset}`);
      }

      // Show first failing step
      const failStep = r.steps.find((s) => !s.passed);
      if (failStep) {
        console.log(
          `${c.gray}   Step ${failStep.stepIndex + 1}: "${failStep.customerMessage}"${c.reset}`,
        );
        for (const f of failStep.failures) {
          console.log(`${c.red}   -> ${f}${c.reset}`);
        }
        if (failStep.replyText) {
          const truncReply = failStep.replyText.replace(/\n/g, ' ').slice(0, 120);
          console.log(`${c.dim}   Reply: "${truncReply}"${c.reset}`);
        }
      }
    }
  }

  console.log('');
  const color = failed === 0 ? c.green : c.red;
  console.log(
    `${c.bold}Results: ${color}${passed}/${results.length} passed${c.reset}${failed > 0 ? `${c.bold}, ${c.red}${failed} failed${c.reset}` : ''}`,
  );
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs = parseArgs();

  console.log(`\n${c.bold}${c.blue}=== DirectMate E2E Conversation Tests ===${c.reset}\n`);

  // Load scenarios
  const scenarios = loadScenarios(cliArgs);
  console.log(
    `${c.dim}Loaded ${scenarios.length} scenario(s)${c.reset}`,
  );

  // Bootstrap NestJS application context
  console.log(`${c.dim}Bootstrapping NestJS app...${c.reset}`);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: cliArgs.verbose ? ['error', 'warn', 'log'] : ['error'],
  });

  const runner = new ConversationTestRunner(app, cliArgs.verbose);
  const results: ScenarioResult[] = [];

  // Run each scenario
  for (let i = 0; i < scenarios.length; i++) {
    const { scenario, fileName } = scenarios[i];
    const label = `${c.cyan}[${i + 1}/${scenarios.length}]${c.reset}`;
    process.stdout.write(
      `${label} ${scenario.name}... `,
    );

    const result = await runner.runScenario(scenario, fileName);
    results.push(result);

    if (result.passed) {
      const dur = (result.totalDuration / 1000).toFixed(1);
      console.log(
        `${c.green}PASS${c.reset} ${c.dim}(${result.steps.length} msgs, ${dur}s)${c.reset}`,
      );
    } else {
      console.log(`${c.red}FAIL${c.reset}`);
    }
  }

  // Print summary
  printResults(results);

  // Clean shutdown
  await app.close();

  // Exit with code 1 if any tests failed
  const anyFailed = results.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
