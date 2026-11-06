import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APICallError, hasToolCall, isStepCount, RetryError, ToolLoopAgent, type ModelMessage } from 'ai';
import { CustomerMediaService, LoadedImage } from '../customer-media/customer-media.service';
import { OrderDraftService } from '../orders/order-draft.service';
import { SizeChartsService } from '../size-charts/size-charts.service';
import { CatalogReader } from './catalog/catalog-reader.service';
import { CATALOG_SEARCH, CatalogSearch } from './catalog/catalog-search';
import { CatalogIndexService } from './catalog/catalog-index.service';
import { checkGrounding } from './guards/grounding.guard';
import { checkStyle } from './guards/style.guard';
import { AgentModelFactory } from './model.factory';
import { buildSystemPrompt } from './prompt/system-prompt';
import { buildTurnContext } from './prompt/turn-context';
import { AgentStoreSettingsService } from './store-settings.service';
import { AgentToolDeps, buildAgentTools, HANDOFF_TOOL } from './tools';
import { draftForModel } from './tools/order.tools';
import { collectEffects, collectTurnFacts } from './turn-facts';
import type {
  AgentHandoff,
  AgentHistoryEntry,
  AgentStepRecord,
  AgentTurnInput,
  AgentTurnResult,
  AgentUsage,
  AttemptReport,
  StagedEffect,
} from './agent.types';

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_TIMEOUT_MS = 45_000;
const PHOTO_UNAVAILABLE = "(a photo from this message couldn't be opened; ask them to send it again if you need it)";

interface Outcome {
  reply: string | null;
  effects: StagedEffect[];
  handoff: AgentHandoff | null;
}

