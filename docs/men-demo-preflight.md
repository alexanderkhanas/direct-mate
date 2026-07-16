# Men-Demo Preflight

`men-demo-store` is the tenant prospects poke during cold outreach. It is the
one place where a broken turn costs a deal, so it gets a preflight.

## Why this tenant is fragile

It is **DB-only**. Unlike `demo-women-clothes` and `demo-cosmetics`, there is no
seed builder that recreates it — it was authored in prod and copied down. That
means:

- **Never reseed it.** A reseed hard-deletes with CASCADE and takes its
  conversations with it. There is no recovery path.
- **Config changes go through idempotent, `is_demo`-scoped backfill scripts**
  (`backfill-show-price-with-variants.ts`, `backfill-demo-hardening.ts`), never
  through a seed rerun.
- **Silent drift is the real risk**: a stray admin-panel save, a half-applied
  backfill, a local DB rebuilt from a stale dump. The local copy was once found
  with `is_demo = false`, which silently excluded it from every `is_demo`-scoped
  backfill — nothing errored, the tenant just quietly stopped receiving fixes.

`npm run verify:men-demo` exists to catch exactly that.

## Before a cold-reach session

Run from `apps/api/`:

```bash
# 1. Config drift — catalog, prices, stock, templates, FAQ, size charts,
#    store config, is_demo flag. Read-only; exits 1 on drift.
npm run verify:men-demo

# 2. Behavior — the full scenario suite against the live engine + live LLM.
#    Gating scenarios must pass (exit 0). Flaky failures are reported
#    separately and do not gate: they are phrasing-sensitive, not broken.
npm run simulate -- --tenant men-demo-store

# 3. Eyeball the demo widget: one happy path (browse → size → order) and one
#    handoff (ask for a human) — the two things a prospect always tries.
#    The handoff must ANNOUNCE itself ("передаю розмову менеджеру"), never
#    leave the thread silent. In the widget there is no manager to pick it
#    up, so silence there is permanent.
```

If step 1 reports drift:

- **Intentional** (a price genuinely changed in prod) → review it, then
  `npm run snapshot:men-demo` to re-freeze.
- **Not intentional** → `npm run restore:men-demo`. It repairs the `is_demo`
  flag, templates and FAQ items in place, never deletes, and never touches
  conversations, customers or orders. Catalog drift is reported but not
  auto-repaired — a changed product is a business decision, not corruption.

## The catalog the scenarios assume

Four size-only products (no colour axis), every variant in stock:

| Product | Price | Sizes | Notes |
|---|---|---|---|
| Сорочка з льону | 1599 | S/M/L | story media `17934760002319883` |
| Шорти джинсові світлі | 1199 | S/M/L | story media `17889274518596043` |
| Футболка базова чорна | 699 | S/M/L/**XL** | the only product with XL |
| Джинси МОМ світлі | 1499 | S/M/L | no XL |

All four carry descriptions (material / colour / fit / care / shrinkage).
Anything **outside** those fields — country of origin, exact centimetres — must
hand off rather than be improvised. That boundary is what
`men_demo_product_question_answered_from_description` and
`men_demo_product_question_not_covered_handoff` pin down, and it is the single
most important property to keep green: a demo bot that invents a plausible
measurement is worse than one that says "let me check".

`flow_config = {}` → size help resolves to **chart mode** (send the size chart,
ask which size), not the height/weight measurements flow.

## What the suite covers

40 scenarios. Beyond the original regression set (derived from prod traces
`ad5e44ac`, `37fb5032`, `f73b4cc1`), the cold-reach hardening suite covers six
families of demo-breaking behavior:

1. **Context retention deep in a dialogue** — re-asked questions, a 9-turn
   thread with FAQ detours, a size stated in the first message, switching
   between two products and back.
2. **Intent change mid-deal** — abandoning checkout for another product
   (the cancelled item must leave the cart), haggling after agreeing, asking
   for a human mid-checkout, restarting on a different product.
3. **Graceful degradation** — exact measurements, pressure to "just estimate",
   a product outside the four, a colour that does not exist. The bot escalates
   instead of inventing.
4. **Messy real people** — slang and typos, two questions in one message,
   one-word turns, Russian/surzhyk phrasing.
5. **Break attempts** — aggressive discount demands, off-topic small talk,
   admin impersonation / prompt injection, rudeness.
6. **The clean baseline** — greeting → browse → order, and the decisive buyer
   who names product and size up front.

Scenarios marked `flaky: true` are phrasing-sensitive (the classifier is a live
LLM). They are reported separately and do not gate the exit code. A flaky
scenario failing **repeatedly** is a classifier signal, not noise — feed it to
`npm run eval:classifier`.
