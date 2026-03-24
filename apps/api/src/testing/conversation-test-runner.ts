/**
 * E2E Conversation Test Runner
 *
 * Bootstraps the NestJS app, loads YAML scenarios, and executes each conversation
 * against the real reply engine with real DB and real OpenAI API.
 */

import { INestApplicationContext } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import {
  ReplyEngineService,
  ReplyEngineOutput,
} from '../modules/conversations/reply-engine.service';
import { ConversationsService } from '../modules/conversations/conversations.service';
import { ConversationState } from '../modules/conversations/entities/conversation-state.entity';
import { ResponseTemplate } from '../modules/engine/entities/response-template.entity';
import {
  MessageDirection,
  MessageRole,
  ReplyDecision,
} from '@direct-mate/shared';
import { AssistantMemory } from '../modules/engine/classifier.service';

// ─── Types ────────────────────────────────────────────────────────

export interface ScenarioExpectation {
  scenario?: string;
  scenario_in?: string[];
  not_scenario?: string | string[];
  contains?: string | string[];
  contains_any?: string[];
  not_contains?: string | string[];
  memory?: Record<string, unknown>;
  slotAction?: string;
}

export interface ScenarioMessage {
  customer: string;
  expect?: ScenarioExpectation;
}

export interface TestScenario {
  name: string;
  messages: ScenarioMessage[];
}

export interface StepResult {
  stepIndex: number;
  customerMessage: string;
  passed: boolean;
  failures: string[];
  replyText: string | null;
  scenario: string | null;
  decision: string;
  duration: number;
}

export interface ScenarioResult {
  scenarioName: string;
  fileName: string;
  passed: boolean;
  steps: StepResult[];
  totalDuration: number;
  error?: string;
}

// ─── Structured output types (for API / UI) ─────────────────────

export interface StructuredAssertion {
  type: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface StructuredStepResult {
  stepIndex: number;
  customerMessage: string;
  botReply: string | null;
  scenario: string | null;
  templateId: string | null;
  memory: Record<string, unknown>;
  assertions: StructuredAssertion[];
  passed: boolean;
  failReason?: string;
}

export interface StructuredScenarioResult {
  scenarioName: string;
  fileName: string;
  passed: boolean;
  steps: StructuredStepResult[];
  totalDuration: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────

const TEST_TENANT_ID = 'df1ab482-b328-4e8d-9d8c-40f8a426cf66';
const TEST_CUSTOMER_EXTERNAL_ID = 'test-customer-e2e-001';
const TEST_CHANNEL = 'instagram';
const TEST_CHANNEL_ACCOUNT_ID = 'test-channel-e2e';
const LOG_FILE = path.join(process.cwd(), 'conversations.log');

// ─── Runner ───────────────────────────────────────────────────────

export class ConversationTestRunner {
  private replyEngine: ReplyEngineService;
  private conversationsService: ConversationsService;
  private dataSource: DataSource;
  private templateRepo: Repository<ResponseTemplate>;
  private verbose: boolean;

  // Cache template ID -> scenario mapping
  private templateScenarioCache = new Map<string, string>();

  constructor(app: INestApplicationContext, verbose = false) {
    this.replyEngine = app.get(ReplyEngineService);
    this.conversationsService = app.get(ConversationsService);
    this.dataSource = app.get(DataSource);
    this.templateRepo = this.dataSource.getRepository(ResponseTemplate);
    this.verbose = verbose;
  }

