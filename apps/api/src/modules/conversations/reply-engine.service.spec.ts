import { ReplyEngineService, markRepliedOnResult } from './reply-engine.service';
import { TemplateEngineService } from '../engine/template-engine.service';
import { ClassificationResult, AssistantMemory } from '../engine/classifier.service';
import { ReplyDecision } from '@direct-mate/shared';

/**
 * Unit tests for the mid-flow size-help branch + secondary
 * `ask_recommendation_from_shown` routing fix.
 *
 * Focused on the decision tree only — full process() flow is not
 * exercised. Service is constructed with `null as any` deps and a
 * stub availability service is injected for path A.
 */

type Variant = {
  id: string;
  size: string | null;
  color: string | null;
  price: number;
  currency: string;
  effectiveAvailable: number;
  imageUrl: string | null;
};

function makeProduct(opts: {
  id?: string;
  title?: string;
  variants: Array<Partial<Variant> & { size: string | null }>;
}) {
  return [
    {
      product: {
        id: opts.id ?? 'product-1',
        title: opts.title ?? 'Zara куртка',
        imageUrl: null,
        category: 'Куртки',
      },
      variants: opts.variants.map((v, i) => ({
        id: v.id ?? `variant-${i}`,
        size: v.size,
        color: v.color ?? null,
        price: v.price ?? 1000,
        currency: v.currency ?? 'UAH',
        effectiveAvailable: v.effectiveAvailable ?? 5,
        imageUrl: v.imageUrl ?? null,
      })),
    },
  ];
}

function makeService(
  availabilityFindAll: jest.Mock = jest.fn().mockResolvedValue([]),
  sizeChartsServiceOverride?: any,
): ReplyEngineService {
  const availabilityService = { findAllByProductId: availabilityFindAll } as any;
  const sizeChartsService = sizeChartsServiceOverride ?? {
    getBrandAndCategoryForProduct: jest.fn().mockResolvedValue({ brand: null, category: null }),
    resolveForContext: jest.fn().mockResolvedValue(null),
    publicUrl: jest.fn((p: string) => p),
  };
  const config = {
    get: (key: string) => (key === 'openai.apiKey' ? 'test-key' : undefined),
  } as any;
  return new ReplyEngineService(
    null as any, // settingsRepo
    null as any, // examplesRepo
    null as any, // storeConfigRepo
    availabilityService,
    null as any, // auditService
    null as any, // classifierService
    null as any, // templateEngine
    null as any, // policyEngine
    config,
    null as any, // instagramContentService
    null as any, // subscriptionsService
    sizeChartsService,
  );
}

const SIZE_CHART = {
  S: { heightMin: 160, heightMax: 170, weightMin: 50, weightMax: 65 },
  M: { heightMin: 165, heightMax: 175, weightMin: 60, weightMax: 75 },
  L: { heightMin: 170, heightMax: 180, weightMin: 70, weightMax: 85 },
  XL: { heightMin: 175, heightMax: 190, weightMin: 80, weightMax: 100 },
};

function baseClassification(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    primaryIntent: 'ask_recommendation',
    entities: {} as any,
    stage: 'need_discovery',
    sentiment: 'neutral',
    confidence: 0.95,
    dialogueAct: 'ask_recommendation',
    recommendedAction: 'recommend',
    slotAction: 'asks_question',
    ...overrides,
  } as ClassificationResult;
}

function baseCtx(overrides: {
  memory?: AssistantMemory;
  classification?: Partial<ClassificationResult>;
  flowConfig?: any;
}) {
  const flowConfig = overrides.flowConfig ?? {
    businessType: 'clothing',
    preQualify: { enabled: true, fields: ['height', 'weight'] },
    sizeChart: SIZE_CHART,
  };
  return {
    memory: overrides.memory ?? {},
    classification: baseClassification(overrides.classification),
    effectiveConfig: { flowConfig } as any,
    mediaProductData: undefined,
    trace: [] as string[],
  };
}

function makeInput(messageText: string) {
  return {
    tenantId: 't',
    conversationId: 'c',
    messageText,
    state: {} as any,
    recentMessages: [],
  } as any;
}

