# Brittleness: product resolution depends on the classifier's exact wording

**Status:** open — diagnosed, not fixed
**Severity:** high (silent; ends in a `product_not_found` handoff or a wrong product list)
**Found by:** the v2 classifier-prompt experiment (2026-07-12). A prompt change that
altered *nothing but how `entities.productName` is phrased* broke product resolution
across a whole tenant.
**Class:** architectural — an implicit contract between two components, enforced nowhere.

## The short version

`entities.productName` is not treated as a *hint*. It is used as a **literal
substring key** against the catalog title. The classifier must therefore reproduce
enough of the catalog's exact wording — right script, right tokens, no paraphrase —
or resolution silently degrades.

Nothing declares this contract. No type, no comment, no test. The only thing keeping
it true is that the current prompt happens to make the model echo product titles
back verbatim.

## How it actually fails

Catalog (demo-women-clothes) contains two Mango dresses:

```
Mango Сукня міді
Mango Сукня коктейльна
```

The customer says **"Покажіть Mango Сукня міді"**.

| classifier emits | tokens after filtering | titles matched | outcome |
|---|---|---|---|
| `"Mango Сукня міді"` (v1) | `mango`, `сукня`, `міді` | **1** | product locked → next turn's "у вас є XL?" answers from it ✅ |
| `"Сукня Mango"` (v2) | `сукня`, `mango` | **2** | no unique candidate → nothing locked → next turn has no product in focus → empty-keyword search → **0 rows → `product_not_found` handoff** ❌ |

The v2 prompt merely reordered the phrase and dropped the modifier `міді`. It never
said anything false — "Сукня Mango" *is* the product. But `міді` was the only token
distinguishing it from the cocktail dress, and losing it collapsed resolution.

**The damage lands a turn later**, on a message that has nothing to do with product
names ("у вас є XL?"), which is what makes this so hard to spot in the wild.

## The two matchers, and what each demands

**1. `narrowByProductName`** (`reply-engine.service.ts`) — in-memory, AND-of-substrings:

```ts
const nameTerms = productName.toLowerCase().split(/\s+/)
  .filter(t => t.length > 2 && !PRODUCT_NAME_STOP_WORDS.has(t));
const narrowed = productData.filter(p =>
  nameTerms.every(t => p.product.title.toLowerCase().includes(t)));
if (narrowed.length === 0) return productData;   // over-narrow guard
```

Consequences:
- **Every** token must appear in the title (AND, not OR). One paraphrased word → no match.
- Tokens ≤ 2 chars are dropped, so short but meaningful tokens vanish.
- Zero matches quietly returns the **unnarrowed** list — a wrong-product list, not an error.
- Too *few* tokens is as damaging as wrong tokens: it under-discriminates and locks nothing.

**2. `searchProducts`** — the SQL stage (ILIKE `%term%` + trigram fuzzy + `search_keywords`).
More forgiving, but it is fed from `extractSearchKeywords`, which reads only
`productName` and `color`. An unusable `productName` yields an **empty keyword list** →
0 rows → the `product_not_found` handoff.

## Why it is brittle

The classifier is an LLM whose phrasing is not stable, and we are using its free-text
output as a database key. Every one of these silently breaks resolution:

- **Transliteration** — `джек енд джонс` → `Джек енд Джонс` instead of `Jack & Jones`.
  Matching is literal; there is no Cyrillic↔Latin folding. (Already known: CLAUDE.md
  notes the `JACK&JONES` case under `narrowByProductName`'s cross-script note.)
- **Reordering + dropping a modifier** — `Mango Сукня міді` → `Сукня Mango`. The case above.
- **Translation of the noun** — `Сукня` → `Dress` on a Ukrainian catalog.
- **Normalization the catalog didn't do** — accusative→nominative is *wanted*
  (`Сорочку`→`Сорочка`), but only because catalog titles happen to be nominative.
- **A model swap.** claude-haiku-4-5 phrases entities differently from gpt-5.4-mini.
  Any future model change can break product resolution without touching a line of engine code.

The failure is always the same shape and always silent: 0 or N candidates instead of 1,
then a handoff or a wrong list one turn later.

## Fix options (ranked)

**A. Stop using free text as a key — resolve to an ID and pass that.** The real fix.
Give the classifier the last-presented products (it already has `lastPresentedProducts`
in memory context) and have it return a **product index/id** when the customer refers to
one, exactly as indexed picks ("першу") already work. Free-text `productName` then only
seeds the *search*, never the *lock*.

**B. Make the matcher tolerant instead of literal.** Normalize both sides before
comparing: casefold, strip punctuation, transliterate Cyrillic↔Latin, and score by token
overlap (e.g. ≥60% of title tokens present) rather than requiring **every** term. Lock
only on a unique best score above a threshold; otherwise ask. Cheaper than A, and it
removes the whole class of paraphrase failures.

**C. Constrain the classifier's output.** Enum-constrain `productName` to the titles in
`lastPresentedProducts` (the tool schema already does this for `category`). Strongest
guarantee, but only works when the product is already on screen — it cannot help the
first, open-ended query.

**D. Minimum guardrail, if nothing else is done.** Make the coupling *loud*: when
`narrowByProductName` narrows to 0 (over-narrow guard fires) or to >1 while the customer
named a product, emit a trace line and a counter. Today both cases pass silently — which
is exactly why this survived until a prompt experiment happened to trip it.

## Related

- `docs/bug-awaiting-confirmation-pivot-handoff.md` — same terminal symptom
  (empty-keyword search → 0 rows → `product_not_found` handoff), different cause.
- The `handleProductQuestion` gate and the `"оформлюємо"` cart bug were both instances of
  the same broader pattern: **the engine keying deterministic routing off an unstable LLM
  field**. `recommendedAction` was one. `productName` is another, and it is worse — it is
  a free-text key rather than an enum.
