import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { CheckoutSessionStatus } from '@direct-mate/shared';
import { AgentService, trailingCustomerText } from './agent.service';
import type { AgentProduct } from './catalog/catalog-reader.service';
import type { AgentHistoryEntry } from './agent.types';
import type { LoadedImage } from '../customer-media/customer-media.service';
import type { AgentStoreSettings } from './store-settings.service';
import type { OrderDraftView } from '../orders/order-draft.service';

// The agent loop end to end, with a scripted model instead of a real one:
// what the model says comes from `doGenerate` results, everything else (tools,
// guards, retry, handoff) is the real code.

const USAGE = {
  inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const call = (toolName: string, input: unknown, id = toolName) => ({
  content: [{ type: 'tool-call' as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});

const SHIRT: AgentProduct = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  ref: 'aaaaaaaa',
  title: 'Сорочка льон',
  category: 'Сорочки',
  brand: null,
  material: 'льон',
  gender: null,
  season: null,
  modelName: null,
  description: null,
  imageUrl: 'https://cdn/shirt.jpg',
  attributes: {},
  variants: [
    { id: 'v1', color: 'Чорний', size: 'L', price: 3300, regularPrice: null, currency: 'UAH', available: 2, imageUrl: null },
  ],
};

const SETTINGS: AgentStoreSettings = {
  tenantName: 'Alta Men',
  timezone: 'Europe/Kyiv',
  knowledgeDoc: 'Відправка 1–3 дні.',
  brandTone: null,
  managerExamples: [],
  businessHours: [],
  welcomeLine: null,
  disallowedPhrases: ['💛'],
  checkoutFields: ['fullName', 'phone'],
  paymentDetails: 'IBAN UA00',
  handoffAnnounce: null,
  sizeChart: null,
  sizing: { advice: 'recommend', askMeasurementsFirst: false },
  conversationIdleHours: 24,
  modelOverride: null,
  operatingMode: 'active',
};

const READY_DRAFT: OrderDraftView = {
  sessionId: 'session-1',
  status: CheckoutSessionStatus.ReadyForDraftOrder,
  items: [{ variantId: 'v1', productId: SHIRT.id, title: 'Сорочка льон', color: 'Чорний', size: 'L', qty: 1, unitPrice: 3300, currency: 'UAH' }],
  customer: { fullName: 'Іван Петренко', phone: '+380671234567', city: null, branch: null, paymentMethod: null, comment: null },
  total: 3300,
  currency: 'UAH',
  missingFields: [],
  complete: true,
  placedOrderId: null,
  paymentDetailsSentAt: null,
};

function buildAgent(
  model: MockLanguageModelV4,
  opts: { draft?: OrderDraftView | null; photos?: Record<string, LoadedImage | null>; flagged?: string } = {},
) {
  return new AgentService(
    { get: (key: string) => ({ 'agent.maxSteps': 6, 'agent.timeoutMs': 10_000 })[key] } as never,
    { resolve: () => ({ model, modelId: 'mock-model', provider: 'openai', source: 'env', providerOptions: {} }) } as never,
    { load: async () => SETTINGS } as never,
    { get: async () => ({ text: 'aaaaaaaa · Сорочка льон · 3300 грн · Чорний', titles: ['Сорочка льон'] }) } as never,
    {
      resolveProductRef: async (_t: string, ref: string) =>
        ref === 'aaaaaaaa' ? { id: SHIRT.id } : { error: `No product with ref "${ref}" in this store.` },
      loadProducts: async () => [SHIRT],
    } as never,
    { search: async () => ({ ids: [SHIRT.id], total: 1 }) } as never,
    { resolveForContext: async () => null, getBrandAndCategoryForProduct: async () => ({}), publicUrl: (p: string) => p } as never,
    { getCurrentDraft: async () => opts.draft ?? null, update: jest.fn() } as never,
    { load: async (url: string) => opts.photos?.[url] ?? null } as never,
    { flaggedCategories: async (t: string) => (opts.flagged && t.includes(opts.flagged) ? ['harassment'] : []) } as never,
  );
}

const run = (
  agent: AgentService,
  customer = 'Скільки коштує сорочка з льону? Чорна в L є?',
  before: AgentHistoryEntry[] = [],
) =>
  agent.runTurn({
    tenantId: 't1',
    conversationId: 'c1',
    customerId: 'u1',
    history: [...before, { role: 'customer', text: customer }],
    now: new Date('2026-11-04T10:00:00Z'),
  });

const PHOTO_URL = '/uploads/customer-media/t1/p1.jpg';
const PHOTO: AgentHistoryEntry = { role: 'customer', text: '(sent a photo)', images: [PHOTO_URL] };
const JPEG: LoadedImage = { data: new Uint8Array([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg' };

/** The file parts the model received in the given call. */
const fileParts = (model: MockLanguageModelV4, call = 0) =>
  model.doGenerateCalls[call].prompt.flatMap((m) =>
    m.role === 'user' ? m.content.filter((p) => p.type === 'file') : [],
  );

describe('AgentService.runTurn', () => {
  it('sends a reply whose facts came from a tool this turn', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [call('get_product', { productRef: 'aaaaaaaa' }), text('Сорочка льон — 3300 грн, чорна в L є.')],
    });
    const result = await run(buildAgent(model));

    expect(result.reply).toBe('Сорочка льон — 3300 грн, чорна в L є.');
    expect(result.handoff).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(result.steps.map((s) => s.toolCalls.map((c) => c.toolName))).toEqual([['get_product'], []]);
    expect(result.usage).toEqual({ inputTokens: 200, cachedInputTokens: 40, outputTokens: 20 });
  });

  it('retries once with the problem spelled out when the reply invents a price', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        text('Сорочка коштує 2900 грн.'),
        call('get_product', { productRef: 'aaaaaaaa' }),
        text('Сорочка льон коштує 3300 грн.'),
      ],
    });
    const result = await run(buildAgent(model));

    expect(result.reply).toBe('Сорочка льон коштує 3300 грн.');
    expect(result.attempts.map((a) => a.grounding.length)).toEqual([1, 0]);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('2900 грн');
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('Your reply was not sent');
  });

  it('hands off with no text when the retry is still ungrounded', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [text('Коштує 2900 грн.'), text('Точно 2900 грн.')],
    });
    const result = await run(buildAgent(model));

    expect(result.reply).toBeNull();
    expect(result.effects).toEqual([]);
    expect(result.handoff).toEqual({ reason: 'ungrounded_reply', summaryForManager: null });
  });

  it('stops at the handoff tool and passes on the summary for the manager', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [call('handoff', { reason: 'complaint_or_return', summaryForManager: 'Хоче повернути сорочку' })],
    });
    const result = await run(buildAgent(model), 'Хочу повернути сорочку, вона брак');

    expect(result.handoff).toEqual({ reason: 'complaint_or_return', summaryForManager: 'Хоче повернути сорочку' });
    expect(result.reply).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('sends a reply that still has a style slip after the retry, flagged', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [text('Вибачаюсь, уточніть розмір.'), text('Вибачаюсь, уточніть розмір 💛')],
    });
    const result = await run(buildAgent(model), 'Хочу сорочку');

    expect(result.reply).toBe('Вибачаюсь, уточніть розмір 💛');
    expect(result.handoff).toBeNull();
    expect(result.attempts[1].style.map((s) => s.rule)).toEqual(['vybachaius', 'store_disallowed']);
  });

  it('stages place_order only from a complete draft, for the caller to carry out', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [call('place_order', {}), text('Готово, замовлення оформлено на 3300 грн.')],
    });
    const result = await run(buildAgent(model, { draft: READY_DRAFT }), 'Так, оформлюйте');

    expect(result.effects).toEqual([{ type: 'place_order', checkoutSessionId: 'session-1' }]);
    expect(result.reply).toBe('Готово, замовлення оформлено на 3300 грн.');
  });

  it("sends the customer's photo to the model as an image on the message it came with", async () => {
    const model = new MockLanguageModelV4({ doGenerate: [text('Так, є.')] });
    const result = await run(buildAgent(model, { photos: { [PHOTO_URL]: JPEG } }), 'Є така в L?', [PHOTO]);

    expect(result.reply).toBe('Так, є.');
    expect(fileParts(model)).toEqual([expect.objectContaining({ mediaType: 'image/jpeg' })]);
    expect(result.images).toEqual({ inContext: 1, unavailable: 0, rejected: false });
  });

  it('tells the model when a photo can no longer be opened', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [text('Надішліть, будь ласка, фото ще раз.')] });
    const result = await run(buildAgent(model), 'Є така в L?', [PHOTO]);

    expect(fileParts(model)).toEqual([]);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("couldn't be opened");
    expect(result.images).toEqual({ inContext: 0, unavailable: 1, rejected: false });
  });

  it('re-runs the attempt without photos when the provider refuses them, instead of handing off', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        if (calls++ === 0) {
          throw new APICallError({
            message: 'Invalid image',
            url: 'https://api.openai.com/v1/responses',
            requestBodyValues: {},
            statusCode: 400,
            isRetryable: false,
          });
        }
        return text('Не вдалося відкрити фото, надішліть його ще раз, будь ласка.');
      },
    });
    const result = await run(buildAgent(model, { photos: { [PHOTO_URL]: JPEG } }), 'Є така в L?', [PHOTO]);

    expect(result.handoff).toBeNull();
    expect(result.reply).toContain('надішліть');
    expect(fileParts(model, 1)).toEqual([]);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("couldn't be opened");
    expect(result.images).toEqual({ inContext: 0, unavailable: 1, rejected: true });
  });

  it('retries a reply moderation flags, and hands off if the retry is flagged too', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [text('Ви ідіот.'), text('Ви ідіот, кажу ж.')] });
    const result = await run(buildAgent(model, { flagged: 'ідіот' }), 'Ти тупий бот');

    expect(result.attempts.map((a) => a.grounding.map((g) => g.kind))).toEqual([['unsafe'], ['unsafe']]);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('flagged as inappropriate');
    expect(result.reply).toBeNull();
    expect(result.handoff?.reason).toBe('ungrounded_reply');
  });

  it('turns a model error into a handoff instead of throwing', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('rate limited');
      },
    });
    const result = await run(buildAgent(model));

    expect(result.handoff).toEqual({ reason: 'agent_error', summaryForManager: null });
    expect(result.error).toContain('rate limited');
  });
});

describe('trailingCustomerText', () => {
  it('joins the messages the customer sent since the last reply', () => {
    expect(
      trailingCustomerText([
        { role: 'customer', text: 'привіт' },
        { role: 'bot', text: 'Вітаю!' },
        { role: 'customer', text: 'а чорна є?' },
        { role: 'note', text: '— через 5 годин —' },
        { role: 'customer', text: 'на 182' },
      ]),
    ).toBe('а чорна є?\nна 182');
  });
});
