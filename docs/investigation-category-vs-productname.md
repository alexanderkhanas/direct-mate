# Investigation: category-vs-productName confusion — verification of the prior report

**Date:** 2026-07-12 · **Mode:** read-only, empirical · **Verdict: the prior report is wrong on all three mechanisms, and its Bug 1 fix would make the failure WORSE.**

Note: no prior report file exists in the repo; I verified against the three claims as summarised in the brief.

---

## Section 1 — Bug 1 verification: **REFUTED as stated**

15 product-type nouns classified against luxe-space's real 25-category list (`gpt-5.4-mini`, v1 prompt):

| verdict | n | % |
|---|---|---|
| productName only | **0** | **0%** |
| **both** productName + category | 10 | 67% |
| category only (the reported bug) | 4 | 27% |
| neither | 1 | 7% |

Claim was "classifier emits `category` **instead of** `productName`". Reality: it emits `category`
in **93%** of cases, and in **67%** it emits *both*. Category-only occurs 27% — below the report's
own 30% "edge case" threshold.

**The flagship case is classified CORRECTLY:**
`"Балетки"` → `productName="Балетки"`, `category="Взуття"`. "Балетки" is not one of the 25
categories; mapping it to Взуття is a *correct generalisation*, not a misextraction. Same for
`Кросівки`/`Кеди` → Взуття, `Худі` → Верхній одяг.

Category-only cases (`Топ`→Топи, `Штани`→Штани, `Ремінь`→Аксесуари, `Окуляри`→Окуляри) are all
ones where the noun **is** a catalog category — arguably also correct.

**There is no Bug 1.** The classifier is doing the right thing.

---

## Section 2 — Bug 2 verification: **REFUTED as stated; a different, real bug found**

Claim: "engine skips M2M category filter when `entities.category` matches the denormalized
`products.category`".

The denormalized column is **not a skip** — it is an `OR` branch *inside* the M2M matcher
(`availability.service.ts:399-404`):
```sql
EXISTS (SELECT 1 FROM product_categories pc JOIN categories c … WHERE lower(c.name)=lower(:cat))
OR lower(pp.category) = lower(:cat)
```
It is a compatibility fallback for tenants that don't populate the M2M (demo seeds). It *widens*
the category match; it never bypasses it.

**The real bug — a silent category drop on zero results.** `checkAll`:
- `availability.service.ts:254-259` — if `dto.category`, call `searchAllByCategoryName(cat, searchTerms)`.
  That query requires category match **AND** every search term to appear in `title` or
  `search_keywords` (`:381-390`).
- `availability.service.ts:265-274` — **if that returns 0 rows, control falls through to
  `searchAllByTitle` with the category constraint silently discarded.**

So a *correctly extracted* category is thrown away exactly when it would have been most protective,
and the search widens to the whole catalog. This is the actual defect, and it is one line of control
flow, not a filter-skip.

---

## Section 3 — Bug 3: **mechanism REFUTED; the pattern is real but mislocated**

**Trigram is not on this path.** `similarity()` appears only at `availability.service.ts:207-211`,
inside `check()`. The reply engine calls **`checkAll` only** (4 call sites); `check()` is reached
solely from `availability.controller.ts:17` (admin). The engine's matcher is
**`ILIKE '%term%'` substring**, backed by a pg_trgm GIN *index* — the index is trigram, the predicate
is not. The report conflated the two.

**The polluter is `search_keywords`, not the title.** `searchAllByTitle` (`:312-327`) matches
`title ILIKE :q **OR** search_keywords ILIKE :q`.

Products carrying ≥2 distinct product-type nouns:

| tenant | products | in TITLE | in title+search_keywords |
|---|---|---|---|
| luxe-space | 255 | **6 (2.4%)** | **50 (19.6%)** |
| showcase-women-clothes | 10 | 0 (0%) | **5 (50%)** |
| clothes-store | 93 | — | `search_keywords` **not populated** |
| demo-women-clothes | 19 | — | `search_keywords` **not populated** |

Titles are clean. The AI-enriched blob cross-contaminates: `Nanushka жіночі штани` carries `сукн`;
`Polo Ralph Lauren джинси` carries `штан`. This is partly *by design* (synonym expansion:
`сорочка блузка shirt`), which is why it cannot simply be deleted.

**Blast radius is confined to luxe-space + showcase** — the only two tenants with a populated blob.

**I could not reproduce the flagship case.** `"балетки"` matches **0 products in every local
catalog**. "Джинси МОМ Балетки" does not exist locally; it must come from the prod luxe-space
Torgsoft import. Evidence missing: prod catalog access. The *pattern* is confirmed; the specific
product is not.

---

## Section 4 — Vector search assessment: **NOT warranted**

**Would fixing Bug 1 alone remove Bug 3 exposure? No — it would GUARANTEE it.**
Trace it. With `productName="Балетки"` and **no** category:
- `reply-engine.service.ts:4883` `extractSearchKeywords` → `["Балетки"]`
- `searchProducts:5034` (category-only path) — skipped, needs a category
- `:5063` (category+multi-keyword path) — skipped, needs a category
- → per-keyword loop `:5088` → `checkAll({query:'балетки', category: undefined})`
- → `dto.category` falsy → `searchAllByCategoryName` **never called** → straight to the
  unconstrained `title OR search_keywords` ILIKE.

