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
