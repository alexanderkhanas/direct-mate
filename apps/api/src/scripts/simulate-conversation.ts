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
  tenant: string | null;
  message: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    scenario: null,
    list: false,
    all: false,
    tenant: null,
    message: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      result.scenario = args[i + 1];
      i++;
    } else if (args[i] === '--list') {
      result.list = true;
    } else if (args[i] === '--all') {
      result.all = true;
    } else if (args[i] === '--tenant' && args[i + 1]) {
      result.tenant = args[i + 1];
      i++;
    } else if (args[i] === '--message' && args[i + 1]) {
      result.message = args[i + 1];
      i++;
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
  extraReplies: Array<{ text: string; imageUrls?: string[] }> | null;
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
  // Check across primary reply AND extraReplies — the AI-introduction
  // welcome promotes itself to primary and demotes contextual reply to
  // extraReplies[0]. Substring assertions should pass when the target
  // text is anywhere in the user-visible bubble stack.
  const allReplyTexts = [
    result.reply?.text ?? '',
    ...(result.extraReplies ?? []).map((r) => r.text ?? ''),
  ]
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  const anyReplyIncludes = (sub: string) =>
    allReplyTexts.some((t) => t.includes(sub.toLowerCase()));
  const previewReplies = () =>
    allReplyTexts.map((t) => t.slice(0, 80)).join(' ‖ ');
  for (const sub of arr(expect.replyContains)) {
    push('replyContains', anyReplyIncludes(sub), sub, previewReplies());
  }
  for (const sub of arr(expect.replyNotContains)) {
    push('replyNotContains', !anyReplyIncludes(sub), `NOT ${sub}`, previewReplies());
  }
  if (expect.imageCount !== undefined) {
    const actual = result.reply?.imageUrls?.length ?? 0;
    push('imageCount', actual === expect.imageCount, expect.imageCount, actual);
  }
  if (expect.extraReplyCount !== undefined) {
    const actual = result.extraReplies?.length ?? 0;
    push('extraReplyCount', actual === expect.extraReplyCount, expect.extraReplyCount, actual);
  }
  if (expect.extraReplyImageContains !== undefined) {
    const sub = expect.extraReplyImageContains.toLowerCase();
    const allUrls = (result.extraReplies ?? []).flatMap((r) => r.imageUrls ?? []);
    const found = allUrls.some((u) => u.toLowerCase().includes(sub));
    push(
      'extraReplyImageContains',
      found,
      sub,
      allUrls.length ? allUrls : '(no extra image urls)',
    );
  }

  if (expect.state) {
    const s = expect.state;
    if (s.selectionState !== undefined) push('state.selectionState', memory.selectionState === s.selectionState, s.selectionState, memory.selectionState);
    if (s.selectedProductId !== undefined) {
      if (s.selectedProductId === null) push('state.selectedProductId', !memory.selectedProductId, null, memory.selectedProductId);
      else push('state.selectedProductId', memory.selectedProductId === s.selectedProductId, s.selectedProductId, memory.selectedProductId);
    }
    if (s.selectedVariantName !== undefined) push('state.selectedVariantName', memory.selectedVariantName === s.selectedVariantName, s.selectedVariantName, memory.selectedVariantName);
    if (s.selectedColor !== undefined) push('state.selectedColor', memory.selectedColor === s.selectedColor, s.selectedColor, memory.selectedColor);
    if (s.selectedSize !== undefined) push('state.selectedSize', memory.selectedSize === s.selectedSize, s.selectedSize, memory.selectedSize);
    if (s.variantStep !== undefined) {
      if (s.variantStep === null) push('state.variantStep', !memory.variantStep, null, memory.variantStep);
      else push('state.variantStep', memory.variantStep === s.variantStep, s.variantStep, memory.variantStep);
    }
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
    if (s.recommendedSkinType !== undefined) push('state.recommendedSkinType', memory.recommendedSkinType === s.recommendedSkinType, s.recommendedSkinType, memory.recommendedSkinType);
    if (s.shouldOfferSizeHelp !== undefined) push('state.shouldOfferSizeHelp', !!memory.shouldOfferSizeHelp === s.shouldOfferSizeHelp, s.shouldOfferSizeHelp, !!memory.shouldOfferSizeHelp);
    if (s.awaitingPreQualifyAnswer !== undefined) push('state.awaitingPreQualifyAnswer', !!memory.awaitingPreQualifyAnswer === s.awaitingPreQualifyAnswer, s.awaitingPreQualifyAnswer, !!memory.awaitingPreQualifyAnswer);
    if (s.orderCreated !== undefined) push('state.orderCreated', memory.orderCreated === s.orderCreated, s.orderCreated, memory.orderCreated);
  }

  return out;
}