**The category is the only thing standing between the query and the cross-category blob match.**
The report's Bug 1 fix removes it. This is the single most important finding here.

**Simpler alternatives to vector search, in ascending cost:**
1. **Don't drop the category on zero results** (`:265-274`). Return "no products in that category"
   rather than widening. Eliminates the entire cross-category false-positive class outright.
2. **Word-boundary match** instead of naked substring — `\mбалетк` regex or a `to_tsquery` — kills
   substring artefacts (`одяг` inside `одягу`, the exact class the M2M rewrite already fixed once).
3. **Rank title matches above `search_keywords` matches** rather than OR-ing them flat, so the blob
   can only ever break ties.
4. **Constrain the blob at write time** (n8n Normalize step) so a pants product stops emitting `сукня`.

Fix 1 alone resolves the reported scenario. Fixes 1-3 are engine-local, no schema change, no backfill.

**Vector search cost:** pgvector extension + schema migration, an embedding pipeline (per-product, at
sync time, with a paid embedding call), a backfill across every tenant catalog (255 + 93 + …), a
similarity threshold to tune per tenant, and regression testing of every search-touching scenario —
all to fix a **precision** problem that is currently caused by *deliberately discarding the one
precise signal we already have*. **Recommendation: unwarranted.** Revisit only if semantic recall
(synonyms, paraphrase, cross-lingual) becomes a goal in its own right — that is a different problem
from this bug.

---

## Section 5 — Interaction: **one cascading failure, not three bugs**

The chain, in order:
1. Classifier correctly emits `productName="Балетки"` **+** `category="Взуття"` (67% both-case).
2. `searchProducts` (`:5034`/`:5063`) — a **single** keyword + category matches *neither* special
   path, so it lands in the per-keyword loop. (Path 1 needs 0 keywords, path 2 needs >1. **Exactly one
   keyword falls in the gap** — the single most common shape for "Балетки".)
3. `searchAllByCategoryName` runs with category AND term → 0 rows (the catalog genuinely lacks a
   Взуття product whose title/blob says "балетки").
4. **`checkAll:265` silently drops the category** and re-searches title+blob unconstrained.
5. The blob's cross-contamination (19.6% of luxe-space) surfaces an unrelated product.

**Dependencies:**
- "Bug 2" (the real one, step 4) is the **necessary and sufficient** link. Without the silent drop,
  step 5 is unreachable.
- "Bug 3" (blob pollution) is only *exploitable* through step 4. It is a latent hazard, not an
  independent bug.
- "Bug 1" does not exist; and *forcing* it (productName-only) **removes the step-3/4 guard entirely**
  and hard-wires the failure.

So: **one bug (the zero-result category drop), one latent hazard (blob pollution), one non-bug.**

---

## Section 6 — Broader extraction patterns: **INSUFFICIENT EVIDENCE**

Only **22 traces** exist in the local `conversation_traces` (12 with category, 5 with productName,
5 with both). All observed categories are legitimate (`Джинси`, `Сукні`, `Сорочки`, `Помада`,
`Маски`); no misextracted brands or colors visible.

That sample is far too small to characterise a distribution, and local traces were largely cleared
during this session's testing. **Evidence needed: a prod `conversation_traces` export.** I am not
reporting a distribution I cannot support.

One *related* extraction hazard is already documented and independently confirmed:
`docs/brittleness-productname-literal-matching.md` — `productName` is used as a literal substring key,
so phrasing changes silently break product resolution. That is a real broader classifier-coupling
problem; category-vs-productName is not.

---

## Section 7 — Recommended scope

**Fix exactly one thing first: the silent category drop** (`availability.service.ts:265-274`).
It is the sole necessary link in the cascade, it is engine-local, and it needs no schema change.
Ship alone; it should close the reported scenario.

**Do NOT ship the proposed Bug 1 prompt tweak.** It is not a bug, and the "fix" would strip the only
signal preventing the cross-category match. This is an active regression risk.

**Do NOT build vector search for this.** It is disproportionate to a precision bug caused by
discarding a precise signal we already compute.

**Sequence:**
1. Category-drop fix (necessary, sufficient, low risk). Verify against the prod "Балетки" case.
2. *Then re-measure.* If false positives persist, add word-boundary matching + title-over-blob ranking
   (cheap, engine-local).
3. Blob hygiene at ingest (n8n) — separate track, addresses the latent hazard at source.

**Also flag (out of scope, found en route):** the `searchProducts` keyword-count gap — path 1 requires
0 keywords, path 2 requires >1, so a **single** keyword plus a category silently bypasses both
category-aware paths. Worth a look while in this code.

**Cannot close without prod data:** the specific "Джинси МОМ Балетки" product, and the Section 6
distribution.
