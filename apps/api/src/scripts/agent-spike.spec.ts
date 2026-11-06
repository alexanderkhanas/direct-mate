import { MockLanguageModelV4 } from 'ai/test';
import { buildSpikeAgent } from './agent-spike';

// Phase 0 check that jest can load the ESM-only `ai` package and its mock
// models. No network: the mock replays a tool call, then a text answer.

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

describe('agent SDK toolchain (Phase 0 spike)', () => {
  it('calls get_product, feeds the result back and returns the answer', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'get_product',
              input: JSON.stringify({ productId: 'p1' }),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: USAGE,
          warnings: [],
        },
        {
          content: [{ type: 'text', text: 'Сорочка льон — 3300 грн, чорна в L є.' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: USAGE,
          warnings: [],
        },
      ],
    });

    const result = await buildSpikeAgent(model).generate({ prompt: 'Скільки коштує сорочка з льону?' });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolResults[0].output).toMatchObject({ id: 'p1', price: 3300 });
    expect(result.text).toBe('Сорочка льон — 3300 грн, чорна в L є.');
    expect(model.doGenerateCalls).toHaveLength(2);
  });
});