/**
 * One customer turn: the model reads the conversation, calls tools, and
 * writes a reply that has to pass the grounding and style guards.
 *
 * - Both guards pass → the reply and its staged effects go back to the caller.
 * - A guard fails → one retry, with the exact problems fed back.
 * - Still ungrounded → handoff with no text: an invented price or size is
 *   never sent. Still only a style slip → sent, and flagged in `attempts`.
 * - The model hands off, writes nothing, hits the step cap, errors or times
 *   out → handoff. This method doesn't throw; the caller announces handoffs.
 *
 * Customer photos in the history go to the model as images. If the provider
 * refuses one, the attempt re-runs without them and the model is told the
 * photo couldn't be opened, so it asks for it again instead of handing off.
 *
 * It never sends, writes conversation state or touches Instagram — that is the
 * turn runner's job (Phase 3). Its only writes are the order draft, through
 * `update_order_draft`.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly toolDeps: AgentToolDeps;

  constructor(
    private readonly config: ConfigService,
    private readonly models: AgentModelFactory,
    private readonly storeSettings: AgentStoreSettingsService,
    private readonly catalogIndex: CatalogIndexService,
    catalog: CatalogReader,
    @Inject(CATALOG_SEARCH) search: CatalogSearch,
    sizeCharts: SizeChartsService,
    private readonly drafts: OrderDraftService,
    private readonly media: CustomerMediaService,
  ) {
    this.toolDeps = { catalog, search, sizeCharts, drafts };
  }

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const started = Date.now();
    const steps: AgentStepRecord[] = [];
    const attempts: AttemptReport[] = [];
    const usage: AgentUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    let modelId = 'unresolved';
    let images: AgentTurnResult['images'];
    const result = (outcome: Outcome, error?: string): AgentTurnResult => ({
      ...outcome,
      attempts,
      steps,
      model: modelId,
      usage,
      ...(images && { images }),
      durationMs: Date.now() - started,
      ...(error && { error }),
    });

    try {
      const settings = await this.storeSettings.load(input.tenantId);
      const resolved = this.models.resolve({ turn: input.modelOverride, store: settings.modelOverride });
      modelId = resolved.modelId;

      const scope = {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        customerId: input.customerId,
      };
      const [index, draft, photos] = await Promise.all([
        this.catalogIndex.get(input.tenantId),
        this.drafts.getCurrentDraft(scope, settings.checkoutFields),
        this.loadPhotos(input.history),
      ]);

      const agent = new ToolLoopAgent({
        model: resolved.model,
        instructions: buildSystemPrompt(settings, index.text),
        tools: buildAgentTools(this.toolDeps, scope, settings),
        stopWhen: [isStepCount(this.maxSteps()), hasToolCall(HANDOFF_TOOL)],
        allowSystemInMessages: true,
        providerOptions: resolved.providerOptions,
        ...(resolved.temperature != null && { temperature: resolved.temperature }),
      });

      const turnContext = buildTurnContext({
        now: input.now ?? new Date(),
        timezone: settings.timezone,
        draft,
        notes: input.notes ?? [],
      });
      const withPhotos = (loaded: Map<string, LoadedImage | null>): ModelMessage[] => [
        ...toModelMessages(input.history, loaded),
        { role: 'system', content: turnContext },
      ];
      let messages = withPhotos(photos);
      const loadedCount = [...photos.values()].filter(Boolean).length;
      images = photos.size > 0 ? { inContext: loadedCount, unavailable: photos.size - loadedCount, rejected: false } : undefined;

      const customerText = trailingCustomerText(input.history);
      // The draft in the turn context was read fresh from the DB, so its
      // prices count as facts alongside this turn's tool results.
      const draftFacts = draftForModel(draft);
      const placedBeforeTurn = draftFacts?.status === 'placed';
      const check = (text: string): AttemptReport => {
        const facts = collectTurnFacts(steps, [draftFacts]);
        const placingNow = collectEffects(steps).effects.some((e) => e.type === 'place_order');
        const draftUpdated = steps.some((s) =>
          s.toolResults.some((r) => r.toolName === 'update_order_draft' && (r.output as { ok?: boolean })?.ok === true),
        );
        return {
          text,
          grounding: checkGrounding(text, facts, {
            customerText,
            knowledgeDoc: settings.knowledgeDoc,
            catalogTitles: index.titles,
            orderPlaced: placedBeforeTurn || placingNow,
            draftUpdated,
          }),
          style: checkStyle(text, { disallowedPhrases: settings.disallowedPhrases }),
        };
      };
      const timeout = { totalMs: this.timeoutMs() };
      const generate = async (after: ModelMessage[] = []) => {
        try {
          return await agent.generate({ messages: [...messages, ...after], timeout });
        } catch (err) {
          if (!images || images.inContext === 0 || images.rejected || !isRequestRejection(err)) throw err;
          this.logger.warn(
            `Provider refused the request with ${images.inContext} customer photo(s) in conversation ` +
              `${input.conversationId}; running the turn without them: ${err instanceof Error ? err.message : err}`,
          );
          images = { inContext: 0, unavailable: photos.size, rejected: true };
          messages = withPhotos(new Map([...photos.keys()].map((url) => [url, null])));
          return agent.generate({ messages: [...messages, ...after], timeout });
        }
      };

      const first = await generate();
      this.record(first, 1, steps, usage);
      const firstOutcome = this.evaluate(first, steps, check, attempts, false);
      if (firstOutcome) return result(firstOutcome);

      const second = await generate([
        ...first.responseMessages,
        { role: 'system', content: correctionMessage(attempts[0]) },
      ]);
      this.record(second, 2, steps, usage);
      return result(this.evaluate(second, steps, check, attempts, true)!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent turn failed for conversation ${input.conversationId}: ${message}`);
      return result({ reply: null, effects: [], handoff: { reason: 'agent_error', summaryForManager: null } }, message);
    }
  }

  /** The turn's outcome, or null when the attempt failed a guard and may be retried. */
  private evaluate(
    attempt: { text: string; finishReason: string },
    steps: AgentStepRecord[],
    check: (text: string) => AttemptReport,
    attempts: AttemptReport[],
    final: boolean,
  ): Outcome | null {
    const text = attempt.text.trim();
    const report = check(text);
    attempts.push(report);
    const { effects, handoff } = collectEffects(steps);

    if (handoff) {
      // Whatever the model wrote before handing off goes out only if grounded.
      return { reply: text && report.grounding.length === 0 ? text : null, effects, handoff };
    }
    if (!text) {
      const reason = attempt.finishReason === 'tool-calls' ? 'step_limit' : 'empty_reply';
      return { reply: null, effects: [], handoff: { reason, summaryForManager: null } };
    }
    if (report.grounding.length === 0 && report.style.length === 0) {
      return { reply: text, effects, handoff: null };
    }
    if (!final) return null;
    if (report.grounding.length > 0) {
      return { reply: null, effects: [], handoff: { reason: 'ungrounded_reply', summaryForManager: null } };
    }
    return { reply: text, effects, handoff: null };
  }

  private record(
    result: {
      steps: ReadonlyArray<{
        text: string;
        finishReason: string;
        toolCalls: ReadonlyArray<{ toolName: string; input: unknown }>;
        toolResults: ReadonlyArray<{ toolName: string; output: unknown }>;
      }>;
      totalUsage: {
        inputTokens: number | undefined;
        outputTokens: number | undefined;
        inputTokenDetails?: { cacheReadTokens?: number | undefined };
      };
    },
    attempt: number,
    steps: AgentStepRecord[],
    usage: AgentUsage,
  ): void {
    for (const step of result.steps) {
      steps.push({
        attempt,
        text: step.text,
        finishReason: step.finishReason,
        toolCalls: step.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
        toolResults: step.toolResults.map((r) => ({ toolName: r.toolName, output: r.output })),
      });
    }
    usage.inputTokens += result.totalUsage.inputTokens ?? 0;
    usage.outputTokens += result.totalUsage.outputTokens ?? 0;
    usage.cachedInputTokens += result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0;
  }

  /** Our copies of the customer photos in the history; null where one is gone. */
  private async loadPhotos(history: AgentHistoryEntry[]): Promise<Map<string, LoadedImage | null>> {
    const urls = [...new Set(history.flatMap((e) => (e.role === 'customer' ? e.images ?? [] : [])))];
    const loaded = await Promise.all(urls.map((url) => this.media.load(url)));
    return new Map(urls.map((url, i) => [url, loaded[i]]));
  }

  private maxSteps(): number {
    return this.config.get<number>('agent.maxSteps') || DEFAULT_MAX_STEPS;
  }

  private timeoutMs(): number {
    return this.config.get<number>('agent.timeoutMs') || DEFAULT_TIMEOUT_MS;
  }
}