describe('ReplyEngineService.maybeMidFlowSizeHelp', () => {
  // Case 1: raw measurements + single matched variant → confirm_selection
  it('fires on raw measurements with single matched variant', async () => {
    const findAll = jest.fn().mockResolvedValue(
      makeProduct({
        variants: [
          { id: 'v-l', size: 'L', color: null },
          { id: 'v-m', size: 'M', color: null, effectiveAvailable: 0 },
        ],
      }),
    );
    const service = makeService(findAll);
    const ctx = baseCtx({
      memory: { selectedProductId: 'product-1', selectionState: 'awaiting_variant' },
    });
    await (service as any).maybeMidFlowSizeHelp(makeInput('180 80'), ctx);
    expect(ctx.memory.recommendedSize).toBe('L');
    expect(ctx.memory.preQualifyCollected).toBe(true);
    expect(ctx.memory.selectedVariantId).toBe('v-l');
    expect(ctx.memory.selectedVariantName).toBe('L');
    expect(ctx.memory.selectionState).toBe('awaiting_confirmation');
    expect(ctx.classification.primaryIntent).toBe('confirm_selection');
  });

  // Case 2: raw measurements + multiple variants at recommended size → ask_color_for_size
  it('fires on raw measurements with multiple colors at recommended size', async () => {
    const findAll = jest.fn().mockResolvedValue(
      makeProduct({
        variants: [
          { id: 'v-l-red', size: 'L', color: 'Red' },
          { id: 'v-l-black', size: 'L', color: 'Black' },
          { id: 'v-m-red', size: 'M', color: 'Red' },
        ],
      }),
    );
    const service = makeService(findAll);
    const ctx = baseCtx({
      memory: { selectedProductId: 'product-1', selectionState: 'awaiting_variant' },
    });
    await (service as any).maybeMidFlowSizeHelp(
      { tenantId: 't', conversationId: 'c', messageText: '180 80', state: {} as any, recentMessages: [] } as any,
      ctx,
    );
    expect(ctx.memory.recommendedSize).toBe('L');
    expect(ctx.memory.selectedSize).toBe('L');
    expect(ctx.memory.variantStep).toBe('color');
    expect(ctx.memory.selectionState).toBe('awaiting_variant');
    expect(ctx.memory.availableVariants).toHaveLength(2);
    expect(ctx.classification.primaryIntent).toBe('ask_color_for_size');
  });

  // Case 3: ask_recommendation + size keyword + measurements → fires
  it('fires on ask_recommendation + size keyword + measurements', async () => {
    const findAll = jest.fn().mockResolvedValue(
      makeProduct({ variants: [{ id: 'v-l', size: 'L', color: null }] }),
    );
    const service = makeService(findAll);
    const ctx = baseCtx({
      memory: { selectedProductId: 'product-1', selectionState: 'awaiting_variant' },
    });
    await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'Я 180 см 80 кг, який розмір підібрати?',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(ctx.memory.recommendedSize).toBe('L');
    expect(ctx.memory.selectionState).toBe('awaiting_confirmation');
  });

  // Case 4: ask_price with "розмір L" → does NOT fire (over-fire guard)
  it('does NOT fire on ask_price even with size keyword', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: { primaryIntent: 'ask_price' },
      memory: { recommendedSize: 'PREEXISTING', selectedProductId: 'product-1' },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'скільки коштує розмір L?',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).toBeNull();
    // Memory unchanged — branch did not fire
    expect(ctx.memory.recommendedSize).toBe('PREEXISTING');
    expect(ctx.memory.preQualifyCollected).toBeUndefined();
  });

  // Case 5: category search with no measurements → does NOT fire
  it('does NOT fire on category search without measurements', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: { primaryIntent: 'category_browse' },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'хочу замовити куртку',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).toBeNull();
    expect(ctx.memory.preQualifyCollected).toBeUndefined();
  });

  // Case 6: keyword-only (no numbers) → asks for measurements
  it('asks for measurements when only size keyword without numbers', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: { primaryIntent: 'ask_recommendation' },
      memory: { selectedProductId: 'product-1' },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'який розмір підібрати?',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).not.toBeNull();
    expect(result.reply.text).toBe(
      'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛',
    );
    expect(ctx.memory.lastAction).toBe('asked_pre_qualify');
    expect(ctx.memory.awaitingField).toBe('pre_qualify_data');
    expect(ctx.memory.recommendedSize).toBeUndefined();
  });

  // Case 7: no product selected → routes to show_products
  it('routes to show_products when no product selected', async () => {
    const findAll = jest.fn();
    const service = makeService(findAll);
    const ctx = baseCtx({
      memory: {
        selectedCategory: 'Сукні',
        lastPresentedProducts: [
          { title: 'A', variants: ['L'], price: '100 UAH' },
          { title: 'B', variants: ['L'], price: '200 UAH' },
        ],
      },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      { tenantId: 't', conversationId: 'c', messageText: '180 80', state: {} as any, recentMessages: [] } as any,
      ctx,
    );
    expect(result).toBeNull();
    expect(ctx.memory.recommendedSize).toBe('L');
    expect(ctx.classification.primaryIntent).toBe('category_browse');
    expect(ctx.classification.recommendedAction).toBe('show_products');
    expect(findAll).not.toHaveBeenCalled();
  });

  // Case 10: non-size suggestion does NOT fire branch
  it('does NOT fire on non-size suggestion ("що порадите для пляжу?")', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: { primaryIntent: 'ask_recommendation' },
      memory: { selectedProductId: 'product-1' },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'що порадите для пляжу?',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).toBeNull();
    expect(ctx.memory.preQualifyCollected).toBeUndefined();
    expect(ctx.memory.lastAction).toBeUndefined();
  });

  // Case 11: non-size suggestion with single product still does NOT fire
  it('does NOT fire on "що порадите для офісу?" with single product in lastPresentedProducts', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: { primaryIntent: 'ask_recommendation' },
      memory: {
        selectedProductId: 'product-1',
        lastPresentedProducts: [{ title: 'A', variants: ['L'], price: '100 UAH' }],
      },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'що порадите для офісу?',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).toBeNull();
    expect(ctx.memory.recommendedSize).toBeUndefined();
  });

  // Anti-trigger: confirmation slotAction in awaiting_confirmation state
  it('does NOT fire when user said "так" in awaiting_confirmation', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: { primaryIntent: 'ready_to_order', slotAction: 'confirmation' },
      memory: { selectionState: 'awaiting_confirmation', selectedProductId: 'product-1' },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'так розмір L підходить', // size keyword present but slotAction guards
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).toBeNull();
  });

  // Anti-trigger: entities.size already set
  it('does NOT fire when entities.size is already set', async () => {
    const service = makeService();
    const ctx = baseCtx({
      classification: {
        primaryIntent: 'ask_recommendation',
        entities: { size: 'L' } as any,
      },
      memory: { selectedProductId: 'product-1' },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      {
        tenantId: 't',
        conversationId: 'c',
        messageText: 'розмір L',
        state: {} as any,
        recentMessages: [],
      } as any,
      ctx,
    );
    expect(result).toBeNull();
  });

  // Defensive: feature disabled in flow_config
  it('does NOT fire when preQualify is disabled', async () => {
    const service = makeService();
    const ctx = baseCtx({
      flowConfig: {
        businessType: 'clothing',
        preQualify: { enabled: false },
        sizeChart: SIZE_CHART,
      },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      { tenantId: 't', conversationId: 'c', messageText: '180 80', state: {} as any, recentMessages: [] } as any,
      ctx,
    );
    expect(result).toBeNull();
  });

  // Defensive: empty sizeChart
  it('does NOT fire when sizeChart is empty', async () => {
    const service = makeService();
    const ctx = baseCtx({
      flowConfig: {
        businessType: 'clothing',
        preQualify: { enabled: true, fields: ['height', 'weight'] },
        sizeChart: {},
      },
    });
    const result = await (service as any).maybeMidFlowSizeHelp(
      { tenantId: 't', conversationId: 'c', messageText: '180 80', state: {} as any, recentMessages: [] } as any,
      ctx,
    );
    expect(result).toBeNull();
  });
});

