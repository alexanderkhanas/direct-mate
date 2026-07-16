/**
 * Deterministic coverage for `isCheckoutCommitOnFullCart` — the predicate that
 * stops a customer with a full cart from being escalated with
 * `product_not_found` when they say "оформлюємо".
 *
 * The bug it guards is FLAKY (it depends on which `recommendedAction` the
 * classifier happens to emit), so simulator scenarios cannot pin it — a single
 * run proves nothing. These tests feed the predicate the REAL recorded
 * classifier outputs from both the passing and the failing run and assert the
 * routing decision directly, with no LLM in the loop.
 */
import { ClassificationResult, AssistantMemory } from '../engine/classifier.service';
import { ReplyEngineService } from './reply-engine.service';

// The predicate is private; exercise it through the class without booting Nest.
// It is a pure function of (classification, memory) — no injected deps are touched.
const predicate = (
  classification: ClassificationResult,
  memory: AssistantMemory,
): boolean =>
  (ReplyEngineService.prototype as any).isCheckoutCommitOnFullCart.call(
    {},
    classification,
    memory,
  );

const classification = (
  over: Partial<ClassificationResult> & { entities?: Record<string, unknown> } = {},
): ClassificationResult =>
  ({
    primaryIntent: 'ready_to_order',
    recommendedAction: 'start_checkout',
    slotAction: 'confirmation',
    entities: {},
    confidence: 0.99,
    conversationStage: 'checkout',
    sentiment: 'neutral',
    dialogueAct: 'confirms',
    ...over,
  }) as unknown as ClassificationResult;

/** Cart of 1, bot just asked "додати ще щось чи оформлюємо?" */
const cartMemory = (over: Partial<AssistantMemory> = {}): AssistantMemory =>
  ({
    cartItems: [
      {
        productId: 'p1',
        variantId: 'v1',
        externalProductId: null,
        externalVariantId: null,
        title: 'Сукня міді базова',
        variantName: 'Чорний / M',
        price: 1500,
        currency: 'UAH',
      },
    ],
    selectionState: 'cart_item_added',
    lastAction: 'asked_continue_or_checkout',
    selectedCategory: 'Штани',
    ...over,
  }) as unknown as AssistantMemory;

