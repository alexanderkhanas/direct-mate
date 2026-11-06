import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export const DEFAULT_AGENT_MODEL = 'gpt-5.4-mini';

export type AgentProvider = 'openai' | 'anthropic' | 'google';

export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
  provider: AgentProvider;
  /** Where the id came from, for the trace. */
  source: 'turn' | 'store' | 'env' | 'default';
  providerOptions: Record<string, Record<string, string>>;
  temperature?: number;
}

/** Same routing rule the old classifier uses (`isAnthropicModel`). */
export function providerFor(modelId: string): AgentProvider {
  if (/^claude[-.]/i.test(modelId)) return 'anthropic';
  if (/^gemini[-.]/i.test(modelId)) return 'google';
  return 'openai';
}

/**
 * Picks the agent's model: the turn's override, then the store's
 * `aiSettings.model`, then AGENT_MODEL, then the default.
 *
 * Provider-specific options live here, never in callers: forgetting one breaks
 * nothing, it just quietly costs more. A model whose provider isn't installed
 * or configured falls through to the next choice with a warning — a
 * misconfigured store never fails a turn. Only OpenAI is installed today; the
 * Anthropic and Google packages arrive with the model comparison (Phase 6).
 */
@Injectable()
export class AgentModelFactory {
  private readonly logger = new Logger(AgentModelFactory.name);
  private openai: OpenAIProvider | null = null;
  private warnedTemperature = false;

  constructor(private readonly config: ConfigService) {}

  resolve(choice: { turn?: string | null; store?: string | null }): ResolvedModel {
    const candidates: Array<[string | null | undefined, ResolvedModel['source']]> = [
      [choice.turn, 'turn'],
      [choice.store, 'store'],
      [this.config.get<string>('agent.model'), 'env'],
      [DEFAULT_AGENT_MODEL, 'default'],
    ];
    for (const [id, source] of candidates) {
      const modelId = id?.trim();
      if (!modelId) continue;
      const provider = providerFor(modelId);
      if (provider === 'openai' && this.openAiProvider()) {
        return {
          model: this.openai!(modelId),
          modelId,
          provider,
          source,
          providerOptions: this.openAiOptions(),
          temperature: this.openAiTemperature(),
        };
      }
      this.logger.warn(
        `Agent model "${modelId}" (${source}) needs the ${provider} provider, which isn't ` +
          `available here; trying the next choice`,
      );
    }
    throw new Error('No agent model is available: OPENAI_API_KEY is not set');
  }

  private openAiProvider(): OpenAIProvider | null {
    if (this.openai) return this.openai;
    const apiKey = this.config.get<string>('openai.apiKey');
    if (!apiKey) return null;
    this.openai = createOpenAI({ apiKey });
    return this.openai;
  }

  private openAiOptions(): ResolvedModel['providerOptions'] {
    const effort = this.config.get<string>('agent.reasoningEffort');
    return effort ? { openai: { reasoningEffort: effort } } : {};
  }

  /**
   * OpenAI's GPT-5 and later models take a temperature only with reasoning
   * effort `none`; with any other effort the SDK drops it and warns on every
   * call. Drop it here instead, once, so the setting can't look applied.
   */
  private openAiTemperature(): number | undefined {
    const temperature = this.config.get<number>('agent.temperature');
    if (temperature == null || Number.isNaN(temperature)) return undefined;
    if (this.config.get<string>('agent.reasoningEffort') === 'none') return temperature;
    if (!this.warnedTemperature) {
      this.warnedTemperature = true;
      this.logger.warn('AGENT_TEMPERATURE is ignored: OpenAI accepts it only with AGENT_REASONING_EFFORT=none');
    }
    return undefined;
  }
}