describe('ReplyEngineService.handleSizeChartRequest help-style diversion', () => {
  function ctxFor(opts: {
    dialogueAct: string;
    preQualifyCollected?: boolean;
    sizeChart?: any;
    preQualifyEnabled?: boolean;
    businessType?: string;
  }) {
    return {
      memory: { preQualifyCollected: opts.preQualifyCollected } as AssistantMemory,
      classification: baseClassification({
        primaryIntent: 'size_chart_request',
        dialogueAct: opts.dialogueAct,
      }),
      effectiveConfig: {
        flowConfig: {
          businessType: opts.businessType ?? 'clothing',
          preQualify: { enabled: opts.preQualifyEnabled ?? true, fields: ['height', 'weight'] },
          sizeChart: opts.sizeChart ?? SIZE_CHART,
        },
      } as any,
      mediaProductData: undefined,
      trace: [] as string[],
    };
  }

  // Help-style request → measurements offer + chart attached as extraReplies.
  it('routes help-style "Можете допомогти з розміром?" to measurements offer with chart attached', async () => {
    const sizeChartsService = {
      getBrandAndCategoryForProduct: jest.fn().mockResolvedValue({ brand: 'Zara', category: 'Куртки' }),
      resolveForContext: jest.fn().mockResolvedValue({
        id: 'chart-1',
        name: 'Куртки',
        imagePath: '/uploads/zara-куртки.jpg',
      }),
      publicUrl: jest.fn((p: string) => p),
    };
    const service = makeService(undefined, sizeChartsService);
    const ctx = ctxFor({ dialogueAct: 'ask_recommendation' });
    const result = await (service as any).handleSizeChartRequest(makeInput('Можете допомогти з розміром?'), ctx);
    expect(result).not.toBeNull();
    expect(result.reply.text).toBe(
      'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛',
    );
    expect(result.extraReplies).toHaveLength(1);
    expect(result.extraReplies[0].imageUrls).toEqual(['/uploads/zara-куртки.jpg']);
    expect(ctx.memory.lastAction).toBe('asked_pre_qualify');
    expect(ctx.memory.awaitingField).toBe('pre_qualify_data');
  });

  // Help-style request when no chart resolves → measurements offer only,
  // no extraReplies bubble.
  it('sends measurements offer without chart when chart does not resolve', async () => {
    const service = makeService(); // default mock returns null chart
    const ctx = ctxFor({ dialogueAct: 'ask_recommendation' });
    const result = await (service as any).handleSizeChartRequest(makeInput('Можете допомогти з розміром?'), ctx);
    expect(result).not.toBeNull();
    expect(result.reply.text).toBe(
      'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛',
    );
    expect(result.extraReplies).toBeUndefined();
  });

  // Direct chart ask → still falls through to chart attachment (no diversion).
  it('does NOT divert direct chart ask "розмірна сітка є?"', async () => {
    const service = makeService();
    const ctx = ctxFor({ dialogueAct: 'ask_about_shown_products' });
    // The diversion guard returns null → handler continues to chart resolution.
    // Without sizeChartsService mocked, the chart resolution would fail; we
    // only assert the guard did NOT short-circuit with a measurements offer.
    let result: any = null;
    try {
      result = await (service as any).handleSizeChartRequest(makeInput('розмірна сітка є?'), ctx);
    } catch {
      // expected — sizeChartsService unmocked. We're only checking the
      // diversion did not fire (memory unchanged).
    }
    expect(ctx.memory.lastAction).toBeUndefined();
    if (result) {
      expect(result.reply?.text).not.toBe(
        'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛',
      );
    }
  });

  // Already collected measurements → no diversion (just send chart).
  it('does NOT divert when measurements already collected', async () => {
    const service = makeService();
    const ctx = ctxFor({
      dialogueAct: 'ask_recommendation',
      preQualifyCollected: true,
    });
    let result: any = null;
    try {
      result = await (service as any).handleSizeChartRequest(makeInput('Можете допомогти з розміром?'), ctx);
    } catch {
      // expected
    }
    expect(ctx.memory.lastAction).toBeUndefined();
    if (result) {
      expect(result.reply?.text).not.toBe(
        'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛',
      );
    }
  });

  // No structured chart → no diversion (existing chart-only behavior).
  it('does NOT divert when sizeChart is empty', async () => {
    const service = makeService();
    const ctx = ctxFor({
      dialogueAct: 'ask_recommendation',
      sizeChart: {},
    });
    let result: any = null;
    try {
      result = await (service as any).handleSizeChartRequest(makeInput('Можете допомогти з розміром?'), ctx);
    } catch {
      // expected
    }
    expect(ctx.memory.lastAction).toBeUndefined();
    if (result) {
      expect(result.reply?.text).not.toBe(
        'Напишіть свій зріст та вагу і я допоможу підібрати розмір 💛',
      );
    }
  });
});

