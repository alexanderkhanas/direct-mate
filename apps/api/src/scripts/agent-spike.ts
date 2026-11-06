/**
 * Phase 0 toolchain spike for the v2 agent (docs/v2-agent/implementation-plan.md).
 *
 * Proves two things before any agent code is written:
 *   - `ai` v7 and `@ai-sdk/openai` v4 are ESM-only while this app is CommonJS.
 *     They load through Node 22's require(esm), from ts-node, `nest build`
 *     output and jest (see agent-spike.spec.ts).
 *   - A ToolLoopAgent calls a tool, reads the result and answers in Ukrainian.
 *
 * The catalog is a hardcoded fake and nothing touches the database. It mirrors
 * the planned shape: a compact catalog index in the instructions, `get_product`
 * by id for the details. Kept as a one-question smoke check when trying a model.
 *
 * Usage (one live question, two or three model calls):
 *   cd apps/api && npm run agent:spike
 *   cd apps/api && npm run agent:spike -- --model gpt-5.4
 *
 * Reads OPENAI_API_KEY from apps/api/.env. The model defaults to AGENT_MODEL,
 * then gpt-5.4-mini.
 */

import 'dotenv/config';
import { createOpenAI } from '@ai-sdk/openai';
import { isStepCount, tool, ToolLoopAgent, type LanguageModel } from 'ai';
import { z } from 'zod';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const QUESTION = 'Скільки коштує сорочка з льону? Чорна в L є?';

const FAKE_CATALOG = [
  {
    id: 'p1',
    title: 'Сорочка льон',
    price: 3300,
    currency: 'UAH',
    inStock: { Чорний: ['M', 'L'], Білий: ['L', 'XL'] },
  },
  {
    id: 'p2',
    title: 'Футболка базова',
    price: 900,
    currency: 'UAH',
    inStock: { Сірий: ['S', 'M'] },
  },
];

const CATALOG_INDEX = FAKE_CATALOG.map((p) => `${p.id} · ${p.title}`).join('\n');

export function buildSpikeAgent(model: LanguageModel) {
  return new ToolLoopAgent({
    model,
    instructions: [
      'Ти менеджер магазину одягу в Instagram. Відповідай коротко, українською.',
      'Ціну, кольори та розміри бери лише з результату get_product, ніколи не вигадуй.',
      `Каталог (id · назва):\n${CATALOG_INDEX}`,
    ].join('\n\n'),
    tools: {
      get_product: tool({
        description:
          'Ціна, кольори та розміри в наявності для одного товару. Виклич перед тим, як називати ціну чи наявність.',
        inputSchema: z.object({
          productId: z.string().describe('id з каталогу'),
        }),
        execute: async ({ productId }) =>
          FAKE_CATALOG.find((p) => p.id === productId) ?? { error: 'not_found' },
      }),
    },
    stopWhen: isStepCount(4),
  });
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const modelId = argValue('--model') ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set (apps/api/.env)');
  }
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const agent = buildSpikeAgent(openai(modelId));

  console.log(`model: ${modelId}`);
  console.log(`customer: ${QUESTION}`);
  const started = Date.now();
  const result = await agent.generate({ prompt: QUESTION });

  result.steps.forEach((step, i) => {
    for (const call of step.toolCalls) {
      console.log(`step ${i + 1}: ${call.toolName}(${JSON.stringify(call.input)})`);
    }
  });
  console.log(`reply: ${result.text}`);
  const { inputTokens, outputTokens } = result.totalUsage;
  console.log(
    `steps=${result.steps.length} tokens in/out=${inputTokens}/${outputTokens} ${Date.now() - started}ms`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
