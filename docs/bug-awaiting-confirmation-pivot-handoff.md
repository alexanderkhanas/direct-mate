# BUG: Changing your mind mid-confirmation hands the customer to a human

**Status:** open — diagnosed, not fixed
**Severity:** high (drops a live sales conversation into a handoff)
**Found by:** `men_demo_history_leak_pivot` simulator scenario (2026-07-12)
**Class:** engine bug — a gate that does not model a product pivot
**Family:** identical shape to the `"оформлюємо"` checkout handoff (fixed) and to
prod trace `37fb5032` (fixed). Third instance of *"gate misses → empty-keyword
search → 0 rows → `product_not_found` handoff"*.

## Symptom

The customer has picked a product and a size and is sitting at the confirmation
prompt. They change their mind and name a **different** product:

```
customer: Хочу замовити джинси         → jeans in focus
customer: M                            → selectionState=awaiting_confirmation
customer: А тепер хочу замовити сорочку
bot:      Секунду, уточню наявність 💛   ← HANDOFF
```

The shirt is in stock. The bot escalates anyway, and `selectedVariantName` stays
`M` (the jeans' size leaks onto the new product).

## Root cause

The first early-return in `shouldSearchProducts`
(`apps/api/src/modules/conversations/reply-engine.service.ts`):

```ts
private shouldSearchProducts(classification, memory): boolean {
  // Product + variant already confirmed and awaiting customer's "так" — no need to search
  if (memory.selectionState === 'awaiting_confirmation' && memory.selectedProductId && memory.selectedVariantId
      && classification.slotAction !== 'correction') {
    return false;                       // ← short-circuits here
  }
  ...
  return (
    searchActions.includes(classification.recommendedAction) ||
    searchIntents.includes(classification.primaryIntent) ||
    namedAProduct ||                    // ← never reached
    (hasEntities && noProductsShownYet)
  );
}
```

The premise "awaiting a `так`, so there is nothing to search for" is right for a
bare confirmation and wrong for a pivot. `namedAProduct` (added to fix a sibling
bug: *a customer who names a product and we hold no data for it, look it up*)
lives in the **final** return, so this early-return jumps clean over it.

Consequence: `needsSearch=false` → `productData` empty → the `product_not_found`
handoff fires (`product_inquiry` is in its intent list) and returns before the
selection state machine (5.5) ever runs.

Verified trace:

```
classify: intent=product_inquiry action=show_products slot=new_inquiry conf=0.98
search: needsSearch=false
template: none found
handoff: product_not_found
```

Note the classifier is **correct** here — `product_inquiry` / `new_inquiry` /
`productName=Сорочка` is exactly right. This is purely an engine routing defect.

## Proposed fix

Add a pivot exception to the early-return, mirroring the `namedAProduct` rule:

```ts
if (memory.selectionState === 'awaiting_confirmation' && memory.selectedProductId && memory.selectedVariantId
    && classification.slotAction !== 'correction'
    && !nonEmptyStr(classification.entities.productName)   // naming a product = pivot → must search
    && classification.slotAction !== 'adds_to_cart') {     // "і ще сорочку" → must search
  return false;
}
```

A bare `"так"` carries no `productName`, so the gate still fires for the case it
was written for. A pivot naming the *same* product ("беру джинси") would now
search and re-hydrate it — harmless, one extra indexed query.

Also to check as part of the fix: the leaked `selectedVariantName=M` must be
cleared on the pivot. The `needsSearch` branch already clears
`selectedVariantId`/`selectedVariantName` on `slotAction === 'correction'`; a
pivot with `new_inquiry` needs the same treatment, or the new product inherits the
old product's size.

## Why it is not fixed yet

The gate is **hot** — it evaluates on every confirmation turn across every tenant.
It needs the full 4-tenant sweep plus the flag-toggle attribution method (run the
whole tenant with the clause on vs off, ≥2 runs per side) before shipping. A single
simulator run cannot attribute a change here: the classifier is non-deterministic
and n=1 comparisons have already produced phantom regressions twice in this
codebase.

## Regression coverage

`men_demo_history_leak_pivot` in
`apps/api/src/scripts/scenarios/men-demo-store/index.ts` (currently marked `flaky`,
so it does not gate the suite — **remove the `flaky` flag once fixed**). It asserts:

- `decision: 'reply'` (never a handoff)
- `replyContains: ['Сорочка з льону']` (the new product actually surfaces)
- `state.selectedVariantName: null` (the jeans' size does not leak onto the shirt)