describe('TemplateEngineService.resolveScenario — secondary fix (ask_recommendation_from_shown threshold)', () => {
  // Bypass the constructor by accessing the prototype directly.
  // resolveScenario is private; cast to any to invoke. It depends only on
  // the inputs, no service state.
  const resolveScenario: (
    classification: ClassificationResult,
    memory: AssistantMemory | undefined,
  ) => string | null = (TemplateEngineService.prototype as any).resolveScenario;

  // Case 9: 2+ products → ask_recommendation_from_shown (preserved)
  it('routes to ask_recommendation_from_shown with 2+ products', () => {
    const result = resolveScenario.call(
      {} as any,
      baseClassification({ primaryIntent: 'ask_recommendation' }),
      {
        lastPresentedProducts: [
          { title: 'A', variants: [], price: '0' },
          { title: 'B', variants: [], price: '0' },
        ],
      } as AssistantMemory,
    );
    expect(result).toBe('ask_recommendation_from_shown');
  });

  // Case 8: single product → falls through to recommend_product
  it('routes to recommend_product with single product (NOT ask_recommendation_from_shown)', () => {
    const result = resolveScenario.call(
      {} as any,
      baseClassification({ primaryIntent: 'ask_recommendation' }),
      {
        lastPresentedProducts: [{ title: 'A', variants: [], price: '0' }],
      } as AssistantMemory,
    );
    expect(result).toBe('recommend_product');
  });

  // Case 12 (sanity): zero products → recommend_product (template will fail
  // to render without product_name → falls to AI fallback / handoff in
  // process(); existing behavior, not changed by our fix)
  it('routes to recommend_product with zero products', () => {
    const result = resolveScenario.call(
      {} as any,
      baseClassification({ primaryIntent: 'ask_recommendation' }),
      {} as AssistantMemory,
    );
    expect(result).toBe('recommend_product');
  });
});

