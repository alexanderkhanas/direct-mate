/**
 * Provider adapters for the classifier's single LLM call.
 *
 * The classifier builds one system prompt + one message list + one forced tool
 * call, and that shape is provider-independent. Only the transport differs. This
 * seam exists so an OpenAI-vs-Anthropic A/B runs the SAME prompt on both sides —
 * anything else measures prompt-fit, not model quality.
 *
 * Routing is BY MODEL ID, not by a global provider switch. That matters:
 * `classifyWithFallback` swaps in OPENAI_FALLBACK_MODEL (gpt-5.4) for a
 * second-opinion pass, and it must keep hitting OpenAI even while the primary
 * classifier is a Claude model.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface ClassifierLlmRequest {
  model: string;
  /** Anthropic takes this top-level; OpenAI gets it as the first message. */
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tool: { name: string; description: string; schema: Record<string, unknown> };
  reasoningEffort?: string;
}

export interface ClassifierLlmResponse {
  /** Parsed tool arguments, or null when the model returned no tool call. */
  args: Record<string, any> | null;
  usage: { promptTokens: number; completionTokens: number };
  latencyMs: number;
  requestId: string | null;
}

export interface ClassifierLlm {
  call(req: ClassifierLlmRequest): Promise<ClassifierLlmResponse>;
}

export const isAnthropicModel = (model: string): boolean =>
  /^claude[-.]/i.test(model);

// ─── Anthropic message normalization ─────────────────────────────
//
// The Messages API is stricter than Chat Completions in ways our data violates
// today. OpenAI silently tolerates all three of these; Anthropic 400s.
//
//   1. content may not be empty        — `messages.text` is nullable in our DB
//                                        and we currently send `?? ''`
//   2. roles must alternate            — a debounced burst or a multi-part bot
//                                        reply produces consecutive same-role rows
//   3. the list must start with `user` — a conversation opened by the bot
//                                        (welcome message) starts with assistant
//
// Pure function, exported for tests: this is where the bugs would be.
export function normalizeForAnthropic(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  // 1. drop empty / whitespace-only turns
  const nonEmpty = messages.filter((m) => m.content?.trim().length > 0);

  // 2. merge consecutive same-role turns (preserves content; ordering intact)
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of nonEmpty) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
    }

  // 3. must open with a user turn — drop a leading assistant preamble
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift();

  return merged;
}

// ─── OpenAI ──────────────────────────────────────────────────────

export class OpenAiClassifierLlm implements ClassifierLlm {
  constructor(private readonly client: OpenAI) {}

  async call(req: ClassifierLlmRequest): Promise<ClassifierLlmResponse> {
    // GPT-5.6 (sol/terra/luna) and o-series are reasoning models: they take
    // reasoning_effort and reject a fixed temperature.
    const isReasoning = /gpt-5\.6|luna|sol|terra|^o[0-9]/i.test(req.model);

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        ...req.messages,
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: req.tool.name,
            description: req.tool.description,
            parameters: req.tool.schema,
            strict: true,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: req.tool.name } },
      max_completion_tokens: 400,
    };
    if (isReasoning) body.reasoning_effort = req.reasoningEffort ?? 'none';
    // Deterministic classification: same input → same output matters more than
    // variability. (It is not actually guaranteed — see the ask_delivery flip —
    // but temperature > 0 makes it strictly worse.)
    else body.temperature = 0;

    const start = performance.now();
    const completion = await (this.client.chat.completions.create as any)(body);
    const latencyMs = Math.round(performance.now() - start);

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    let args: Record<string, any> | null = null;
    if (toolCall) {
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = null; // caller logs + falls back to defaultClassification()
      }
    }

    return {
      args,
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      },
      latencyMs,
      requestId: (completion as { _request_id?: string })?._request_id ?? null,
    };
  }
}

// ─── Anthropic ───────────────────────────────────────────────────

export class AnthropicClassifierLlm implements ClassifierLlm {
  constructor(private readonly client: Anthropic) {}

  async call(req: ClassifierLlmRequest): Promise<ClassifierLlmResponse> {
    const messages = normalizeForAnthropic(req.messages);

    const start = performance.now();
    const res = await this.client.messages.create({
      model: req.model,
      // Top-level, NOT a message with role 'system'.
      system: req.system,
      messages,
      tools: [
        {
          name: req.tool.name,
          description: req.tool.description,
          // `function.parameters` IS JSON Schema, so it transfers verbatim.
          // OpenAI's strict-mode artifacts (additionalProperties:false, every
          // field required, nullable unions) are all valid JSON Schema and are
          // harmless here — the classifier already maps null → undefined.
          input_schema: req.tool.schema as any,
        },
      ],
      tool_choice: { type: 'tool', name: req.tool.name },
      max_tokens: 1024,
      temperature: 0,
    });
    const latencyMs = Math.round(performance.now() - start);

    // Tool arguments arrive as an ALREADY-PARSED object on the tool_use block —
    // no JSON.parse of an arguments string, unlike OpenAI.
    const block = res.content.find((c: any) => c.type === 'tool_use') as
      | { input: Record<string, any> }
      | undefined;

    return {
      args: block?.input ?? null,
      usage: {
        promptTokens: res.usage?.input_tokens ?? 0,
        completionTokens: res.usage?.output_tokens ?? 0,
      },
      latencyMs,
      requestId: (res as { _request_id?: string })?._request_id ?? null,
    };
  }
}
