/**
 * Deterministic coverage for the 5.5o confirmation guard in
 * `handleVariantUnavailable`.
 *
 * Prod conv 3c685eaa, turn 6: XL was selected and awaiting confirmation, the
 * customer said a bare "Так", and the classifier had LEAKED an out-of-catalog
 * size ("XXXL") onto that turn. 5.5o acted on the leaked size with no slotAction
 * guard and told the customer their confirmed XL was unavailable — wiping the
 * sale. A leak is non-deterministic, so a simulator scenario can't pin it; these
 * tests drive `handleVariantUnavailable` directly with the exact shapes.
 *
 * We exercise the guard through the prototype with a stubbed `this` — the guard
 * lives at the top of the method and only touches `entityEchoedInText` (a real
 * prototype method) and the ctx it's handed.
 */
import { ReplyEngineService } from './reply-engine.service';

type Ctx = {
  productData: Array<{
    product: { id: string };
    variants: Array<{ size: string | null; effectiveAvailable: number }>;
  }>;
  classification: any;
  memory: any;
  trace: string[];
  isFirstProductPresentation?: boolean;
};

// Real prototype method bound onto a minimal `this`, plus the private helpers
// the guard reaches. `buildAvailableVariantsList` is only hit AFTER the guard,
// so a throwing stub proves the guard short-circuited when it should.
const run = (input: { messageText: string }, ctx: Ctx): Promise<void> => {
  const self = {
    entityEchoedInText: (ReplyEngineService.prototype as any).entityEchoedInText,
    translateColor: () => [] as string[],
    buildAvailableVariantsList: (v: unknown[]) => v,
  };
  return (ReplyEngineService.prototype as any).handleVariantUnavailable.call(
    self,
    input,
    ctx,
  );
};

const tshirtCtx = (over: Partial<Ctx['classification']>, memoryOver: any = {}): Ctx => ({
  productData: [
    {
      product: { id: 'p-tshirt' },
      variants: [
        { size: 'S', effectiveAvailable: 5 },
        { size: 'M', effectiveAvailable: 5 },
        { size: 'L', effectiveAvailable: 5 },
        { size: 'XL', effectiveAvailable: 5 },
      ],
    },
  ],
  classification: {
    primaryIntent: 'confirm_variant_available',
    recommendedAction: 'confirm_variant_available',
    slotAction: 'confirmation',
    entities: {},
    ...over,
  },
  memory: {
    selectedProductId: 'p-tshirt',
    selectedVariantId: 'v-xl',
    selectedVariantName: 'XL',
    selectionState: 'awaiting_confirmation',
    ...memoryOver,
  },
  trace: [],
});

describe('handleVariantUnavailable — 5.5o confirmation guard', () => {
  it('bare "Так" with a LEAKED size does NOT become variant_not_available', async () => {
    // The bug: classifier leaked size XXXL onto a pure confirmation.
    const ctx = tshirtCtx({ slotAction: 'confirmation', entities: { size: 'XXXL' } });
    await run({ messageText: 'Так' }, ctx);
    expect(ctx.classification.primaryIntent).toBe('confirm_variant_available');
    expect(ctx.classification.primaryIntent).not.toBe('variant_not_available');
    expect(ctx.memory.selectedVariantName).toBe('XL'); // selection preserved
    expect(ctx.trace.some((t) => t.includes('skip (leaked entity)'))).toBe(true);
  });

  it('leaked COLOR on a bare confirmation is also skipped', async () => {
    const ctx = tshirtCtx({ slotAction: 'confirmation', entities: { color: 'синій' } });
    await run({ messageText: 'Так' }, ctx);
    expect(ctx.classification.primaryIntent).toBe('confirm_variant_available');
  });

  it('a size the customer ACTUALLY typed still routes to variant_not_available', async () => {
    // "XXXL" is genuinely in the text → not a leak → guard must NOT skip.
    const ctx = tshirtCtx({ slotAction: 'confirmation', entities: { size: 'XXXL' } });
    await run({ messageText: 'а XXXL є?' }, ctx);
    expect(ctx.classification.primaryIntent).toBe('variant_not_available');
  });

  it('a genuine size correction (fills_missing_slot) is unaffected by the guard', async () => {
    const ctx = tshirtCtx(
      { slotAction: 'fills_missing_slot', entities: { size: 'XXXL' } },
      { selectedVariantId: undefined, selectedVariantName: undefined, selectionState: 'awaiting_variant' },
    );
    await run({ messageText: 'ні, XXXL' }, ctx);
    expect(ctx.classification.primaryIntent).toBe('variant_not_available');
  });

  it('confirmation but NO variant selected yet → guard does not apply, real OOS still reported', async () => {
    const ctx = tshirtCtx(
      { slotAction: 'confirmation', entities: { size: 'XXXL' } },
      { selectedVariantId: undefined, selectedVariantName: undefined },
    );
    await run({ messageText: 'Так' }, ctx);
    // Without a selected variant there is nothing to protect; behave as before.
    expect(ctx.classification.primaryIntent).toBe('variant_not_available');
  });
});