describe('ReplyEngineService.matchVariant — color-in-title (no color axis) products', () => {
  // Reproduces the conv 22e5fdcc bug. JACK&JONES Темно-сині карго штани has
  // color in TITLE, all variants have color=null. Pre-fix: matchVariant
  // returned null when userColor was provided + variants had color=null.
  // Post-fix: matchVariant skips color filter when no variant has color.

  function callMatch(
    variants: Array<{ id: string; name: string; color?: string | null; size?: string | null }>,
    userColor?: string,
    userSize?: string,
  ) {
    const service = makeService();
    return (service as any).matchVariant(variants, userColor, userSize);
  }

  // No color axis + size match → returns the matched variant
  it('matches size on no-color-axis product even when redundant color is provided', () => {
    const variants = [
      { id: 'v30', name: '30', color: null, size: '30' },
      { id: 'v32', name: '32', color: null, size: '32' },
      { id: 'v34', name: '34', color: null, size: '34' },
    ];
    const result = callMatch(variants, 'сині', '32');
    expect(result).toMatchObject({ id: 'v32', name: '32' });
  });

  // No color axis + size only → matches by size
  it('matches by size only on no-color-axis product without color provided', () => {
    const variants = [
      { id: 'v30', name: '30', color: null, size: '30' },
      { id: 'v32', name: '32', color: null, size: '32' },
    ];
    const result = callMatch(variants, undefined, '32');
    expect(result).toMatchObject({ id: 'v32', name: '32' });
  });

  // No color axis + only userColor (no size) + multiple variants → null (size still ambiguous)
  it('returns null on no-color-axis product when only color is provided and multiple sizes exist', () => {
    const variants = [
      { id: 'v30', name: '30', color: null, size: '30' },
      { id: 'v32', name: '32', color: null, size: '32' },
    ];
    const result = callMatch(variants, 'сині', undefined);
    // Color filter skipped (no axis), only userColor provided so candidates
    // narrow to all 2 variants, then no size to disambiguate → returns null.
    expect(result).toBeNull();
  });

  // Regression — color axis exists + matching color → still strict-matches
  it('still strict-matches color when product has a color axis', () => {
    const variants = [
      { id: 'r-m', name: 'Red, M', color: 'Red', size: 'M' },
      { id: 'b-m', name: 'Black, M', color: 'Black', size: 'M' },
    ];
    const result = callMatch(variants, 'Red', 'M');
    expect(result).toMatchObject({ id: 'r-m', name: 'Red, M' });
  });

  // Regression — color axis exists + non-matching color → still returns null
  it('returns null when color axis exists but user color does not match any variant', () => {
    const variants = [
      { id: 'r-m', name: 'Red, M', color: 'Red', size: 'M' },
      { id: 'b-m', name: 'Black, M', color: 'Black', size: 'M' },
    ];
    const result = callMatch(variants, 'Yellow', 'M');
    expect(result).toBeNull();
  });

  // No color axis + size doesn't exist → null
  it('returns null on no-color-axis product when size does not match any variant', () => {
    const variants = [
      { id: 'v30', name: '30', color: null, size: '30' },
      { id: 'v32', name: '32', color: null, size: '32' },
    ];
    const result = callMatch(variants, 'сині', '99');
    expect(result).toBeNull();
  });

  // Ukrainian gender forms — feminine userColor should match masculine variant.color
  it('matches Ukrainian feminine color "чорна" against masculine variant "Чорний"', () => {
    const variants = [
      { id: 'r-m', name: 'Чорний, M', color: 'Чорний', size: 'M' },
      { id: 'b-m', name: 'Білий, M', color: 'Білий', size: 'M' },
    ];
    const result = callMatch(variants, 'чорна', 'M');
    expect(result).toMatchObject({ id: 'r-m', name: 'Чорний, M' });
  });

  // Ukrainian gender — neuter form "чорне" matches masculine "Чорний"
  it('matches Ukrainian neuter color "чорне" against masculine variant "Чорний"', () => {
    const variants = [
      { id: 'r-m', name: 'Чорний, M', color: 'Чорний', size: 'M' },
    ];
    const result = callMatch(variants, 'чорне', 'M');
    expect(result).toMatchObject({ id: 'r-m', name: 'Чорний, M' });
  });

  // Ukrainian feminine "синя" matches masculine variant "Синій"
  it('matches feminine "синя" against masculine variant "Синій"', () => {
    const variants = [
      { id: 'b-l', name: 'Синій, L', color: 'Синій', size: 'L' },
      { id: 'w-l', name: 'Білий, L', color: 'Білий', size: 'L' },
    ];
    const result = callMatch(variants, 'синя', 'L');
    expect(result).toMatchObject({ id: 'b-l', name: 'Синій, L' });
  });
});