describe('isCheckoutCommitOnFullCart', () => {
  describe('fires on a real checkout commit', () => {
    it('passing run: ready_to_order / start_checkout', () => {
      expect(predicate(classification(), cartMemory())).toBe(true);
    });

    // THE BUG. Identical input to the case above, temperature 0, but the
    // classifier emitted ask_delivery instead of start_checkout. The old gate
    // demanded recommendedAction === 'start_checkout' and missed → empty search
    // → 0 rows → product_not_found handoff → lost sale.
    it('failing run: ready_to_order / ask_delivery (the regression)', () => {
      expect(
        predicate(
          classification({ recommendedAction: 'ask_delivery' }),
          cartMemory(),
        ),
      ).toBe(true);
    });

    // Second flavour, from real conversation_traces: the classifier leaked a
    // stale category from history. Equal to the focused category ⇒ a leak, not
    // a pivot.
    it('leaked category equal to the focused one', () => {
      expect(
        predicate(
          classification({
            primaryIntent: 'confirm_choice',
            recommendedAction: 'ask_continue_or_checkout',
            entities: { category: 'Штани' },
          }),
          cartMemory({ selectedCategory: 'Штани' } as Partial<AssistantMemory>),
        ),
      ).toBe(true);
    });

    it('customer jumps straight to delivery details', () => {
      expect(
        predicate(
          classification({ primaryIntent: 'provide_details', slotAction: 'fills_missing_slot' }),
          cartMemory(),
        ),
      ).toBe(true);
    });
  });

  describe('stands down when the customer is not committing', () => {
    it('category PIVOT — different category is a real search', () => {
      expect(
        predicate(
          classification({ entities: { category: 'Взуття' } }),
          cartMemory({ selectedCategory: 'Штани' } as Partial<AssistantMemory>),
        ),
      ).toBe(false);
    });

    it('names a product — customer is shopping, not checking out', () => {
      expect(
        predicate(
          classification({ entities: { productName: 'Zara midi сукня' } }),
          cartMemory(),
        ),
      ).toBe(false);
    });

    it('adds_to_cart ("і ще спідницю") must still search', () => {
      expect(
        predicate(classification({ slotAction: 'adds_to_cart' }), cartMemory()),
      ).toBe(false);
    });

    it('rejection ("ні, ще подивлюсь")', () => {
      expect(
        predicate(classification({ slotAction: 'rejection' }), cartMemory()),
      ).toBe(false);
    });

    // R3: a genuine product question with a cart in flight must still escalate
    // on 0 rows — otherwise the turn has no routing exit.
    it('product question with a cart ("у вас є кросівки?") still escalates', () => {
      expect(
        predicate(
          classification({
            primaryIntent: 'product_inquiry',
            recommendedAction: 'show_products',
            slotAction: 'asks_question',
            entities: { productName: 'кросівки' },
          }),
          cartMemory(),
        ),
      ).toBe(false);
    });

    // R1: a confirmation-shaped turn answering something OTHER than the
    // continue-or-checkout question.
    it('"так" to an FAQ — wrong lastAction', () => {
      expect(
        predicate(
          classification(),
          cartMemory({ lastAction: 'answered_faq' } as Partial<AssistantMemory>),
        ),
      ).toBe(false);
    });

    it('empty cart', () => {
      expect(
        predicate(classification(), cartMemory({ cartItems: [] } as Partial<AssistantMemory>)),
      ).toBe(false);
    });

    it('cart exists but selection state moved on', () => {
      expect(
        predicate(
          classification(),
          cartMemory({ selectionState: 'confirmed' } as Partial<AssistantMemory>),
        ),
      ).toBe(false);
    });
  });

  /**
   * The load-bearing invariant. Layer 2 lets both `product_not_found` handoff
   * sites stand down on this predicate — which is only safe because the
   * predicate is a strict SUBSET of 5.5a-2's trigger, so a suppressed handoff
   * always lands on `collect_checkout_info` instead of stranding the turn with
   * no routing exit.
   *
   * Mirrors 5.5a-2 (`resolveVariantSelection`, reply-engine.service.ts). If that
   * trigger changes and this test fails, the handoff guards are no longer safe.
   */
  describe('INVARIANT: predicate ⊆ 5.5a-2 trigger (no dead states)', () => {
    const fires5_5a_2 = (c: ClassificationResult, m: AssistantMemory): boolean =>
      (c.slotAction === 'confirmation' ||
        c.primaryIntent === 'ready_to_order' ||
        c.primaryIntent === 'provide_details') &&
      m.selectionState === 'cart_item_added' &&
      !!m.cartItems?.length &&
      m.lastAction === 'asked_continue_or_checkout';

    const intents = ['ready_to_order', 'provide_details', 'confirm_choice', 'product_inquiry'];
    const actions = ['start_checkout', 'ask_delivery', 'ask_continue_or_checkout', 'show_products'];
    const slots = [
      'confirmation',
      'fills_missing_slot',
      'adds_to_cart',
      'rejection',
      'asks_question',
    ] as const;
    const entities = [{}, { category: 'Штани' }, { category: 'Взуття' }, { productName: 'Zara' }];
    const lastActions = ['asked_continue_or_checkout', 'answered_faq'];

    it('every input where the predicate is true also fires 5.5a-2', () => {
      let trueCases = 0;
      for (const primaryIntent of intents)
        for (const recommendedAction of actions)
          for (const slotAction of slots)
            for (const ents of entities)
              for (const lastAction of lastActions) {
                const c = classification({
                  primaryIntent,
                  recommendedAction,
                  slotAction,
                  entities: ents,
                });
                const m = cartMemory({ lastAction } as Partial<AssistantMemory>);
                if (predicate(c, m)) {
                  trueCases++;
                  expect(fires5_5a_2(c, m)).toBe(true);
                }
              }
      // Guard against the assertion passing vacuously.
      expect(trueCases).toBeGreaterThan(0);
    });
  });
});

/**
 * `isPivotToDifferentProduct` — the single definition of "the customer changed
 * their mind", and the gate on block 4.6c.
 *
 * It has to be exactly as wide as the pivots and no wider. Too narrow and a
 * cancelled item ships (men_demo_checkout_abandon_pivot) or a new product is
 * never searched for (men_demo_history_leak_pivot). Too wide and it fires on a
 * bare "M" or a "так" — wiping the variant mid-flow and breaking the cart add.
 * The dangerous direction is the second one, so most of these are negatives.
 */