/** `photos`: the loaded bytes of each customer photo URL in the history; null or missing sends a note instead. */
export function toModelMessages(
  history: AgentHistoryEntry[],
  photos: Map<string, LoadedImage | null> = new Map(),
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const entry of history) {
    const text = entry.text.trim();
    if (!text) continue;
    switch (entry.role) {
      case 'customer': {
        if (!entry.images?.length) {
          messages.push({ role: 'user', content: text });
          break;
        }
        const files = entry.images.map((url) => photos.get(url)).filter((p): p is LoadedImage => !!p);
        const missing = files.length < entry.images.length ? ` ${PHOTO_UNAVAILABLE}` : '';
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: text + missing },
            ...files.map((f) => ({ type: 'file' as const, data: f.data, mediaType: f.mediaType })),
          ],
        });
        break;
      }
      case 'bot':
        messages.push({ role: 'assistant', content: text });
        break;
      case 'manager':
        // Same side of the conversation as the bot, but the model should know
        // a person said it (a promise a manager made still stands).
        messages.push({ role: 'system', content: 'The next message was written by a human manager of the shop.' });
        messages.push({ role: 'assistant', content: text });
        break;
      case 'note':
        messages.push({ role: 'system', content: text });
        break;
    }
  }
  return messages;
}

/**
 * The provider refused the request itself — an image it can't read, too
 * large, unsupported. Not auth, rate limits or outages: those fail the turn.
 */
function isRequestRejection(err: unknown): boolean {
  const cause = RetryError.isInstance(err) ? err.lastError : err;
  return APICallError.isInstance(cause) && [400, 413, 415, 422].includes(cause.statusCode ?? 0);
}

/** The customer's newest message(s): what they wrote since the last reply. */
export function trailingCustomerText(history: AgentHistoryEntry[]): string {
  const texts: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role === 'note') continue;
    if (entry.role !== 'customer') break;
    texts.unshift(entry.text);
  }
  return texts.join('\n');
}

export function correctionMessage(report: AttemptReport): string {
  const problems: string[] = [];
  for (const v of report.grounding) {
    if (v.kind === 'order') {
      problems.push(
        `It says the order is placed («${v.value}»), but place_order was not called. Show the summary and ` +
          'ask the customer to confirm, or call place_order if they already clearly said yes.',
      );
      continue;
    }
    if (v.kind === 'draft') {
      problems.push(
        `It says details were saved or an item added («${v.value}»), but no update_order_draft succeeded this ` +
          'turn. Call update_order_draft with what the customer gave you now, or don\'t say it.',
      );
      continue;
    }
    const what = v.kind === 'price' ? 'the price' : v.kind === 'size' ? 'size' : 'the colour';
    problems.push(`It states ${what} «${v.value}», but no tool returned that in this turn.`);
  }
  for (const v of report.style) problems.push(`«${v.match}»: ${v.fix}.`);
  return [
    'Your reply was not sent. Problems:',
    ...problems.map((p) => `- ${p}`),
    'Look up anything you state with search_products, get_product or get_order_draft now, or leave it out. ' +
      'Fix the wording and write the reply again. If you cannot confirm something, call handoff.',
  ].join('\n');
}
