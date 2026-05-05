import { ReplyEngineService } from './reply-engine.service';
import { TemplateEngineService } from '../engine/template-engine.service';
import { ClassificationResult, AssistantMemory } from '../engine/classifier.service';

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
});