// ─── Simulator ───────────────────────────────────────────────────

/**
 * A scenario's tenant doesn't exist in THIS environment. Some tenants
 * live only on prod (`men-demo-store`, `showcase-women-clothes`), so a
 * local `--all` run must skip them rather than abort the whole suite.
 * A `--scenario <name>` run still fails loudly — you asked for that one
 * specifically.
 */
class TenantNotFoundError extends Error {
  constructor(readonly tenantIdOrSlug: string) {
    super(`Scenario tenantId/slug "${tenantIdOrSlug}" not found in tenants table`);
    this.name = 'TenantNotFoundError';
  }
}

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
    // Resolve `tenantId` if it's a slug instead of a UUID. Slug form lets
    // vertical scenarios (cosmetics) avoid hardcoding env-specific UUIDs.
    // Shadow the param so all downstream refs to `scenario.tenantId` use
    // the resolved value without further renaming.
    const resolvedTenantId = await this.resolveTenantId(scenario.tenantId);
    scenario = { ...scenario, tenantId: resolvedTenantId };

    const turnLogs: TurnLog[] = [];

    // Clean up previous sim data for this tenant
    await this.cleanup(scenario.tenantId);

    // Apply flowConfigOverride if present; restore in finally so a thrown
    // assertion still reverts the temporary config change.
    const restoreFlowConfig = await this.applyFlowConfigOverride(scenario);

    try {
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

      // Normalize turn.message to array so we can simulate Instagram's
      // 5-second debounce window that merges multiple messages into one
      // engine call. Production code: instagram.service.ts flushPending().
      const inboundMessages = Array.isArray(turn.message) ? turn.message : [turn.message];
      const combinedText = inboundMessages.join('\n');

      // Resolve customer_photo URL at runtime to a fresh linked media_url
      // so vision matching compares the same image against itself. Mirrors
      // simulator.service.ts so CLI + API simulators behave identically.
      let mediaReference = turn.mediaReference;
      if ((turn as any).resolveMediaFromLinkedProduct && mediaReference?.type === 'customer_photo') {
        const rows: Array<{ media_url: string }> = await this.dataSource.query(
          `SELECT media_url FROM instagram_media_mappings
           WHERE tenant_id = $1 AND product_id IS NOT NULL AND media_url IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [scenario.tenantId],
        );
        if (rows[0]?.media_url) {
          mediaReference = { ...mediaReference, mediaId: rows[0].media_url };
        }
      }

      // Save each inbound message row separately (matches production)
      for (const msg of inboundMessages) {
        await this.conversationsService.saveMessage(
          conversation.id,
          scenario.tenantId,
          MessageDirection.Inbound,
          MessageRole.User,
          msg,
        );
      }

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
          messageText: combinedText,
          state: freshState,
          recentMessages,
          mediaReference,
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

      // Print turn (collapsed message for display)
      this.printTurn(
        i + 1,
        { message: combinedText, mediaReference },
        result,
        memory,
        assertions,
      );

      // Build log entry
      turnLogs.push({
        turnIndex: i,
        message: combinedText,
        mediaReference,
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
        extraReplies: result.extraReplies ?? null,
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
    } finally {
      await restoreFlowConfig();
    }
  }

  /**
   * If `tenantId` is already a UUID, return as-is. Otherwise treat it as a
   * tenant slug and look up the UUID. Throws if the slug resolves to nothing.
   */
  private async resolveTenantId(tenantIdOrSlug: string): Promise<string> {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(tenantIdOrSlug)) return tenantIdOrSlug;
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [tenantIdOrSlug],
    );
    if (rows.length === 0) {
      throw new TenantNotFoundError(tenantIdOrSlug);
    }
    return rows[0].id;
  }

  /**
   * Apply scenario.flowConfigOverride as a shallow merge onto the tenant's
   * current store_configs.flow_config. Returns a function that restores the
   * original value. Both apply and restore are no-ops when override is unset.
   */
  private async applyFlowConfigOverride(
    scenario: SimulatorScenario,
  ): Promise<() => Promise<void>> {
    if (!scenario.flowConfigOverride) {
      return async () => {};
    }
    const rows: Array<{ flow_config: Record<string, unknown> | null }> =
      await this.dataSource.query(
        `SELECT flow_config FROM store_configs WHERE tenant_id = $1 LIMIT 1`,
        [scenario.tenantId],
      );
    const original = rows[0]?.flow_config ?? {};
    const merged = { ...original, ...scenario.flowConfigOverride };
    await this.dataSource.query(
      `UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`,
      [JSON.stringify(merged), scenario.tenantId],
    );
    return async () => {
      await this.dataSource.query(
        `UPDATE store_configs SET flow_config = $1 WHERE tenant_id = $2`,
        [JSON.stringify(original), scenario.tenantId],
      );
    };
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

  // --tenant + --message: ad-hoc one-turn scenario against a tenant by slug.
  // Requires DB lookup, so we resolve the slug against the running DataSource below.
  // --tenant alone (no --message): filter the registry to scenarios pinned to that tenant slug/UUID.
  let adHocFromTenantMessage: { slug: string; message: string } | null = null;
  if (args.message && !args.tenant) {
    console.error(`${c.red}--message requires --tenant.${c.reset}`);
    process.exit(1);
  }
  if (args.tenant && args.message) {
    adHocFromTenantMessage = { slug: args.tenant, message: args.message };
  }

  if (args.all) {
    scenariosToRun = Object.entries(SCENARIOS);
  } else if (args.scenario) {
    const s = SCENARIOS[args.scenario];
    if (!s) {
      console.error(`${c.red}Unknown scenario: "${args.scenario}". Use --list to see available scenarios.${c.reset}`);
      process.exit(1);
    }
    scenariosToRun = [[args.scenario, s]];
  } else if (adHocFromTenantMessage) {
    scenariosToRun = [];  // filled after DataSource boots
  } else if (args.tenant) {
    // --tenant alone: run all registry scenarios whose tenantId matches.
    // Match against the literal tenantId string (slug or UUID) — scenarios authored
    // with DEMO_WOMEN_CLOTHES_SLUG / DEMO_COSMETICS_SLUG resolve at boot time, but
    // the registry stores the slug literal, so direct equality works for slug-form.
    scenariosToRun = Object.entries(SCENARIOS).filter(
      ([, s]) => s.tenantId === args.tenant,
    );
    if (scenariosToRun.length === 0) {
      console.error(`${c.red}No scenarios found for tenant="${args.tenant}". Pass --message to run an ad-hoc message instead, or --list to see registered scenarios.${c.reset}`);
      process.exit(1);
    }
    console.log(`${c.dim}Tenant filter: ${args.tenant} → ${scenariosToRun.length} scenario(s)${c.reset}`);
  } else {
    // No args — show usage + available scenarios and exit cleanly
    console.log(`Usage: npm run simulate -- --scenario <name> | --all | --list | --tenant <slug> [--message <text>]\n`);
    console.log(`  --tenant <slug>           Run all scenarios pinned to that tenant`);
    console.log(`  --tenant <slug> --message Run an ad-hoc one-turn message against that tenant\n`);
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

  // Resolve ad-hoc --tenant/--message into a one-turn scenario now that the DB is up.
  if (adHocFromTenantMessage) {
    const { slug, message } = adHocFromTenantMessage;
    const rows = await dataSource.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (rows.length === 0) {
      console.error(`${c.red}Tenant not found: slug="${slug}"${c.reset}`);
      await app.close();
      process.exit(1);
    }
    const adHoc: SimulatorScenario = {
      name: `ad-hoc (${slug})`,
      description: `one-turn message: "${message}"`,
      tenantId: rows[0].id,
      turns: [{ message }],
    };
    scenariosToRun = [['__ad_hoc__', adHoc]];
  }

  const jsonOutput: Record<string, unknown>[] = [];

  const skippedForMissingTenant: string[] = [];

  for (const [key, scenario] of scenariosToRun) {
    let turnLogs;
    try {
      turnLogs = await simulator.run(scenario);
    } catch (err) {
      // Prod-only tenants aren't seeded locally. Skip them in a batch run
      // instead of aborting the suite; every other error still propagates.
      if (err instanceof TenantNotFoundError && args.all) {
        skippedForMissingTenant.push(`${key} (${scenario.tenantId})`);
        continue;
      }
      throw err;
    }
    jsonOutput.push({
      scenario: key,
      name: scenario.name,
      tenantId: scenario.tenantId,
      flaky: scenario.flaky === true,
      timestamp: new Date().toISOString(),
      turns: turnLogs,
    });
  }

  // Never let a skip read as a pass.
  if (skippedForMissingTenant.length > 0) {
    console.log(
      `\n${c.yellow}Skipped ${skippedForMissingTenant.length} scenario(s) — tenant not in this environment:${c.reset}`,
    );
    for (const s of skippedForMissingTenant) console.log(`  ${c.dim}${s}${c.reset}`);
  }

  // Print assertion summary for --all. Flaky scenarios contribute to a
  // separate counter and DO NOT cause non-zero exit — they're best-effort
  // tests of LLM-extraction robustness, not engine-flow correctness.
  let gatingFailingScenarios = 0;
  if (args.all) {
    let totalAssertions = 0;
    let gatingFailed = 0;
    let flakyFailed = 0;
    let flakyFailingScenarios = 0;
    for (const entry of jsonOutput) {
      const turns = (entry as any).turns as any[];
      const isFlaky = (entry as any).flaky === true;
      let scenarioFailed = false;
      for (const t of turns) {
        if (t.assertions?.length) {
          totalAssertions += t.assertions.length;
          const failed = t.assertions.filter((a: any) => !a.pass).length;
          if (isFlaky) flakyFailed += failed;
          else gatingFailed += failed;
          if (failed > 0) scenarioFailed = true;
        }
      }
      if (scenarioFailed) {
        if (isFlaky) flakyFailingScenarios++;
        else gatingFailingScenarios++;
      }
    }
    console.log('');
    console.log(`${c.bold}${'═'.repeat(65)}${c.reset}`);
    console.log(`${c.bold}  Assertion Summary${c.reset}`);
    console.log(`${c.bold}${'═'.repeat(65)}${c.reset}`);
    console.log(`  Total assertions: ${totalAssertions}`);
    console.log(`  ${gatingFailed === 0 ? c.green : c.red}Failed (gating): ${gatingFailed}${c.reset}`);
    console.log(`  ${c.dim}Failed (flaky, non-gating): ${flakyFailed}${c.reset}`);
    console.log(`  ${gatingFailingScenarios === 0 ? c.green : c.red}Failing scenarios (gating): ${gatingFailingScenarios}/${jsonOutput.length}${c.reset}`);
    console.log(`  ${c.dim}Failing scenarios (flaky): ${flakyFailingScenarios}/${jsonOutput.length}${c.reset}`);
  }

  // Save JSON log
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const scenarioLabel = args.all ? 'all' : args.scenario!;
  const logFile = path.join(process.cwd(), `simulator-output-${scenarioLabel}-${timestamp}.json`);
  fs.writeFileSync(logFile, JSON.stringify(jsonOutput, null, 2));
  console.log(`\n${c.dim}Log saved: ${logFile}${c.reset}`);

  await app.close();

  // Non-zero exit ONLY on gating failures (flaky scenarios are warnings).
  if (gatingFailingScenarios > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