describe('ReplyEngineService.narrowByProductName — productName-aware search narrowing', () => {
  function pd(...products: Array<{ id?: string; title: string }>): any[] {
    return products.map(p => ({
      product: { id: p.id ?? p.title, title: p.title, imageUrl: null, category: null },
      variants: [],
    }));
  }

  function callNarrow(productData: any[], productName: string): any[] {
    const service = makeService();
    return (service as any).narrowByProductName(productData, productName);
  }

  // Narrows to subset when terms match a strict subset of titles
  it('narrows to subset when productName terms match a strict subset', () => {
    const data = pd(
      { title: 'Zara Чорна стьобана куртка-бомбер' },
      { title: 'JACK&JONES Чорна стьобана куртка' },
      { title: 'Massimo Dutti Куртка бомбер' },
    );
    const result = callNarrow(data, 'Massimo Dutti куртка');
    expect(result).toHaveLength(1);
    expect(result[0].product.title).toBe('Massimo Dutti Куртка бомбер');
  });

  // Falls through to original when narrowing yields zero matches
  it('falls through to original when productName matches zero products', () => {
    const data = pd(
      { title: 'Zara Чорна стьобана куртка-бомбер' },
      { title: 'JACK&JONES Чорна стьобана куртка' },
    );
    // Cyrillic "джек" does not match Latin "JACK" (no translit yet) → 0 narrow → fall through
    const result = callNarrow(data, 'куртка джек');
    expect(result).toHaveLength(2);
    expect(result).toEqual(data);
  });

  // ALL terms must match (every, not some) — partial-match products excluded
  it('requires ALL terms to match (every, not some)', () => {
    const data = pd(
      { title: 'Zara базова футболка' },             // matches "zara" + "футболка" — all terms
      { title: 'Zara Чорна базова футболка' },       // matches "zara" + "футболка" — all terms
      { title: 'Mango базова футболка' },            // matches "футболка" only — missing "zara"
    );
    const result = callNarrow(data, 'Zara футболка');
    expect(result).toHaveLength(2);
    expect(result.map((r: any) => r.product.title)).toEqual([
      'Zara базова футболка',
      'Zara Чорна базова футболка',
    ]);
  });

  // Empty productName (all terms < 3 chars or stopwords) → no-op
  it('no-op when all terms are too short or stopwords', () => {
    const data = pd(
      { title: 'Zara базова футболка' },
      { title: 'Mango Сукня' },
    );
    // 'і' (1 char), 'та' (2 chars), 'для' (stopword), 'of' (stopword)
    const result = callNarrow(data, 'і та для of');
    expect(result).toEqual(data);
  });

  // Stop-word filter drops "енд"/"and"/"&" so brand-with-conjunction works
  it('filters stop-words including енд/and/&', () => {
    const data = pd(
      { title: 'Jack & Jones Футболка oversize з принтом' },
      { title: 'Zara базова футболка' },
    );
    // After stripping "&", terms are "jack","jones","футболка" → matches first only
    const result = callNarrow(data, 'jack & jones футболка');
    expect(result).toHaveLength(1);
    expect(result[0].product.title).toBe('Jack & Jones Футболка oversize з принтом');
  });

  // Returns original when narrowing kept everything (no productName specificity)
  it('returns original when every product matches all terms', () => {
    const data = pd(
      { title: 'Zara базова футболка' },
      { title: 'Zara Чорна базова футболка' },
    );
    // "zara" matches both → narrowed.length === productData.length (no actual narrowing)
    const result = callNarrow(data, 'Zara');
    expect(result).toHaveLength(2);
  });
});

/**
 * markRepliedOnResult invariant — every reply or handoff emission must
 * stamp memory.lastReplyAt and propagate it via stateUpdate.contextJson.
 * This guards the 6h dormancy welcome gate against future code paths
 * that bypass `withTrace` (which is the centralized chokepoint).
 */