const proto = ReplyEngineService.prototype as any;
const isPivot = (
  classification: ClassificationResult,
  memory: AssistantMemory,
): boolean =>
  proto.isPivotToDifferentProduct.call(
    { namesTheSameThing: proto.namesTheSameThing },
    classification,
    memory,
  );

/** Jeans in focus, size M resolved, awaiting the customer's "так". */
const focusedOnJeans = (over: Partial<AssistantMemory> = {}): AssistantMemory =>
  ({
    selectedProductId: 'jeans-1',
    selectedProductTitle: 'Джинси МОМ світлі',
    selectedCategory: 'Джинси',
    selectedVariantId: 'v-m',
    selectedVariantName: 'M',
    selectionState: 'awaiting_confirmation',
    ...over,
  }) as unknown as AssistantMemory;

describe('isPivotToDifferentProduct', () => {
  describe('IS a pivot', () => {
    it('names a different product ("А тепер хочу замовити сорочку")', () => {
      expect(
        isPivot(
          classification({
            slotAction: 'new_inquiry',
            entities: { productName: 'Сорочка', category: 'Сорочки' },
          }),
          focusedOnJeans(),
        ),
      ).toBe(true);
    });

    it('names only a different CATEGORY — the checkout-abandon shape', () => {
      // The real recorded classifier output: it hands us the product they
      // pivoted TO and nothing else. No productName at all.
      expect(
        isPivot(
          classification({ slotAction: 'correction', entities: { category: 'Шорти' } }),
          focusedOnJeans({ selectionState: 'confirmed' } as Partial<AssistantMemory>),
        ),
      ).toBe(true);
    });

    it('a generic noun that titlesOverlap() would call "the same product"', () => {
      // titlesOverlap strips TITLE_GENERIC_NOUNS (сорочка, футболка…), leaving
      // an empty token set, and answers "same" — which is why this predicate
      // must not use it.
      expect(
        isPivot(
          classification({ slotAction: 'new_inquiry', entities: { productName: 'сорочку' } }),
          focusedOnJeans(),
        ),
      ).toBe(true);
    });

    it('a different product that merely SHARES a word with the focused one', () => {
      // clothes-store `adds_to_cart_different_product`. "Color Veil Terracotta"
      // and "Silk Color Collection Помада" are different lipsticks that both
      // contain the word "Color". titlesOverlap matches on any shared token and
      // called them the same, so 4.6 kept the old product locked and never
      // searched for the new one.
      expect(
        isPivot(
          classification({
            slotAction: 'new_inquiry',
            entities: { productName: 'Color Veil Terracotta', category: 'Помада' },
          }),
          {
            selectedProductId: 'p1',
            selectedProductTitle: 'Silk Color Collection Помада',
            selectedCategory: 'Помада',
          } as unknown as AssistantMemory,
        ),
      ).toBe(true);
    });
  });

  describe('is NOT a pivot — the turns the flow depends on', () => {
    it('bare "M" reply, with the category leaked forward from history', () => {
      // The classifier carries entities.category on nearly every turn. If this
      // counted as a pivot, the variant would be wiped on the very turn that
      // resolves it.
      expect(
        isPivot(
          classification({
            slotAction: 'fills_missing_slot',
            entities: { category: 'Джинси', size: 'M' },
          }),
          focusedOnJeans(),
        ),
      ).toBe(false);
    });

    it('the same product named again ("Джинси" vs "Джинси МОМ світлі")', () => {
      expect(
        isPivot(
          classification({ slotAction: 'new_inquiry', entities: { productName: 'Джинси' } }),
          focusedOnJeans(),
        ),
      ).toBe(false);
    });

    it('"так" with no entities at all', () => {
      expect(
        isPivot(classification({ slotAction: 'confirmation', entities: {} }), focusedOnJeans()),
      ).toBe(false);
    });

    it('an FAQ detour ("а як доставка?") carrying no product entities', () => {
      expect(
        isPivot(
          classification({ primaryIntent: 'delivery_question', slotAction: 'asks_question', entities: {} }),
          focusedOnJeans(),
        ),
      ).toBe(false);
    });

    it('nothing in focus yet — a first message can never be a pivot', () => {
      expect(
        isPivot(
          classification({
            slotAction: 'new_inquiry',
            entities: { productName: 'Сорочка', category: 'Сорочки' },
          }),
          {} as AssistantMemory,
        ),
      ).toBe(false);
    });

    it('the SAME product, worded differently by the classifier', () => {
      // Recorded from pilot-store `cart_remove_buy_one`: the customer says
      // «хочу тільки Nude Pink» and the classifier renders the focused product
      // as "Silk Color Помада" while memory holds "Silk Color Collection
      // Помада". Plain substring says "different" — a false pivot that emptied
      // the cart. titlesOverlap (which strips the generic noun "помада") is the
      // second opinion that catches it.
      expect(
        isPivot(
          classification({
            slotAction: 'correction',
            entities: {
              productName: 'Silk Color Помада',
              category: 'Помада',
              color: 'nude pink',
            },
          }),
          {
            selectedProductId: 'p1',
            selectedProductTitle: 'Silk Color Collection Помада',
            selectedCategory: 'Помада',
          } as unknown as AssistantMemory,
        ),
      ).toBe(false);
    });

    it('a category that is really the focused product NAME (selectedCategory pollution)', () => {
      // `memory.selectedCategory = entities.category ?? searchKeywords[0]`, so a
      // productName-only search leaves a product name in the category slot.
      // Exact equality would call an incoming "Джинси" a pivot away from
      // "Джинси МОМ світлі" and wipe the selection mid-flow.
      expect(
        isPivot(
          classification({ slotAction: 'new_inquiry', entities: { category: 'Джинси' } }),
          {
            selectedProductId: 'p1',
            selectedProductTitle: 'Джинси МОМ світлі',
            selectedCategory: 'Джинси МОМ світлі',
          } as unknown as AssistantMemory,
        ),
      ).toBe(false);
    });
  });
});