  /**
   * Run a single test scenario.
   */
  async runScenario(scenario: TestScenario, fileName: string): Promise<ScenarioResult> {
    const scenarioStart = Date.now();
    const steps: StepResult[] = [];

    try {
      // 1. Clean up test data for this tenant
      await this.cleanupTestData();

      // 2. Create test customer and conversation
      const customer = await this.conversationsService.findOrCreateCustomer(
        TEST_TENANT_ID,
        TEST_CHANNEL,
        TEST_CUSTOMER_EXTERNAL_ID,
      );

      const { conversation, state } =
        await this.conversationsService.findOrCreateConversation(
          TEST_TENANT_ID,
          customer.id,
          TEST_CHANNEL,
          TEST_CHANNEL_ACCOUNT_ID,
        );

      let currentState = state;

      // 3. Process each message in the scenario
      for (let i = 0; i < scenario.messages.length; i++) {
        const msg = scenario.messages[i];
        const stepStart = Date.now();

        // Record log file position before the call
        const logSizeBefore = this.getLogFileSize();

        // 3a. Save inbound message
        await this.conversationsService.saveMessage(
          conversation.id,
          TEST_TENANT_ID,
          MessageDirection.Inbound,
          MessageRole.User,
          msg.customer,
        );

        // 3b. Load recent messages for context
        const fullConversation = await this.conversationsService.findById(conversation.id);
        const recentMessages = fullConversation.messages
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(-10)
          .map((m) => ({ role: m.role, text: m.text }));

        // 3c. Reload current state (may have been updated)
        const freshState = await this.dataSource
          .getRepository(ConversationState)
          .findOne({ where: { conversationId: conversation.id } });
        if (freshState) {
          currentState = freshState;
        }

        // 3d. Call reply engine
        let result: ReplyEngineOutput;
        try {
          result = await this.replyEngine.process({
            tenantId: TEST_TENANT_ID,
            conversationId: conversation.id,
            messageText: msg.customer,
            state: currentState,
            recentMessages,
          });
        } catch (err) {
          const stepResult: StepResult = {
            stepIndex: i,
            customerMessage: msg.customer,
            passed: false,
            failures: [`Reply engine threw: ${(err as Error).message}`],
            replyText: null,
            scenario: null,
            decision: 'error',
            duration: Date.now() - stepStart,
          };
          steps.push(stepResult);
          break;
        }

        // 3e. If reply, save outbound message and update state
        if (result.reply?.text) {
          await this.conversationsService.saveMessage(
            conversation.id,
            TEST_TENANT_ID,
            MessageDirection.Outbound,
            MessageRole.Assistant,
            result.reply.text,
          );
        }

        if (result.stateUpdate) {
          await this.conversationsService.updateState(
            conversation.id,
            result.stateUpdate,
          );
        }

        // 3f. Determine which scenario/template was used
        // Small delay to let async log write complete
        await this.sleep(50);
        const usedScenario = await this.extractScenario(
          result,
          conversation.id,
          logSizeBefore,
        );

        // 3g. Validate expectations
        const failures = msg.expect
          ? this.validateExpectations(msg.expect, result, usedScenario)
          : [];

        const stepResult: StepResult = {
          stepIndex: i,
          customerMessage: msg.customer,
          passed: failures.length === 0,
          failures,
          replyText: result.reply?.text ?? null,
          scenario: usedScenario,
          decision: result.decision,
          duration: Date.now() - stepStart,
        };

        steps.push(stepResult);

        if (this.verbose) {
          this.printStepDetail(i + 1, stepResult);
        }

        // If handoff, no further steps in this conversation
        if (result.decision === ReplyDecision.Handoff) {
          if (i < scenario.messages.length - 1) {
            for (let j = i + 1; j < scenario.messages.length; j++) {
              steps.push({
                stepIndex: j,
                customerMessage: scenario.messages[j].customer,
                passed: false,
                failures: ['Skipped: previous step resulted in handoff'],
                replyText: null,
                scenario: null,
                decision: 'skipped',
                duration: 0,
              });
            }
          }
          break;
        }
      }
    } catch (err) {
      return {
        scenarioName: scenario.name,
        fileName,
        passed: false,
        steps,
        totalDuration: Date.now() - scenarioStart,
        error: `Scenario setup failed: ${(err as Error).message}`,
      };
    }

    const allPassed = steps.every((s) => s.passed);
    return {
      scenarioName: scenario.name,
      fileName,
      passed: allPassed,
      steps,
      totalDuration: Date.now() - scenarioStart,
    };
  }