describe('markRepliedOnResult', () => {
  const FIXED_NOW = new Date('2026-05-10T15:00:00.000Z');
  const fixedNow = () => FIXED_NOW;

  function makeReplyResult(overrides: any = {}) {
    return {
      decision: ReplyDecision.Reply,
      reply: { text: 'hello', sendNow: true },
      handoff: { required: false, reason: null },
      stateUpdate: null as any,
      ...overrides,
    };
  }

  function makeHandoffResult(overrides: any = {}) {
    return {
      decision: ReplyDecision.Handoff,
      reply: null,
      handoff: { required: true, reason: 'manual' },
      stateUpdate: null as any,
      ...overrides,
    };
  }

  function makeNoOpResult(overrides: any = {}) {
    return {
      decision: ReplyDecision.Reply,
      reply: { text: null as any, sendNow: false },
      handoff: { required: false, reason: null },
      stateUpdate: null as any,
      ...overrides,
    };
  }

  it('sets lastReplyAt on a reply with text', () => {
    const memory: AssistantMemory = {};
    const result = makeReplyResult();
    markRepliedOnResult(memory, result, fixedNow);
    expect(memory.lastReplyAt).toBe(FIXED_NOW.toISOString());
    expect((result.stateUpdate as any).contextJson.lastReplyAt).toBe(
      FIXED_NOW.toISOString(),
    );
  });

  it('sets lastReplyAt on a handoff (no reply text)', () => {
    const memory: AssistantMemory = {};
    const result = makeHandoffResult();
    markRepliedOnResult(memory, result, fixedNow);
    expect(memory.lastReplyAt).toBe(FIXED_NOW.toISOString());
    expect((result.stateUpdate as any).contextJson.lastReplyAt).toBe(
      FIXED_NOW.toISOString(),
    );
  });

  it('does NOT set lastReplyAt on a no-op (no text + no handoff)', () => {
    const memory: AssistantMemory = {};
    const result = makeNoOpResult();
    markRepliedOnResult(memory, result, fixedNow);
    expect(memory.lastReplyAt).toBeUndefined();
    expect(result.stateUpdate).toBeNull();
  });

  it('preserves prior memory fields when patching contextJson', () => {
    const memory: AssistantMemory = {
      welcomedAt: '2026-05-10T08:00:00.000Z',
      selectedProductId: 'p-123',
    };
    const result = makeReplyResult();
    markRepliedOnResult(memory, result, fixedNow);
    const ctxJson = (result.stateUpdate as any).contextJson;
    expect(ctxJson.welcomedAt).toBe('2026-05-10T08:00:00.000Z');
    expect(ctxJson.selectedProductId).toBe('p-123');
    expect(ctxJson.lastReplyAt).toBe(FIXED_NOW.toISOString());
  });

  it('merges into existing stateUpdate without losing other fields', () => {
    const memory: AssistantMemory = {};
    const result = makeReplyResult({
      stateUpdate: { selectedVariantId: 'v-1' as any },
    });
    markRepliedOnResult(memory, result, fixedNow);
    expect((result.stateUpdate as any).selectedVariantId).toBe('v-1');
    expect((result.stateUpdate as any).contextJson.lastReplyAt).toBe(
      FIXED_NOW.toISOString(),
    );
  });

  it('handles multiple result shapes encountered in process()', () => {
    // Mirrors every reply-emitting decision the engine returns: Reply,
    // Handoff, CreateDraftOrder. None should slip through.
    const cases: Array<{ name: string; result: any }> = [
      { name: 'Reply', result: makeReplyResult() },
      { name: 'Handoff', result: makeHandoffResult() },
      {
        name: 'CreateDraftOrder',
        result: {
          decision: ReplyDecision.CreateDraftOrder,
          reply: { text: 'order created', sendNow: true },
          handoff: { required: false, reason: null },
          stateUpdate: null,
        },
      },
    ];
    for (const c of cases) {
      const memory: AssistantMemory = {};
      markRepliedOnResult(memory, c.result, fixedNow);
      // Per-case label via stringified case name in the failure message.
      if (memory.lastReplyAt !== FIXED_NOW.toISOString()) {
        throw new Error(`${c.name}: lastReplyAt unset (expected ${FIXED_NOW.toISOString()})`);
      }
    }
  });
});

/**
 * Unit tests for `colorsOverlap` — the canonical color-equality helper.
 *
 * Replaces 4 raw `a.toLowerCase() === b.toLowerCase()` compares in 5.5a-pre
 * and 5.5b-2 that silently failed when (a) a tenant catalog stored colors
 * in English while classifier emitted Ukrainian (or vice versa), or (b)
 * `handleColorLinkedMedia` wrote `memory.selectedColor` from a raw
 * `instagram_media_mappings.linked_color` whose canonical form differed
 * from the catalog's stored form.
 */