/**
 * `matchCartItems` — which cart items a raw message names. Drives 4.6c's
 * remove-if-named branch and the ask-answer matcher. The safety property is
 * one-directional: it may return 0 or 2 (→ the engine asks), but it must never
 * return exactly-one for the WRONG item.
 */
const matchCartItems = (
  cart: NonNullable<AssistantMemory['cartItems']>,
  rawMessage: string,
): NonNullable<AssistantMemory['cartItems']> =>
  (ReplyEngineService.prototype as any).matchCartItems.call(
    { namesTheSameThing: (ReplyEngineService.prototype as any).namesTheSameThing },
    cart,
    rawMessage,
  );

const cartItem = (title: string, variantName: string) =>
  ({
    productId: title,
    variantId: `${title}-${variantName}`,
    externalProductId: null,
    externalVariantId: null,
    title,
    variantName,
    price: 0,
    currency: 'UAH',
  }) as NonNullable<AssistantMemory['cartItems']>[number];

describe('matchCartItems', () => {
  const cart = [
    cartItem('Джинси МОМ світлі', 'M'),
    cartItem('Сорочка з льону', 'L'),
  ];

  it('a bare product word names its cart item', () => {
    const m = matchCartItems(cart, 'джинси');
    expect(m.map((i) => i.title)).toEqual(['Джинси МОМ світлі']);
  });

  it('the removed item inside a full sentence («джинси не треба — покажіть шорти»)', () => {
    // The pivot target «шорти» is not in the cart, so only the jeans match.
    const m = matchCartItems(cart, 'стоп, джинси не треба — покажіть краще шорти');
    expect(m.map((i) => i.title)).toEqual(['Джинси МОМ світлі']);
  });

  it('names nothing in the cart → no match (the ask path)', () => {
    expect(matchCartItems(cart, 'стоп, покажіть краще шорти')).toHaveLength(0);
  });

  it('a pivot target that is not in the cart matches nothing', () => {
    expect(matchCartItems(cart, 'а краще дайте Zara midi')).toHaveLength(0);
  });

  it('a token shared by two cart items matches BOTH → never a lone wrong guess', () => {
    const shared = [
      cartItem('Джинси МОМ світлі', 'M'),
      cartItem('Шорти джинсові світлі', 'L'),
    ];
    // "світлі" is in both titles; the engine sees 2 and asks rather than guess.
    expect(matchCartItems(shared, 'світлі').length).toBe(2);
  });
});