  /**
   * Run a scenario and return structured results for the API/UI.
   * This is the same logic as runScenario() but captures richer per-step data
   * including individual assertions, memory snapshots, and template IDs.
   */
  async runScenarioStructured(
    scenario: TestScenario,
    fileName: string,
  ): Promise<StructuredScenarioResult> {
    const scenarioStart = Date.now();
    const steps: StructuredStepResult[] = [];

    try {
      await this.cleanupTestData();

      const customer = await this.conversationsService.findOrCreateCustomer(
        TEST_TENANT_ID,
        TEST_CHANNEL,
        TEST_CUSTOMER_EXTERNAL_ID,
      );

      const { conversation, state } =
        await this.conversationsService.findOrCreateConversation(
          TEST_TENANT_ID,
          customer.id,
          TEST_CHANNEL,
          TEST_CHANNEL_ACCOUNT_ID,
        );

      let currentState = state;

      for (let i = 0; i < scenario.messages.length; i++) {
        const msg = scenario.messages[i];
        const logSizeBefore = this.getLogFileSize();

        await this.conversationsService.saveMessage(
          conversation.id,
          TEST_TENANT_ID,
          MessageDirection.Inbound,
          MessageRole.User,
          msg.customer,
        );

        const fullConversation = await this.conversationsService.findById(conversation.id);
        const recentMessages = fullConversation.messages
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(-10)
          .map((m) => ({ role: m.role, text: m.text }));

        const freshState = await this.dataSource
          .getRepository(ConversationState)
          .findOne({ where: { conversationId: conversation.id } });
        if (freshState) currentState = freshState;

        let result: ReplyEngineOutput;
        try {
          result = await this.replyEngine.process({
            tenantId: TEST_TENANT_ID,
            conversationId: conversation.id,
            messageText: msg.customer,
            state: currentState,
            recentMessages,
          });
        } catch (err) {
          steps.push({
            stepIndex: i,
            customerMessage: msg.customer,
            botReply: null,
            scenario: null,
            templateId: null,
            memory: {},
            assertions: [
              {
                type: 'engine_error',
                expected: 'success',
                actual: (err as Error).message,
                passed: false,
              },
            ],
            passed: false,
            failReason: `Reply engine threw: ${(err as Error).message}`,
          });
          break;
        }

        if (result.reply?.text) {
          await this.conversationsService.saveMessage(
            conversation.id,
            TEST_TENANT_ID,
            MessageDirection.Outbound,
            MessageRole.Assistant,
            result.reply.text,
          );
        }

        if (result.stateUpdate) {
          await this.conversationsService.updateState(
            conversation.id,
            result.stateUpdate,
          );
        }

        await this.sleep(50);
        const usedScenario = await this.extractScenario(
          result,
          conversation.id,
          logSizeBefore,
        );

        // Extract template ID from log
        const templateId = await this.extractTemplateIdFromLog(
          conversation.id,
          logSizeBefore,
        );

        // Build memory snapshot
        const memory: Record<string, unknown> =
          result.stateUpdate?.contextJson
            ? { ...(result.stateUpdate.contextJson as Record<string, unknown>) }
            : {};

        // Build structured assertions
        const assertions = msg.expect
          ? this.buildStructuredAssertions(msg.expect, result, usedScenario)
          : [];

        const allAssertionsPassed = assertions.every((a) => a.passed);
        const failedAssertions = assertions.filter((a) => !a.passed);

        steps.push({
          stepIndex: i,
          customerMessage: msg.customer,
          botReply: result.reply?.text ?? null,
          scenario: usedScenario,
          templateId,
          memory,
          assertions,
          passed: allAssertionsPassed,
          failReason: failedAssertions.length > 0
            ? failedAssertions.map((a) =>
                `Expected ${a.type}=${JSON.stringify(a.expected)}, got: ${JSON.stringify(a.actual)}`,
              ).join('; ')
            : undefined,
        });

        if (result.decision === ReplyDecision.Handoff) {
          for (let j = i + 1; j < scenario.messages.length; j++) {
            steps.push({
              stepIndex: j,
              customerMessage: scenario.messages[j].customer,
              botReply: null,
              scenario: null,
              templateId: null,
              memory: {},
              assertions: [],
              passed: false,
              failReason: 'Skipped: previous step resulted in handoff',
            });
          }
          break;
        }
      }
    } catch (err) {
      return {
        scenarioName: scenario.name,
        fileName,
        passed: false,
        steps,
        totalDuration: Date.now() - scenarioStart,
        error: `Scenario setup failed: ${(err as Error).message}`,
      };
    }

    const allPassed = steps.every((s) => s.passed);
    return {
      scenarioName: scenario.name,
      fileName,
      passed: allPassed,
      steps,
      totalDuration: Date.now() - scenarioStart,
    };
  }

