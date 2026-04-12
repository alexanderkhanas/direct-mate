#!/usr/bin/env ts-node
/**
 * Conversation Simulator — runs multi-turn conversations through the real
 * ReplyEngineService without needing Instagram or webhooks.
 *
 * Usage:
 *   npx ts-node src/scripts/simulate-conversation.ts --scenario story_reply_clothing
 *   npx ts-node src/scripts/simulate-conversation.ts --list
 *   npx ts-node src/scripts/simulate-conversation.ts --all
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import {
  ReplyEngineService,
  ReplyEngineOutput,
} from '../modules/conversations/reply-engine.service';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { ConversationState } from '../modules/conversations/entities/conversation-state.entity';
import { MessageDirection, MessageRole, ReplyDecision } from '@direct-mate/shared';
import { SCENARIOS, SimulatorScenario, SimulatorTurnExpect } from './scenarios';

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

const SIM_CUSTOMER_EXTERNAL_ID = 'sim-customer-001';
const SIM_CHANNEL = 'instagram';
const SIM_CHANNEL_ACCOUNT_ID = 'sim-channel';

// ─── CLI args ────────────────────────────────────────────────────

interface CliArgs {
  scenario: string | null;
  list: boolean;
  all: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { scenario: null, list: false, all: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      result.scenario = args[i + 1];
      i++;
    } else if (args[i] === '--list') {
      result.list = true;
    } else if (args[i] === '--all') {
      result.all = true;
    }
  }

  return result;
}

// ─── Turn log entry (for JSON output) ───────────────────────────

interface AssertionResult {
  field: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  message?: string;
}

interface TurnLog {
  turnIndex: number;
  message: string;
  mediaReference?: { mediaId: string; type: string };
  classification: Record<string, unknown> | null;
  decision: string;
  scenario: string | null;
  replyText: string | null;
  imageUrls: string[] | undefined;
  state: Record<string, unknown>;
  assertions: AssertionResult[];
  trace: string[];
}

// ─── Assertions ─────────────────────────────────────────────────

function runAssertions(
  expect: SimulatorTurnExpect,
  result: ReplyEngineOutput,
  memory: Record<string, unknown>,
): AssertionResult[] {
  const out: AssertionResult[] = [];
  const arr = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

  const push = (field: string, pass: boolean, expected: unknown, actual: unknown, message?: string) => {
    out.push({ field, pass, expected, actual, message });
  };

  if (expect.decision !== undefined) {
    push('decision', result.decision === expect.decision, expect.decision, result.decision);
  }
  if (expect.scenario !== undefined) {
    const actual = result.templateScenario ?? null;
    push('scenario', actual === expect.scenario, expect.scenario, actual);
  }
  for (const sub of arr(expect.replyContains)) {
    push('replyContains', (result.reply?.text ?? '').toLowerCase().includes(sub.toLowerCase()), sub, result.reply?.text?.slice(0, 80));
  }
  for (const sub of arr(expect.replyNotContains)) {
    push('replyNotContains', !(result.reply?.text ?? '').toLowerCase().includes(sub.toLowerCase()), `NOT ${sub}`, result.reply?.text?.slice(0, 80));
  }
  if (expect.imageCount !== undefined) {
    const actual = result.reply?.imageUrls?.length ?? 0;
    push('imageCount', actual === expect.imageCount, expect.imageCount, actual);
  }

  if (expect.state) {
    const s = expect.state;
    if (s.selectionState !== undefined) push('state.selectionState', memory.selectionState === s.selectionState, s.selectionState, memory.selectionState);
    if (s.selectedProductId !== undefined) {
      if (s.selectedProductId === null) push('state.selectedProductId', !memory.selectedProductId, null, memory.selectedProductId);
      else push('state.selectedProductId', memory.selectedProductId === s.selectedProductId, s.selectedProductId, memory.selectedProductId);
    }
    if (s.selectedVariantName !== undefined) push('state.selectedVariantName', memory.selectedVariantName === s.selectedVariantName, s.selectedVariantName, memory.selectedVariantName);
    if (s.cartLength !== undefined) {
      const actual = Array.isArray(memory.cartItems) ? memory.cartItems.length : 0;
      push('state.cartLength', actual === s.cartLength, s.cartLength, actual);
    }
    if (s.cartHasVariant !== undefined) {
      const items = Array.isArray(memory.cartItems) ? memory.cartItems as any[] : [];
      const found = items.some(it => it.variantName === s.cartHasVariant);
      push('state.cartHasVariant', found, s.cartHasVariant, items.map(it => it.variantName));
    }
    if (s.lastAction !== undefined) push('state.lastAction', memory.lastAction === s.lastAction, s.lastAction, memory.lastAction);
    if (s.awaitingField !== undefined) push('state.awaitingField', memory.awaitingField === s.awaitingField, s.awaitingField, memory.awaitingField);
    if (s.preQualifyCollected !== undefined) push('state.preQualifyCollected', memory.preQualifyCollected === s.preQualifyCollected, s.preQualifyCollected, memory.preQualifyCollected);
    if (s.recommendedSize !== undefined) push('state.recommendedSize', memory.recommendedSize === s.recommendedSize, s.recommendedSize, memory.recommendedSize);
    if (s.orderCreated !== undefined) push('state.orderCreated', memory.orderCreated === s.orderCreated, s.orderCreated, memory.orderCreated);
  }

  return out;
}

// ─── Simulator ───────────────────────────────────────────────────

class ConversationSimulator {
  private replyEngine: ReplyEngineService;
  private conversationsService: ConversationsService;
  private dataSource: DataSource;

  constructor(
    replyEngine: ReplyEngineService,
    conversationsService: ConversationsService,
    dataSource: DataSource,
  ) {
    this.replyEngine = replyEngine;
    this.conversationsService = conversationsService;
    this.dataSource = dataSource;
  }

  async run(scenario: SimulatorScenario): Promise<TurnLog[]> {
    const turnLogs: TurnLog[] = [];

    // Clean up previous sim data for this tenant
    await this.cleanup(scenario.tenantId);

    // Create customer + conversation
    const customer = await this.conversationsService.findOrCreateCustomer(
      scenario.tenantId,
      SIM_CHANNEL,
      SIM_CUSTOMER_EXTERNAL_ID,
    );

    const { conversation } =
      await this.conversationsService.findOrCreateConversation(
        scenario.tenantId,
        customer.id,
        SIM_CHANNEL,
        SIM_CHANNEL_ACCOUNT_ID,
      );

    this.printHeader(scenario, conversation.id);

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];

      // Save inbound message
      await this.conversationsService.saveMessage(
        conversation.id,
        scenario.tenantId,
        MessageDirection.Inbound,
        MessageRole.User,
        turn.message,
      );

      // Load recent messages
      const fullConversation = await this.conversationsService.findById(conversation.id);
      const recentMessages = fullConversation.messages
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(-10)
        .map((m) => ({ role: m.role, text: m.text }));

      // Reload fresh state
      const freshState = await this.dataSource
        .getRepository(ConversationState)
        .findOne({ where: { conversationId: conversation.id } });

      if (!freshState) {
        console.error(`${c.red}ERROR: No state found for conversation ${conversation.id}${c.reset}`);
        break;
      }

      // Call reply engine
      let result: ReplyEngineOutput;
      try {
        result = await this.replyEngine.process({
          tenantId: scenario.tenantId,
          conversationId: conversation.id,
          messageText: turn.message,
          state: freshState,
          recentMessages,
          mediaReference: turn.mediaReference,
        });
      } catch (err) {
        console.error(`${c.red}ERROR on turn ${i + 1}: ${(err as Error).message}${c.reset}`);
        break;
      }

      // Save outbound message
      if (result.reply?.text) {
        await this.conversationsService.saveMessage(
          conversation.id,
          scenario.tenantId,
          MessageDirection.Outbound,
          MessageRole.Assistant,
          result.reply.text,
        );
      }

      // Apply state update
      if (result.stateUpdate) {
        await this.conversationsService.updateState(
          conversation.id,
          result.stateUpdate,
        );
      }

      // Read updated state for display
      const updatedState = await this.dataSource
        .getRepository(ConversationState)
        .findOne({ where: { conversationId: conversation.id } });

      const memory = (updatedState?.contextJson ?? {}) as Record<string, unknown>;

      // Run assertions
      const assertions = turn.expect ? runAssertions(turn.expect, result, memory) : [];

      // Print turn
      this.printTurn(i + 1, turn, result, memory, assertions);

      // Build log entry
      turnLogs.push({
        turnIndex: i,
        message: turn.message,
        mediaReference: turn.mediaReference,
        classification: result.classification
          ? {
              primaryIntent: result.classification.primaryIntent,
              recommendedAction: result.classification.recommendedAction,
              entities: result.classification.entities,
              slotAction: (result.classification as any).slotAction,
              confidence: result.classification.confidence,
              conversationStage: result.classification.conversationStage,
              dialogueAct: result.classification.dialogueAct,
            }
          : null,
        decision: result.decision,
        scenario: result.templateScenario ?? null,
        replyText: result.reply?.text ?? null,
        imageUrls: result.reply?.imageUrls,
        state: {
          selectionState: memory.selectionState,
          selectedProductId: memory.selectedProductId,
          selectedVariantId: memory.selectedVariantId,
          selectedVariantName: memory.selectedVariantName,
          cartItems: memory.cartItems,
          lastAction: memory.lastAction,
          awaitingField: memory.awaitingField,
          preQualifyCollected: memory.preQualifyCollected,
          recommendedSize: memory.recommendedSize,
          orderCreated: memory.orderCreated,
        },
        assertions,
        trace: result.trace ?? [],
      });
    }

    return turnLogs;
  }

  private printHeader(scenario: SimulatorScenario, conversationId: string): void {
    console.log('');
    console.log(`${c.bold}${c.blue}${'═'.repeat(65)}${c.reset}`);
    console.log(`${c.bold}${c.blue}  ${scenario.name}${c.reset}`);
    console.log(`${c.dim}  ${scenario.description}${c.reset}`);
    console.log(`${c.dim}  tenant: ${scenario.tenantId.slice(0, 8)}...  conversation: ${conversationId.slice(0, 8)}...${c.reset}`);
    console.log(`${c.bold}${c.blue}${'═'.repeat(65)}${c.reset}`);
  }

  private printTurn(
    turnNum: number,
    turn: { message: string; mediaReference?: { mediaId: string; type: string } },
    result: ReplyEngineOutput,
    memory: Record<string, unknown>,
    assertions: AssertionResult[] = [],
  ): void {
    const mediaTag = turn.mediaReference ? ` ${c.magenta}[${turn.mediaReference.type}]${c.reset}` : '';
    console.log('');
    console.log(`${c.cyan}${'─'.repeat(65)}${c.reset}`);
    console.log(`${c.bold}${c.cyan} Turn ${turnNum}: "${turn.message}"${mediaTag}${c.reset}`);
    console.log(`${c.cyan}${'─'.repeat(65)}${c.reset}`);

    // Classification
    if (result.classification) {
      const cl = result.classification;
      console.log('');
      console.log(`  ${c.bold}Classification:${c.reset}`);
      console.log(`    intent:     ${c.cyan}${cl.primaryIntent}${c.reset}`);
      console.log(`    action:     ${cl.recommendedAction}`);
      console.log(`    entities:   ${c.yellow}${JSON.stringify(cl.entities)}${c.reset}`);
      console.log(`    slotAction: ${(cl as any).slotAction ?? '-'}`);
      console.log(`    confidence: ${cl.confidence >= 0.9 ? c.green : cl.confidence >= 0.7 ? c.yellow : c.red}${cl.confidence}${c.reset}`);
    }

    // Reply
    console.log('');
    const isHandoff = result.decision === ReplyDecision.Handoff;
    const decisionColor = isHandoff ? c.red : c.green;
    console.log(`  ${c.bold}Reply Engine:${c.reset}`);
    console.log(`    decision: ${decisionColor}${result.decision}${c.reset}`);
    console.log(`    scenario: ${c.bold}${result.templateScenario ?? '-'}${c.reset}`);

    if (result.reply?.text) {
      const lines = result.reply.text.split('\n');
      console.log(`    reply:    ${c.green}"${lines[0]}"${c.reset}`);
      for (let j = 1; j < lines.length; j++) {
        console.log(`              ${c.green}"${lines[j]}"${c.reset}`);
      }
    }
    if (result.reply?.imageUrls?.length) {
      console.log(`    images:   ${c.dim}${result.reply.imageUrls.length} image(s)${c.reset}`);
    }
    if (result.handoff?.required) {
      console.log(`    ${c.red}handoff:  ${result.handoff.reason}${c.reset}`);
    }

    // State
    console.log('');
    console.log(`  ${c.bold}${c.yellow}State:${c.reset}`);
    const stateFields: [string, unknown][] = [
      ['selectionState', memory.selectionState],
      ['selectedProductId', memory.selectedProductId ? String(memory.selectedProductId).slice(0, 8) + '...' : undefined],
      ['selectedVariantId', memory.selectedVariantId ? String(memory.selectedVariantId).slice(0, 8) + '...' : undefined],
      ['selectedVariantName', memory.selectedVariantName],
      ['cartItems', Array.isArray(memory.cartItems) ? `[${(memory.cartItems as any[]).map((it: any) => `${it.title} (${it.variantName})`).join(', ')}]` : '[]'],
      ['lastAction', memory.lastAction],
      ['preQualifyCollected', memory.preQualifyCollected],
      ['recommendedSize', memory.recommendedSize],
      ['orderCreated', memory.orderCreated],
    ];

    for (const [key, val] of stateFields) {
      if (val !== undefined && val !== null) {
        console.log(`    ${c.yellow}${key.padEnd(22)}${c.reset} ${val}`);
      }
    }

    if (assertions.length > 0) {
      console.log('');
      const failed = assertions.filter(a => !a.pass);
      const passCount = assertions.length - failed.length;
      if (failed.length === 0) {
        console.log(`  ${c.green}✓ Assertions: ${passCount}/${assertions.length} passed${c.reset}`);
      } else {
        console.log(`  ${c.red}✗ Assertions: ${passCount}/${assertions.length} passed${c.reset}`);
        for (const a of failed) {
          const exp = JSON.stringify(a.expected) ?? 'undefined';
          const act = JSON.stringify(a.actual) ?? 'undefined';
          console.log(`    ${c.red}✗ ${a.field}: expected ${exp}, got ${act}${c.reset}`);
        }
      }
    }

    // Trace
    if (result.trace?.length) {
      console.log('');
      console.log(`  ${c.bold}${c.dim}Trace:${c.reset}`);
      for (const t of result.trace) {
        console.log(`    ${c.dim}→ ${t}${c.reset}`);
      }
    }
  }

  private async cleanup(tenantId: string): Promise<void> {
    // Find and delete conversations for the sim customer
    await this.dataSource.query(`
      DELETE FROM messages WHERE conversation_id IN (
        SELECT conv.id FROM conversations conv
        JOIN customers cust ON conv.customer_id = cust.id
        WHERE cust.external_user_id = $1 AND cust.tenant_id = $2
      )
    `, [SIM_CUSTOMER_EXTERNAL_ID, tenantId]);

    await this.dataSource.query(`
      DELETE FROM conversation_state WHERE conversation_id IN (
        SELECT conv.id FROM conversations conv
        JOIN customers cust ON conv.customer_id = cust.id
        WHERE cust.external_user_id = $1 AND cust.tenant_id = $2
      )
    `, [SIM_CUSTOMER_EXTERNAL_ID, tenantId]);

    await this.dataSource.query(`
      DELETE FROM conversations WHERE customer_id IN (
        SELECT id FROM customers WHERE external_user_id = $1 AND tenant_id = $2
      )
    `, [SIM_CUSTOMER_EXTERNAL_ID, tenantId]);

    await this.dataSource.query(`
      DELETE FROM customers WHERE external_user_id = $1 AND tenant_id = $2
    `, [SIM_CUSTOMER_EXTERNAL_ID, tenantId]);
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  // --list: show available scenarios and exit
  if (args.list) {
    console.log(`\n${c.bold}Available scenarios:${c.reset}\n`);
    for (const [key, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${c.cyan}${key.padEnd(25)}${c.reset} ${s.name}`);
      console.log(`  ${' '.repeat(25)} ${c.dim}${s.description}${c.reset}`);
      console.log(`  ${' '.repeat(25)} ${c.dim}tenant: ${s.tenantId.slice(0, 8)}...  turns: ${s.turns.length}${c.reset}`);
      console.log('');
    }
    return;
  }

  // Determine which scenarios to run
  let scenariosToRun: Array<[string, SimulatorScenario]>;

  if (args.all) {
    scenariosToRun = Object.entries(SCENARIOS);
  } else if (args.scenario) {
    const s = SCENARIOS[args.scenario];
    if (!s) {
      console.error(`${c.red}Unknown scenario: "${args.scenario}". Use --list to see available scenarios.${c.reset}`);
      process.exit(1);
    }
    scenariosToRun = [[args.scenario, s]];
  } else {
    // No args — show usage + available scenarios and exit cleanly
    console.log(`Usage: npm run simulate -- --scenario <name> | --all | --list\n`);
    console.log(`${c.bold}Available scenarios:${c.reset}\n`);
    for (const [key, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${c.cyan}${key.padEnd(25)}${c.reset} ${s.name} ${c.dim}(${s.turns.length} turns)${c.reset}`);
    }
    console.log('');
    return;
  }

  // Bootstrap NestJS
  console.log(`${c.dim}Bootstrapping NestJS app...${c.reset}`);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const replyEngine = app.get(ReplyEngineService);
  const conversationsService = app.get(ConversationsService);
  const dataSource = app.get(DataSource);

  const simulator = new ConversationSimulator(replyEngine, conversationsService, dataSource);

  const jsonOutput: Record<string, unknown>[] = [];

  for (const [key, scenario] of scenariosToRun) {
    const turnLogs = await simulator.run(scenario);
    jsonOutput.push({
      scenario: key,
      name: scenario.name,
      tenantId: scenario.tenantId,
      timestamp: new Date().toISOString(),
      turns: turnLogs,
    });
  }

  // Print assertion summary for --all
  if (args.all) {
    let totalAssertions = 0;
    let totalFailed = 0;
    let failingScenarios = 0;
    for (const entry of jsonOutput) {
      const turns = (entry as any).turns as any[];
      let scenarioFailed = false;
      for (const t of turns) {
        if (t.assertions?.length) {
          totalAssertions += t.assertions.length;
          const failed = t.assertions.filter((a: any) => !a.pass).length;
          totalFailed += failed;
          if (failed > 0) scenarioFailed = true;
        }
      }
      if (scenarioFailed) failingScenarios++;
    }
    console.log('');
    console.log(`${c.bold}${'═'.repeat(65)}${c.reset}`);
    console.log(`${c.bold}  Assertion Summary${c.reset}`);
    console.log(`${c.bold}${'═'.repeat(65)}${c.reset}`);
    console.log(`  Total assertions: ${totalAssertions}`);
    console.log(`  ${totalFailed === 0 ? c.green : c.red}Failed: ${totalFailed}${c.reset}`);
    console.log(`  ${failingScenarios === 0 ? c.green : c.red}Failing scenarios: ${failingScenarios}/${jsonOutput.length}${c.reset}`);
  }

  // Save JSON log
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const scenarioLabel = args.all ? 'all' : args.scenario!;
  const logFile = path.join(process.cwd(), `simulator-output-${scenarioLabel}-${timestamp}.json`);
  fs.writeFileSync(logFile, JSON.stringify(jsonOutput, null, 2));
  console.log(`\n${c.dim}Log saved: ${logFile}${c.reset}`);

  await app.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