describe('colorsOverlap', () => {
  // Pure decision helper — reuse the test-suite's makeService() rather
  // than re-spelling the constructor.
  const svc = makeService();
  const overlap = (a: string | null | undefined, b: string | null | undefined): boolean =>
    (svc as any).colorsOverlap(a, b);

  it('matches identical strings case-insensitively', () => {
    expect(overlap('Чорний', 'чорний')).toBe(true);
    expect(overlap('Red', 'RED')).toBe(true);
  });

  it('matches across EN ↔ UA via translation table — the recurring class', () => {
    // Mixed-language catalog: classifier emits one form, DB stores the other.
    expect(overlap('червоний', 'Red')).toBe(true);
    expect(overlap('Red', 'червоний')).toBe(true);
    expect(overlap('Чорний', 'black')).toBe(true);
    expect(overlap('white', 'Білий')).toBe(true);
    expect(overlap('beige', 'бежевий')).toBe(true);
  });

  it('matches substring forms in both directions (Темно-чорний ↔ чорний)', () => {
    expect(overlap('Темно-чорний', 'чорний')).toBe(true);
    expect(overlap('чорний', 'Темно-чорний')).toBe(true);
  });

  it('returns false for unrelated colors', () => {
    expect(overlap('Чорний', 'Білий')).toBe(false);
    expect(overlap('Red', 'Blue')).toBe(false);
    expect(overlap('червоний', 'синій')).toBe(false);
  });

  it('returns false on null / empty — color-in-title products carry v.color=null', () => {
    expect(overlap(null, 'Red')).toBe(false);
    expect(overlap('Red', null)).toBe(false);
    expect(overlap(undefined, 'Red')).toBe(false);
    expect(overlap('', 'Red')).toBe(false);
    expect(overlap('Red', '')).toBe(false);
  });

  it('handles whitespace via translateColor.trim()', () => {
    expect(overlap('  чорний  ', 'Black')).toBe(true);
    expect(overlap('Чорний', '  black  ')).toBe(true);
  });

  it('5.5a-pre repro: classifier "червоний" vs DB "Red" → not colorMissing', () => {
    // Before fix: askedColor.toLowerCase() === v.color.toLowerCase()
    // → "червоний" !== "red" → colorMissing=true → variant_not_available.
    const availableColors = ['Red', 'Blue'];
    const askedColor = 'червоний';
    const colorMissing = !availableColors.some((c) => overlap(c, askedColor));
    expect(colorMissing).toBe(false);
  });

  it('5.5b-2 repro: memory.selectedColor "Червоний" vs DB "Red" → sizesForColor non-empty', () => {
    // Before fix: filter dropped every variant because of case+language mismatch.
    const variants = [
      { color: 'Red', size: 'S' },
      { color: 'Red', size: 'M' },
      { color: 'Blue', size: 'S' },
    ];
    const selectedColor = 'Червоний';
    const sizesForColor = variants.filter((v) => overlap(v.color, selectedColor));
    expect(sizesForColor).toHaveLength(2);
    expect(sizesForColor.map((v) => v.size)).toEqual(['S', 'M']);
  });
});

/**
 * Unit tests for the show_products fallthrough state-hygiene fix
 * (prod conv 77e61632-…). Two regressions:
 *  1. `updateMemoryFromAction` case `'show_products'` must preserve
 *     mid-flow selectionState — only downgrade from undefined or
 *     already-awaiting_product.
 *  2. The post-render variant latch must skip `show_products` so a
 *     fallthrough render doesn't bake the template-engine's
 *     `matched_variant_id` into memory.
 */
describe('show_products fallthrough hygiene', () => {
  function update(action: string, memory: any): void {
    const svc = makeService();
    (svc as any).updateMemoryFromAction(action, memory, {}, { entities: {} }, null);
  }

  it('preserves awaiting_variant on show_products (the prod loop case)', () => {
    const memory: any = {
      selectionState: 'awaiting_variant',
      selectedProductId: 'p-sweater',
    };
    update('show_products', memory);
    expect(memory.selectionState).toBe('awaiting_variant');
    expect(memory.lastAction).toBe('presented_product_options');
  });

  it('preserves awaiting_confirmation on show_products', () => {
    const memory: any = {
      selectionState: 'awaiting_confirmation',
      selectedProductId: 'p-sweater',
      selectedVariantId: 'v-1',
    };
    update('show_products', memory);
    expect(memory.selectionState).toBe('awaiting_confirmation');
  });

  it('preserves confirmed on show_products (post-order resets must be explicit)', () => {
    const memory: any = {
      selectionState: 'confirmed',
      orderCreated: true,
    };
    update('show_products', memory);
    expect(memory.selectionState).toBe('confirmed');
  });

  it('downgrades to awaiting_product when entering state is undefined', () => {
    const memory: any = {};
    update('show_products', memory);
    expect(memory.selectionState).toBe('awaiting_product');
  });

  it('keeps awaiting_product idempotent on re-render', () => {
    const memory: any = { selectionState: 'awaiting_product' };
    update('show_products', memory);
    expect(memory.selectionState).toBe('awaiting_product');
  });
});