  /**
   * Build individual assertion objects from expectations.
   */
  private buildStructuredAssertions(
    expect: ScenarioExpectation,
    result: ReplyEngineOutput,
    usedScenario: string | null,
  ): StructuredAssertion[] {
    const assertions: StructuredAssertion[] = [];
    const replyText = result.reply?.text ?? '';

    if (expect.scenario) {
      assertions.push({
        type: 'scenario',
        expected: expect.scenario,
        actual: usedScenario,
        passed: usedScenario === expect.scenario,
      });
    }

    if (expect.scenario_in) {
      assertions.push({
        type: 'scenario_in',
        expected: expect.scenario_in,
        actual: usedScenario,
        passed: !!usedScenario && expect.scenario_in.includes(usedScenario),
      });
    }

    if (expect.not_scenario) {
      const blocked = Array.isArray(expect.not_scenario)
        ? expect.not_scenario
        : [expect.not_scenario];
      assertions.push({
        type: 'not_scenario',
        expected: blocked,
        actual: usedScenario,
        passed: !usedScenario || !blocked.includes(usedScenario),
      });
    }

    if (expect.contains) {
      const required = Array.isArray(expect.contains)
        ? expect.contains
        : [expect.contains];
      for (const needle of required) {
        const found = replyText.toLowerCase().includes(needle.toLowerCase());
        assertions.push({
          type: 'contains',
          expected: needle,
          actual: found,
          passed: found,
        });
      }
    }

    if (expect.contains_any) {
      const found = expect.contains_any.some((needle) =>
        replyText.toLowerCase().includes(needle.toLowerCase()),
      );
      assertions.push({
        type: 'contains_any',
        expected: expect.contains_any,
        actual: found,
        passed: found,
      });
    }

    if (expect.not_contains) {
      const forbidden = Array.isArray(expect.not_contains)
        ? expect.not_contains
        : [expect.not_contains];
      for (const needle of forbidden) {
        const found = replyText.toLowerCase().includes(needle.toLowerCase());
        assertions.push({
          type: 'not_contains',
          expected: needle,
          actual: !found,
          passed: !found,
        });
      }
    }

    if (expect.memory && result.stateUpdate?.contextJson) {
      const memory = result.stateUpdate.contextJson as Record<string, unknown>;
      for (const [key, expectedValue] of Object.entries(expect.memory)) {
        const actualValue = memory[key];
        assertions.push({
          type: `memory.${key}`,
          expected: expectedValue,
          actual: actualValue,
          passed: actualValue === expectedValue,
        });
      }
    }

    return assertions;
  }

  /**
   * Extract the templateId from the conversations.log for a given conversation.
   */
  private async extractTemplateIdFromLog(
    conversationId: string,
    sizeBefore: number,
  ): Promise<string | null> {
    try {
      if (!fs.existsSync(LOG_FILE)) return null;
      const stat = fs.statSync(LOG_FILE);
      if (stat.size <= sizeBefore) return null;

      const fd = fs.openSync(LOG_FILE, 'r');
      const newBytes = stat.size - sizeBefore;
      const buffer = Buffer.alloc(newBytes);
      fs.readSync(fd, buffer, 0, newBytes, sizeBefore);
      fs.closeSync(fd);

      const lines = buffer.toString('utf-8').split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (
            entry.event === 'reply' &&
            entry.conversationId === conversationId &&
            entry.templateId
          ) {
            return entry.templateId;
          }
        } catch {
          // skip malformed
        }
      }
    } catch {
      // fall through
    }
    return null;
  }

  // ─── Scenario Extraction ──────────────────────────────────────────

  /**
   * Extract the scenario from:
   * 1. The conversations.log (most reliable — has templateId)
   * 2. Reverse-mapped from memory.lastAction (fallback)
   */
  private async extractScenario(
    result: ReplyEngineOutput,
    conversationId: string,
    logSizeBefore: number,
  ): Promise<string | null> {
    if (result.decision === ReplyDecision.Handoff) {
      return 'handoff';
    }

    // Strategy 1: Parse the log file for the template ID written during this call
    const logScenario = await this.extractScenarioFromLog(conversationId, logSizeBefore);
    if (logScenario) return logScenario;

    // Strategy 2: Reverse-map from memory.lastAction
    return this.extractScenarioFromMemory(result);
  }

