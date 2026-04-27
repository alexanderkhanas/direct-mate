# Onboarding a new businessType

Checklist for adding a new demo vertical (e.g. `men-clothes`,
`sport-supplements`, `electronics`). Walk through every item in order. If
you discover a step missing during your work, add it here for the next
person.

References target the file paths and approximate line ranges where
existing code (clothing + cosmetics) lives — copy the pattern, don't
invent a new one.

---

## 1. Engine — type unions

- [ ] Add the new vertical name to the `businessType` string-literal union in:
  - [apps/api/src/modules/conversations/reply-engine.service.ts](apps/api/src/modules/conversations/reply-engine.service.ts#L621-L626) — `handlePreQualify` dispatcher
  - The `tenantBusinessType` parameter on `classify()` / `classifyWithFallback()` in
    [apps/api/src/modules/engine/classifier.service.ts](apps/api/src/modules/engine/classifier.service.ts#L218-L222)
  - The `buildResponse` `buildResponseBusinessType` annotation in [reply-engine.service.ts](apps/api/src/modules/conversations/reply-engine.service.ts#L1531-L1532)

## 2. Classifier — entity + few-shot rule (only if vertical needs a new entity field)

- [ ] If the vertical needs a new classifier entity (e.g. `dose`, `flavor`,
      `screen_size`), add it to:
  - `ClassificationResult.entities` in
    [apps/api/src/modules/engine/classifier.service.ts](apps/api/src/modules/engine/classifier.service.ts#L8-L27) (camelCase)
  - `CLASSIFY_MESSAGE_TOOL.parameters.entities.properties` in the same file
    [classifier.service.ts:101-114](apps/api/src/modules/engine/classifier.service.ts#L101-L114) (snake_case)
  - The result-construction block that maps snake → camel in `classify()`
    [classifier.service.ts:323-342](apps/api/src/modules/engine/classifier.service.ts#L323-L342)
- [ ] Add a conditional system-prompt rule with **3–4 few-shot examples** for the
      new entity, gated on `tenantBusinessType === '<new-vertical>'`. Mirror
      the cosmetics `cosmeticsRule` block at
      [classifier.service.ts:233-247](apps/api/src/modules/engine/classifier.service.ts#L233-L247).
      No regex / keyword lists — examples only.

## 3. Engine — pre-qualify handler

- [ ] Add a `handlePreQualify<Vertical>` private method to
      [reply-engine.service.ts](apps/api/src/modules/conversations/reply-engine.service.ts) mirroring `handlePreQualifyClothing` / `handlePreQualifyCosmetics`.
      Same shape:
  - read `preQualifyStrategy`
  - short-circuit on `entities.productName` and on the vertical's primary entity
  - yes/no answer to offer (`memory.awaitingPreQualifyAnswer`)
  - `before_search` → ask prompt
  - `after_search_offered` → fall through (offer suffix appended in `buildResponse`)
- [ ] Wire it into the `handlePreQualify` dispatcher
      [reply-engine.service.ts:617-627](apps/api/src/modules/conversations/reply-engine.service.ts#L617-L627).
- [ ] Add memory fields if needed (`recommended<Vertical>?: string`,
      `<vertical>Collected?: boolean`) to `AssistantMemory` in
      [classifier.service.ts:31-66](apps/api/src/modules/engine/classifier.service.ts#L31-L66).
- [ ] Mirror the memory reset blocks for the new fields in
      [reply-engine.service.ts:354-361](apps/api/src/modules/conversations/reply-engine.service.ts#L354-L361)
      and [reply-engine.service.ts:401-407](apps/api/src/modules/conversations/reply-engine.service.ts#L401-L407).

## 4. Engine — buildResponse prefix + offer suffix

- [ ] Add a `buildResponseBusinessType === '<new-vertical>'` block in
      [reply-engine.service.ts:1534-1559](apps/api/src/modules/conversations/reply-engine.service.ts#L1534-L1559) that
      prepends a vertical-specific recommendation prefix (mirror clothing's
      "За вашими параметрами..." or cosmetics' "Для жирної шкіри...").
- [ ] Update the offer-suffix `userAlreadyGavePreQualifyInfo` check
      [reply-engine.service.ts:1568-1571](apps/api/src/modules/conversations/reply-engine.service.ts#L1568-L1571)
      to recognize the new vertical's primary entity.
- [ ] Update the offer-suffix text branch
      [reply-engine.service.ts:1583-1585](apps/api/src/modules/conversations/reply-engine.service.ts#L1583-L1585) with
      a vertical-appropriate offer message.

## 5. Templates — code-as-source

- [ ] Create `apps/api/src/scripts/seed/templates/<vertical>/index.ts`
      exporting `<VERTICAL>_TEMPLATES: TemplateSpec[]`. Mirror
      [templates/clothing/index.ts](apps/api/src/scripts/seed/templates/clothing/index.ts) /
      [templates/cosmetics/index.ts](apps/api/src/scripts/seed/templates/cosmetics/index.ts).
- [ ] **Audit the templates for trailing CTAs** that would collide with the
      engine-appended offer suffix. Drop "Хочете?" / "Підкажіть?" tail-CTAs
      from informational scenarios (`show_products`, `show_price`,
      `recommend_product`, `pre_qualify_with_price`). Keep CTAs only on
      genuine ask scenarios (`ask_*`, `confirm_*`, `collect_checkout_info`).
- [ ] Update `getTemplatesForBusinessType` in
      [templates/index.ts](apps/api/src/scripts/seed/templates/index.ts) to handle
      the new value.

## 6. Seed — data files + builder + entry

- [ ] Add product data under
      `apps/api/src/scripts/seed/data/<vertical>-products.ts` (mirror
      [clothing-women-products.ts](apps/api/src/scripts/seed/data/clothing-women-products.ts) /
      [cosmetics-products.ts](apps/api/src/scripts/seed/data/cosmetics-products.ts)). Image filenames reference
      `apps/api/test-assets/<vertical>/<file>`. NEVER reference external CDNs
      in `imageFile` — download once into `test-assets/`, commit them to
      the repo (parent dir is tracked).
- [ ] Add a seed builder under
      `apps/api/src/scripts/seed/builders/<vertical>-builder.ts` (mirror
      [clothing-builder.ts](apps/api/src/scripts/seed/builders/clothing-builder.ts) /
      [cosmetics-builder.ts](apps/api/src/scripts/seed/builders/cosmetics-builder.ts)).
- [ ] Add a seed entry script `apps/api/src/scripts/seed-demo-<vertical>.ts`
      with the standard 3-step body: `deleteTenantBySlug` →
      `assertNoOrphans` → `build<Vertical>Tenant`.
- [ ] Update `package.json` scripts in [apps/api/package.json](apps/api/package.json):
      `seed:demo:<vertical>`, `seed:demo:prod:<vertical>`. Append to
      `seed:demo:all` and `seed:demo:prod:all`.

## 7. API — slug routing

- [ ] No code change required if the slug starts with `demo-` and matches
      `/^demo-[a-z0-9-]+$/` (validator in [apps/api/src/modules/demo/dto/demo-message.dto.ts](apps/api/src/modules/demo/dto/demo-message.dto.ts)).
- [ ] Verify by running `npm run seed:demo:<vertical>` then restarting the
      API and curling `/demo/message` with `tenantSlug=demo-<vertical>`.

## 8. Frontend — scenarios + tab

- [ ] Add frontend scenarios under
      `apps/admin/src/components/demo/scenarios/<vertical>-scenarios.ts`
      (mirror [clothing-scenarios.ts](apps/admin/src/components/demo/scenarios/clothing-scenarios.ts) /
      [cosmetics-scenarios.ts](apps/admin/src/components/demo/scenarios/cosmetics-scenarios.ts)).
- [ ] Update `getScenariosForTenant` in
      [scenarios/index.ts](apps/admin/src/components/demo/scenarios/index.ts) to handle the new slug.
- [ ] Extend `DemoTenantSlug` union in [scenarios/index.ts](apps/admin/src/components/demo/scenarios/index.ts).
- [ ] Add a tab to `DEMO_TABS` in
      [LandingPage.tsx](apps/admin/src/pages/LandingPage.tsx) — pick a
      lucide icon, set the brandName.

## 9. Simulator scenarios

- [ ] Add simulator scenarios under
      `apps/api/src/scripts/scenarios/<vertical>/index.ts`, split into
      PRIMARY (gating) and EDGE CASE (`flaky: true`, best-effort) per the
      cosmetics convention in
      [scenarios/cosmetics/index.ts](apps/api/src/scripts/scenarios/cosmetics/index.ts).
- [ ] Add a slug constant for the new vertical to
      [scenarios/types.ts](apps/api/src/scripts/scenarios/types.ts) so scenarios reference
      the slug rather than hardcoded UUIDs.
- [ ] Update [scenarios/index.ts](apps/api/src/scripts/scenarios/index.ts) to merge the
      new suite into the global `SCENARIOS` map.

## 10. Verification

- [ ] `cd apps/api && npx tsc --noEmit` clean.
- [ ] `cd apps/admin && npx tsc --noEmit` clean.
- [ ] `npm run seed:demo:all` idempotent (re-run twice → same DB state).
- [ ] DB confirms tenant present with correct businessType and
      preQualifyStrategy: `SELECT slug, flow_config -> 'businessType', flow_config -> 'preQualifyStrategy' FROM tenants t JOIN store_configs sc ON sc.tenant_id=t.id WHERE t.slug LIKE 'demo-%';`.
- [ ] Restart API. Curl smoke matrix (8 paths, mirror the cosmetics matrix
      in the Phase 7 spec) returns expected codes / replies.
- [ ] `npm run simulate -- --all` — PRIMARY scenarios all pass; EDGE CASE
      may flake but reports separately.
- [ ] Manual browser walkthrough on http://localhost:5173 — new tab visible,
      scenarios replay, live mode works, images load from
      `/uploads/<vertical>/`.
- [ ] Verify multi-tenant isolation: `SELECT count(*) FROM products WHERE tenant_id=(SELECT id FROM tenants WHERE slug='demo-<vertical>');` matches expected.

## 11. Documentation

- [ ] Append a new tech-debt entry to root [CLAUDE.md](../CLAUDE.md) if anything
      was deferred (e.g. another column overload, a hardcoded fallback, a
      classifier rule that needs broader test coverage).
- [ ] Update the "Backend (apps/api)" section's "Multi-tenant demo" bullet
      with the new vertical's tenant count.
- [ ] Update the "Demo tenant isolation" section to mention the new
      `is_demo=true` slug.
- [ ] Tick this checklist off and commit it alongside the vertical's PR.
      If you discovered a step that's not on this list, add it before
      committing.