  /**
   * Read new lines appended to conversations.log since `sizeBefore` and
   * find the reply event for this conversation to get the templateId,
   * then look up the template's scenario.
   */
  private async extractScenarioFromLog(
    conversationId: string,
    sizeBefore: number,
  ): Promise<string | null> {
    try {
      if (!fs.existsSync(LOG_FILE)) return null;

      const stat = fs.statSync(LOG_FILE);
      if (stat.size <= sizeBefore) return null;

      // Read only the new bytes
      const fd = fs.openSync(LOG_FILE, 'r');
      const newBytes = stat.size - sizeBefore;
      const buffer = Buffer.alloc(newBytes);
      fs.readSync(fd, buffer, 0, newBytes, sizeBefore);
      fs.closeSync(fd);

      const newContent = buffer.toString('utf-8');
      const lines = newContent.split('\n').filter((l) => l.trim());

      // Find the reply event for this conversation
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (
            entry.event === 'reply' &&
            entry.conversationId === conversationId &&
            entry.templateId
          ) {
            if (entry.templateId === 'ai_fallback') {
              return 'ai_fallback';
            }
            // Use templateScenario from log if available (works for FAQ items too)
            if (entry.templateScenario && entry.templateScenario !== 'ai_fallback') {
              return entry.templateScenario;
            }
            // Look up the template to get its scenario
            return await this.getTemplateScenario(entry.templateId);
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Log file reading failed, fall through to memory-based extraction
    }

    return null;
  }

  /**
   * Look up a template's scenario by ID (with caching).
   */
  private async getTemplateScenario(templateId: string): Promise<string | null> {
    const cached = this.templateScenarioCache.get(templateId);
    if (cached) return cached;

    try {
      const template = await this.templateRepo.findOne({
        where: { id: templateId },
        select: ['id', 'scenario'],
      });
      if (template) {
        this.templateScenarioCache.set(templateId, template.scenario);
        return template.scenario;
      }
    } catch {
      // Template lookup failed
    }
    return null;
  }

  /**
   * Fallback: reverse-map scenario from the memory's lastAction field.
   */
  private extractScenarioFromMemory(result: ReplyEngineOutput): string | null {
    if (!result.stateUpdate?.contextJson) return null;

    const memory = result.stateUpdate.contextJson as AssistantMemory;
    const lastAction = memory.lastAction;

    // Reverse map from lastAction -> scenario
    const actionToScenario: Record<string, string> = {
      greeted: 'greeting',
      presented_product_options: 'show_products',
      showed_price: 'show_price',
      gave_recommendation: 'recommend_product',
      confirmed_product: 'confirm_selection',
      asked_delivery_details: 'collect_checkout_info',
      confirmed_order: 'confirm_order',
      asked_variant: 'ask_variant_choice',
      answered_faq: 'answer_faq',
      asked_clarification: 'ai_fallback',
    };

    // Disambiguate FAQ sub-types via reply text content
    if (lastAction === 'answered_faq' && result.reply?.text) {
      const text = result.reply.text.toLowerCase();
      if (text.includes('доставк') || text.includes('нова пошт') || text.includes('відправ')) {
        return 'answer_delivery';
      }
      if (text.includes('оплат') || text.includes('передоплат')) {
        return 'answer_payment';
      }
    }

    // Disambiguate checkout scenarios
    if (lastAction === 'asked_delivery_details') {
      if (memory.selectionState === 'confirmed') {
        return 'order_confirmed_ask_delivery';
      }
      return 'collect_checkout_info';
    }

    // Disambiguate recommendation from shown vs regular
    if (lastAction === 'gave_recommendation' && memory.lastPresentedProducts?.length) {
      return 'ask_recommendation_from_shown';
    }

    return actionToScenario[lastAction ?? ''] ?? lastAction ?? null;
  }

  // ─── Validation ───────────────────────────────────────────────────

  /**
   * Validate all expectations for a step.
   */
  private validateExpectations(
    expect: ScenarioExpectation,
    result: ReplyEngineOutput,
    usedScenario: string | null,
  ): string[] {
    const failures: string[] = [];
    const replyText = result.reply?.text ?? '';

    // scenario -- exact match
    if (expect.scenario) {
      if (usedScenario !== expect.scenario) {
        failures.push(
          `Expected scenario: "${expect.scenario}", got: "${usedScenario}"`,
        );
      }
    }

    // scenario_in -- one of
    if (expect.scenario_in) {
      if (!usedScenario || !expect.scenario_in.includes(usedScenario)) {
        failures.push(
          `Expected scenario in: [${expect.scenario_in.join(', ')}], got: "${usedScenario}"`,
        );
      }
    }

    // not_scenario -- must not be
    if (expect.not_scenario) {
      const blocked = Array.isArray(expect.not_scenario)
        ? expect.not_scenario
        : [expect.not_scenario];
      if (usedScenario && blocked.includes(usedScenario)) {
        failures.push(
          `Scenario must NOT be: [${blocked.join(', ')}], but got: "${usedScenario}"`,
        );
      }
    }

    // contains -- reply text must contain all
    if (expect.contains) {
      const required = Array.isArray(expect.contains)
        ? expect.contains
        : [expect.contains];
      for (const needle of required) {
        if (!replyText.toLowerCase().includes(needle.toLowerCase())) {
          failures.push(
            `Reply must contain "${needle}", but reply was: "${this.truncate(replyText, 120)}"`,
          );
        }
      }
    }

    // contains_any -- reply text must contain at least one
    if (expect.contains_any) {
      const found = expect.contains_any.some((needle) =>
        replyText.toLowerCase().includes(needle.toLowerCase()),
      );
      if (!found) {
        failures.push(
          `Reply must contain one of: [${expect.contains_any.join(', ')}], but reply was: "${this.truncate(replyText, 120)}"`,
        );
      }
    }

    // not_contains -- reply text must NOT contain
    if (expect.not_contains) {
      const forbidden = Array.isArray(expect.not_contains)
        ? expect.not_contains
        : [expect.not_contains];
      for (const needle of forbidden) {
        if (replyText.toLowerCase().includes(needle.toLowerCase())) {
          failures.push(
            `Reply must NOT contain "${needle}", but reply was: "${this.truncate(replyText, 120)}"`,
          );
        }
      }
    }

    // memory -- check specific fields in the updated state
    if (expect.memory && result.stateUpdate?.contextJson) {
      const memory = result.stateUpdate.contextJson as Record<string, unknown>;
      for (const [key, expectedValue] of Object.entries(expect.memory)) {
        const actualValue = memory[key];
        if (actualValue !== expectedValue) {
          failures.push(
            `Expected memory.${key} = "${expectedValue}", got: "${actualValue}"`,
          );
        }
      }
    }

    // slotAction -- check classifier's slot action (from log, if available)
    // Note: not directly available from result; primarily validated via scenario/memory checks

    return failures;
  }

  // ─── Output helpers ───────────────────────────────────────────────

  /**
   * Print detailed step result for verbose mode.
   */
  private printStepDetail(stepNum: number, step: StepResult): void {
    const status = step.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(
      `    Step ${stepNum}: [${status}] "${this.truncate(step.customerMessage, 50)}"`,
    );
    console.log(
      `      -> scenario=${step.scenario} decision=${step.decision} (${step.duration}ms)`,
    );
    if (step.replyText) {
      console.log(
        `      -> reply: "${this.truncate(step.replyText, 100)}"`,
      );
    }
    if (step.failures.length > 0) {
      for (const f of step.failures) {
        console.log(`      \x1b[31m!! ${f}\x1b[0m`);
      }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────

  /**
   * Clean up all test conversation data for the test tenant.
   * Does NOT delete products, templates, or store config.
   */
  private async cleanupTestData(): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query(
        `DELETE FROM audit_logs WHERE tenant_id = $1`,
        [TEST_TENANT_ID],
      );
      await qr.query(
        `DELETE FROM messages WHERE tenant_id = $1`,
        [TEST_TENANT_ID],
      );
      await qr.query(
        `DELETE FROM conversation_state WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = $1)`,
        [TEST_TENANT_ID],
      );
      await qr.query(
        `DELETE FROM conversations WHERE tenant_id = $1`,
        [TEST_TENANT_ID],
      );
      await qr.query(
        `DELETE FROM customers WHERE tenant_id = $1 AND external_user_id = $2`,
        [TEST_TENANT_ID, TEST_CUSTOMER_EXTERNAL_ID],
      );
    } finally {
      await qr.release();
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────

  private getLogFileSize(): number {
    try {
      if (!fs.existsSync(LOG_FILE)) return 0;
      return fs.statSync(LOG_FILE).size;
    } catch {
      return 0;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private truncate(s: string, len: number): string {
    if (!s) return '';
    const single = s.replace(/\n/g, ' ');
    return single.length > len ? single.slice(0, len) + '...' : single;
  }
}
