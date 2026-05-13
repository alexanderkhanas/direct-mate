# DirectMate — Project Context

## What is DirectMate

A configurable AI sales assistant platform for Instagram DMs. Not a single chatbot — a **platform** where each store configures its own AI agent through an admin panel.

**Core principle: One engine. Many stores. Each store defines behavior through configuration.**

The product goal is to maximize **safe automation** of routine Instagram DM conversations while preserving trust, conversion quality, and fast human handoff for risky or unclear cases.

DirectMate should automate repetitive, low-risk interactions and escalate uncertain, sensitive, or business-critical cases to a human manager.

## Architecture

### Monorepo (npm workspaces)
```
apps/api/        — NestJS backend (TypeORM, PostgreSQL, OpenAI)
apps/admin/      — React + Vite admin panel (TanStack Query, Tailwind, lucide-react)
packages/shared/ — Shared enums/types (compiled to JS before API uses it)
infra/docker/    — Docker Compose (Postgres on port 5433)
```

### Key architectural decisions
- **TypeORM with SnakeNamingStrategy** — camelCase entity props map to snake_case DB columns
- **Manual migrations** (no synchronize) — raw SQL in up/down
- **packages/shared compiled to JS** — not imported as raw TS, workspace symlink resolves it
- **npm workspaces** with `legacy-peer-deps=true` in .npmrc
- **n8n for external orchestration** (Shopify/OpenCart sync workflows) — calls backend internal endpoints
- **InternalApiKeyGuard** for n8n-facing endpoints (`x-internal-key` header)
- **JwtAuthGuard** for admin-facing endpoints
- **Demo tenant isolation** — `tenants.is_demo BOOLEAN`. Demo
  traffic uses one of two tenants: `slug='demo-women-clothes'`
  (clothing vertical, after_search_offered strategy) or
  `slug='demo-cosmetics'` (cosmetics vertical, before_search
  strategy). The legacy `slug='demo'` was hard-deleted in Phase 4
  seed; do not reintroduce it. Analytics queries must filter
  `is_demo=false`. `ordersService` creates no orders for is_demo
  tenants (tech debt: explicit guard pending). Frontend `/demo/message`
  takes optional `tenantSlug` (defaults to `demo-women-clothes`),
  rate limiter keys on `(ip, tenantSlug)` so both tabs have
  independent quota.

### Database
- PostgreSQL in Docker, port **5433** (5432 taken by another project)
- Container name: `docker-postgres-1`, user: `postgres`, db: `directmate`
- Seed script uses raw SQL (`AppDataSource.query()`) to avoid SnakeNamingStrategy issues

### External services
- **OpenAI** — GPT-5.4-mini for classification, GPT-5.4 for handoff verification
- **Meta Instagram API** — webhooks + messaging via `graph.instagram.com/v21.0`
- **n8n** — local Docker instance on port 5678, API key auth
- **Shopify** — GraphQL Admin API (2024-07) via n8n workflows
- **OpenCart** — REST API via n8n workflows

## Current State — What's Built

### Backend (apps/api)
- Auth (JWT + passport-jwt), tenant/user model
- Full database schema (18+ tables) with initial migration
- Instagram webhook handler with debouncing (10s), message_edit fallback, echo filtering
- **Template-based reply engine** with slot-filling flow, AI classification only
- **Business-type-aware engine routing** — `flow_config.businessType` (`'clothing' | 'cosmetics'`) drives
  per-vertical pre-qualify and template selection. Independent of strategy.
- **`preQualifyStrategy` field** (`'before_search' | 'after_search_offered'`) — orthogonal to businessType.
  Defaults: clothing demo → `after_search_offered` (browse + offer size help), cosmetics demo → `before_search`
  (ask skin type immediately). Yes/no detection on offer responses uses `classifier.slotAction`
  (`'confirmation'` / `'rejection'`); negative reply gets a hardcoded short ack (no LLM call).
- **Multi-tenant demo** — 2 demo tenants seeded via per-vertical builders:
  `demo-women-clothes` (18 clothing products, 3 size charts) and `demo-cosmetics` (10 cosmetics products,
  13 variant images served from `/uploads/cosmetics/`). Both `is_demo=true`. Old single `demo` tenant
  was deleted via `seed-demo-women-clothes.ts` Phase 4 transition step.
- **Templates as code** for demo tenants — TypeScript files at `apps/api/src/scripts/seed/templates/`
  (base + clothing + cosmetics) are the single source of truth. `getTemplatesForBusinessType()` merges
  base + vertical at seed time. Production tenants still author templates in DB via the admin panel.
- Product catalog with multi-strategy search (ILIKE + trigram fuzzy on title/category)
- Availability service with stock checking
- Crypto service (AES-256-GCM) for encrypting access tokens
- Shopify connection (manual token paste, encrypted storage)
- Screenshot training pipeline (GPT-4o vision extraction, conversation grouping, review/approve workflow)
- Privacy policy page for Meta app requirements
- Conversation logging to `conversations.log`

### Admin Panel (apps/admin)
- Login, Dashboard, Conversations, Catalog, Connections, Training, Templates, Settings, Logs pages
- Settings: brand tone editor, handoff rules, manager examples (Q&A pairs)
- Templates: CRUD for response templates, phrase blocks, FAQ items with scenario badges
- Connections: Instagram + Shopify connection management
- Training: screenshot upload with drag-and-drop, extraction review with chat-style transcript display

### n8n Workflows (deployed)
- **Shopify: Catalog Sync** — GraphQL, paginated, every 30min
- **Shopify: Inventory Poll Sync** — GraphQL, every 10min
- **Shopify: Connection Health Check** — every 15min
- **OpenCart: Catalog Sync** — REST API with session auth, paginated
- **OpenCart: Inventory Poll Sync** — REST API, paginated
- **OpenCart: Connection Health Check** — API login verification

## AI Architecture — Template-Based with Slot-Filling

### Core principle
**AI classifies only. Templates generate replies. Slot-filling drives the conversation.**

### Reply engine flow
```
message → Classifier (AI: intent + entities + slotAction)
  → Policy Engine (escalation check)
  → Product Search (if entities contain product/category)
  → Selection State Machine (manage product → variant → confirmation slots)
  → Template Engine (pick template by scenario, interpolate {variables})
  → If no template → AI Fallback (only if fallback config allows)
  → Send reply
```

### Classifier output (structured, no reply text)
```json
{
  "primary_intent": "product_inquiry",
  "entities": { "category": "помада", "color": "червона" },
  "conversation_stage": "showing_options",
  "sentiment": "neutral",
  "confidence": 0.95,
  "dialogue_act": "fills_missing_slot",
  "recommended_action": "confirm_selection",
  "slot_action": "fills_missing_slot"
}
```

### Slot Actions (critical for understanding user intent)
- `new_inquiry` — first time asking about something
- `fills_missing_slot` — provides info we asked for (color after variant question)
- `correction` — "ні, я хочу Rosewood" — replaces a previous value
- `confirmation` — ONLY pure "так", "беру", "добре" — no new information
- `rejection` — pure "ні" without new info
- `adds_to_cart` — "і ще крем"
- `asks_question` — "скільки коштує?"

### Selection States (slot-filling flow)
```
awaiting_product       — products shown, user must pick one
awaiting_variant       — product picked, must pick variant (color/size)
awaiting_confirmation  — product + variant resolved, must confirm
confirmed              — all slots filled, ready for checkout
```

**Hard rule: Cannot enter checkout until product + variant + confirmation are all resolved.**

### Variant Matching (hybrid 5-strategy)
1. Exact match
2. Partial/contains ("червон" in "Ягідно-червоний")
3. Normalized match (accent/case insensitive)
4. Word overlap ("червоний" matches "Ягідно-червоний")
5. Fuzzy (Levenshtein distance ≤ 3)

**No fallback to first variant.** If no confident match → ask user to clarify.

### Template System
Templates are store-configurable with variables:
```json
{
  "scenario": "show_price",
  "blocks": ["Ціна на {product_name} — {price} 💛"],
  "required_variables": ["product_name", "price"]
}
```

Available variables:
```
{product_name}, {category}, {color}, {size}, {price}
{product_list}, {variants}, {variant_type}, {variant_list}, {variant_name}
{customer_name}, {phone}, {city}, {delivery_branch}
{order_summary}, {reason}, {matched_variant_id}
```

### Scenarios (template scenarios with Ukrainian labels)
```
greeting                      — Привітання
show_products                 — Показ товарів
show_price                    — Показ ціни
recommend_product             — Рекомендація товару
ask_recommendation_from_shown — Рекомендація зі списку
confirm_selection             — Підтвердження вибору
confirm_last_in_stock         — Останній доступний варіант (опц., fallback → confirm_selection)
decline_selection             — Відмова від вибору (опц., fallback → hardcoded "Окей 💛 Як визначитесь — пишіть.")
ask_variant_choice            — Вибір варіанту
collect_checkout_info         — Збір даних для замовлення
confirm_order                 — Підтвердження замовлення
order_confirmed_ask_delivery  — Запит даних доставки
answer_delivery               — Відповідь про доставку
answer_payment                — Відповідь про оплату
out_of_stock                  — Немає в наявності
product_not_found             — Товар не знайдено
```

### Engine modules
```
apps/api/src/modules/engine/
  classifier.service.ts       — AI classification only (OpenAI function calling)
  template-engine.service.ts  — Template selection, variable interpolation, stage gates
  policy-engine.service.ts    — Escalation rules, confidence thresholds
  store-config.controller.ts  — CRUD for templates, phrase blocks, FAQ, store config
  entities/                   — StoreConfig, ResponseTemplate, PhraseBlock, FaqItem
```

## Key Configurations (Per Store)

Each store configures via `store_configs` table (jsonb columns):

1. **Brand Config** — language, formality, emoji policy, allowed/disallowed phrases
2. **Flow Config** — enabled stages, transitions, progression
3. **Checkout Config** — fields to collect (ПІБ, телефон, місто, НП), collection style
4. **Escalation Config** — always-escalate intents, confidence thresholds, sentiment triggers
5. **Recommendation Config** — mode (single/top-3), attribute priority
6. **Handoff Config** — notification channel (Telegram), pause behavior, summary
7. **Fallback Config** — `strict_templates_only` / `template_first_with_safe_fallback`

Templates, phrase blocks, and FAQ items are separate tables per tenant.

## Screenshot Training Pipeline

1. Upload screenshots → GPT-4o vision extracts transcripts, phrases, voice signals
2. Grouping step clusters fragments into conversations
3. Review/approve in admin panel
4. Approved data → converted to templates, phrases, training examples

## Meta/Instagram Setup

- App ID: configured in .env (META_APP_ID)
- Webhook URL: `https://{ngrok}/channels/instagram/webhook`
- Verify token: `directmate_verify_a3f7b9c2e1d4`
- Uses Facebook Login for Instagram API (not Instagram Login)
- Page Access Token stored encrypted in `connections` table
- `external_account_id` = Instagram Business Account ID from webhook entry.id
- Messages sent via `graph.instagram.com/v21.0/me/messages`
- Both sender and receiver must be app testers in development mode
- Message debouncing: 10s window, collects multiple messages before processing

## Known Issues / TODOs

### Critical — Next Steps
- **Test selection flow end-to-end** — variant matching, corrections, checkout gate
- **Order persistence** — save orders to DB, create draft order in Shopify
- **Manager reply detection** — detect is_echo from manager, pause bot

### Shipped
- **Telegram handoff notifications** — wired and live. Manager gets a Telegram message when the bot escalates a conversation. Channel + behavior configured per-tenant via `flow_config.handoff` (notification channel, pause-on-handoff, summary template).
- **Customer photo matching via pHash** — when a customer attaches an image in DM, [`InstagramContentService.matchCustomerPhoto`](apps/api/src/modules/channels/instagram/instagram-content.service.ts) first tries a 64-bit dHash lookup against `product_media.phash`. Hamming distance ≤ 5 → resolve product (deterministic, no LLM cost, no false positives on visually similar items). Tied minimums or above-threshold → fall through to the existing GPT-4o-mini vision flow against linked instagram_media_mappings, then to handoff. Hashes are computed at sync time in [`catalog.service.ts`](apps/api/src/modules/catalog/catalog.service.ts) when product_media rows are inserted.

### Important
- Long-lived Instagram token exchange (current tokens expire in ~1 hour)
- Multi-product orders (cart with multiple items before checkout)
- Product search: also search in `description` field
- Cross-sell templates after order confirmation
- Admin panel analytics dashboard (conversion, automation rate, response time)

### Technical Debt
- `apps/api/dist/` files were tracked in git (now gitignored)
- `17841400073793607` webhook entries logged as "No connected Instagram account" — second IG Business Account ID, harmless but noisy
- ConnectionsPage has pre-existing TypeScript errors
- Some `as any` casts on TypeORM jsonb column updates
- Shopify sync stores colors in `size` field (selectedOptions[0] → size mapping)
- `DemoMessageBufferService` duplicates production buffer logic in `instagram.service.ts`; refactor to a shared service when per-tenant debounce config or a second channel arrives
- Add a `tenant.is_demo` guard inside `ordersService.createFromConversation()` as belt-and-braces. Current demo path explicitly skips order creation, but a defensive refusal at the orders layer would prevent a future code path from accidentally persisting a demo order
- Multi-process deployments break the in-memory demo buffer (the `Map` is per-process and the same `sessionKey` could land on different workers). Move to Redis when scaling beyond a single replica
- Demo session story is mostly working in 3.1 because `findOrCreateConversation` reuses by `(tenantId, customerId, channel='demo', channelAccountId=sessionKey)`. Step 3.2 adds explicit session TTL/expiry, server-issued sessionKeys, an in-widget "Start new conversation" button, and rate-limit tracking that survives sessionKey rotation
- `DemoBudgetService.chargeEstimate` charges classifier on every demo call and fallback at p=0.20 because `ReplyEngineService` exposes no per-call token usage. Overcounts ~2× on fallback. Replace with real per-call usage telemetry when `ReplyEngineService` plumbs `usage.prompt_tokens` / `completion_tokens` from the OpenAI SDK response
- `DemoRateLimiterService` uses a per-process in-memory `Map` — same multi-process gap as the demo buffer; fold into the same Redis migration when scaling beyond a single replica
- `app.set('trust proxy', true)` in `apps/api/src/main.ts` is permissive — accepts any `X-Forwarded-For`. Tighten to a fixed hop count or a specific subnet once the deploy topology is fixed (Cloudflare → nginx → Node)
- E2E test scaffold (`apps/api/test/jest-e2e.json`, `test/tsconfig.json`, `test/setup-env.ts`, `test/demo/setup.ts`) currently only covers the `/demo` endpoint. Other modules (auth, conversations, channels) have no e2e coverage. Reuse the same config when a second module needs e2e tests
- `preQualifyStrategy` is implemented for clothing + cosmetics business types. Default per vertical: clothing→`after_search_offered`, cosmetics→`before_search`. Per-tenant override via `flow_config.preQualifyStrategy`. Yes/no answer to the offer suffix is detected via `classifier.slotAction` (`'confirmation'` / `'rejection'`). Negative response gets a hardcoded short ack ("Окей 💛 Як визначитесь — пишіть") instead of an AI-generated reply (deviation from Phase 6 spec — see next bullet).
- **Negative-offer reply is hardcoded, not AI-generated**, contrary to the Phase 6 spec's "route to AI fallback" framing. Reasoning: the response space is tiny (one-line ack), determinism + zero LLM cost outweigh tonal variation. If we later want variation per brand voice, we can promote `decline_offer` to a template scenario (one DB row per tenant) — that's still cheaper than per-request LLM.
- Yes/no offer detection uses `classifier.slotAction` — there is no dedicated `confirmed`/`negated` value on `primaryIntent`, so `slotAction.confirmation`/`rejection` is the canonical classifier-driven yes/no signal (zero regex, zero keyword lists). If yes/no detection becomes unreliable in the wild, add a dedicated few-shot example block to the classifier system prompt for the offer-response context.
- `ask_size_choice` template assumes `{variant_list}` interpolates available sizes when user picked a color/style without a size. If a user-picked-variant flow is added that exposes a different shape (e.g. an `available_sizes` variable distinct from `variant_list`), the template engine variable resolution needs the new var added to its known-keys list.
- Cosmetics demo image URLs are downloaded into `apps/api/test-assets/cosmetics/` from public CDNs (Ukrainian e-commerce sites). Risk of CDN rotation. If images break, the seed log will report `! image source missing: ...` and the `product_media.url` rows still get inserted — the broken image becomes a missing visual in the demo widget but does not break flow. Re-download from alternate sources via curl if any URL rots.
- `variants.color` and `variants.size` columns are semantically reused for non-clothing verticals. Cosmetics demo stores Маска variants ("Зволожуюча/Очищувальна/Освітлююча") in `color` and SPF variants ("SPF 30/SPF 50") in `size`. Known schema overload. When a third + fourth non-clothing vertical lands (sport supplements: dose × flavor; etc.), refactor to typed `attribute_1`/`attribute_2` columns with optional labels — separate PR.
- `DemoService.onModuleInit` resolves all `is_demo=true` tenants once at boot into an in-memory `Map<slug, tenantId>`. Seeding new demo tenants requires an API restart for the controller to see them. Acceptable now; revisit if we ever do hot-add tenants. The deploy order is therefore: migrations → seed → restart api.
- `flow_config` is still typed as `Record<string, unknown>` on `StoreConfig`; reads use `(flowConfig as any).preQualifyStrategy` / `.businessType` etc. Defining a typed `FlowConfig` interface (with `businessType`, `preQualifyStrategy`, `preQualify`, `sizeChart`, `sizeChartMappings`) in `apps/api/src/modules/engine/entities/store-config.entity.ts` is a separate cleanup PR. Knock-on: the simulator's `flowConfigOverride` field is also `Record<string, unknown>`.
- Templates code-as-source-of-truth applies to demo tenants ONLY. Production tenants (`clothes-store`, `pilot`, future paying customers) still author templates in DB via the admin panel. Future: extend the code-source pattern to a "starter pack" for new production tenants — they fork from a vertical preset and edit in admin. Until then: any change to production-tenant templates must go through admin UI / direct DB edit, NOT the seed/templates/ files.
- `entities.size` field has no canonical-value constraint. The classifier could extract any string into `entities.size` because the tool definition at `apps/api/src/modules/engine/classifier.service.ts` (`CLASSIFY_MESSAGE_TOOL.parameters.entities.properties.size`) is `{ type: 'string' }` with no description or enum. The `pendingOfferRule` few-shot rule guards the immediate hazard (don't extract "розмір" as size when answering an offer) but a broader fix — adding a `description` enumerating canonical sizes (XS/S/M/L/XL + numeric 36-50) — would harden every size-extracting context. Defer until a second symptom appears.
- If cosmetics ever flips to `after_search_offered` (via `flow_config.preQualifyStrategy` override or future product decision), mirror the clothing `pendingOfferRule` for skin-type offer responses (e.g. "допоможіть з типом шкіри" / "підкажіть з вибором" should map to `slot_action='confirmation'`). Currently cosmetics defaults to `before_search` so the offer-suffix path never fires, but it's the same regression class — the classifier needs an explicit conditional rule + memory-context signal whenever an offer is pending.
- Per-variant images for clothing demo are not seeded. Mango Сукня міді and other women-clothes items use a single product-level `imageUrl`; all variants share it. The new `ask_variant_choice` image fallback gracefully falls back to the product image, so the visual is just one image instead of N. To showcase per-variant images on the Жіночий одяг tab, populate `apps/api/src/scripts/seed/data/clothing-women-products.ts` variant entries with per-variant `imageFile` (one per color, optionally per (color, size)) and download corresponding test-assets. Cosmetics already does this for masks.
- `MessageBubble.tsx` caps `imageUrls` at 4 visible images (`images.slice(0, 4)`). Variants 5+ are dropped from the visual but still listed in the `{variant_list}` template text. Acceptable while max candidate variants per turn ≤4. If a catalog with >4 candidate variants per choice ever appears, swap the 2-col grid for a horizontally scrollable carousel.
- Cosmetics doesn't have partial-variant templates (`ask_size_for_color` / `ask_color_for_size`). When a future cosmetics product introduces two variant axes (e.g., scent × SPF), engine routes to those scenarios but cosmetics templates don't exist → falls back to `ask_variant_choice`. Acceptable degradation; add cosmetics-specific templates if a two-axis cosmetics SKU ships.
- `slotAction='correction'` does not reset `memory.selectedColor` / `memory.selectedSize` in the general case. The branch at `apps/api/src/modules/conversations/reply-engine.service.ts:1056-1060` only clears `selectedVariantId`/`selectedVariantName`. The partial-variant flow defends with explicit clears of the opposite axis inside 5.5c match-failure branches; a broader fix (clear both axes in the correction branch itself) was deferred. Audit broader correction handling for memory state hygiene as a separate cleanup.
- `enforceStageGates` checkout-blocked redirect at `apps/api/src/modules/engine/template-engine.service.ts:441` routes to plain `ask_variant_choice` when `selectedVariantId` is missing, ignoring `memory.selectedColor` / `memory.selectedSize` partial state. Low-probability path (user skips variant resolution and attempts checkout) but should ideally route to `ask_size_for_color` / `ask_color_for_size` matching partial state. Address if the edge surfaces in real flow.
- `5.5c` block in `reply-engine.service.ts` has 4 sites writing `memory.availableVariants` (lines around 1516, 1543, plus this PR's match-failure path). Centralized in `buildAvailableVariantsList` private helper to prevent drift; promote to a shared utility if another caller appears outside 5.5c.
- Per-variant images for clothing demo are not seeded (still). The new `ask_color_for_size` flow benefits when each variant has its own `imageUrl` — engine attaches one image per candidate (Red+M, Black+M). Today's clothing demo seed has only product-level images, so the multi-image grid renders just the product photo. To showcase per-color images on the Жіночий одяг tab, populate `apps/api/src/scripts/seed/data/clothing-women-products.ts` variant entries with per-color `imageFile`. Cosmetics already does this for masks.
- `extraReplies` only consumed by the demo path. Production Instagram replier at `apps/api/src/modules/channels/instagram/instagram.service.ts:668-674` reads only `result.reply` and ignores `result.extraReplies`. When shipping multi-bubble flows (size chart auto-attach, future "І ось трохи варіантів" follow-ups) to Instagram, add an iteration loop that sends each `extraReplies[i]` after the primary reply via the same Meta API call pattern. Until then: production Instagram customers only see the primary bubble; the chart and any future follow-ups are silently dropped.
- Color/size inflection in clothing partial-variant templates AND skin-type inflection in cosmetics templates. Templates render `{color}`, `{size}`, and `{skin_type}` directly from classifier entities or memory — no Ukrainian morphological agreement. Strings like "Mango Сукня міді в Red" mix languages; "Mango Сукня міді червона" / "жирна шкіри" are ungrammatical when classifier extracts the accusative form. A single dedicated PR with a UA-form lookup table (per axis: color/size/skin type, per case: nominative / accusative / genitive / locative) would address both demos. Defer until copy quality becomes a customer-facing concern.
- `getBrandAndCategoryForProduct` adds two DB queries per partial-variant size-asking turn (one for brand+category, one for chart resolution). Both are indexed and the gate fires only when trigger conditions match (single-product context + size-asking scenario), not every turn. Real cost is much lower than per-turn. Monitor demo logs; cache by `(tenantId, productId) → {brand, category}` for the conversation lifetime only if perf data shows measurable impact.
- Simulator assertion type `SimulatorTurnExpect` now exposes `extraReplyCount` and `extraReplyImageContains` for follow-up bubbles. Mirror these into any new assertion fields if the engine ever emits richer per-extra metadata (e.g. per-extra scenario/template id).
- Demo widget Instagram reply context is scripted-playback only. Live mode never sets `turn.instagramContext`. If marketing wants a "try this flow live" affordance with a seeded media context, the live-send path would need to forward `mediaReference` to the engine and the demo widget would need a way to attach a starting context to the customer's first message. Out of scope for the current marketing affordance.
- Inline Instagram preview in `MessageBubble` is approximation, not pixel-perfect Instagram. Story uses `aspect-[3/4]` and a single white duration bar (no multi-segment story progression chrome). Real Instagram heart icon, paper plane, three-dot menu are omitted. Tighter fidelity is a future styling polish PR if marketing reviews and wants exact match.
- `product_variants.image_url` is a dead column in the demo seed path. Real per-variant images live in `product_media` keyed by `(product_id, color)`. Two consumer paths now implement the `colorImageMap` pattern independently — `catalog.service.ts:107-141` (admin listing) and `availability.service.ts` (reply engine). If a third consumer is added, replicate the pattern; risk grows with consumer count. Resolution options for a dedicated cleanup PR: (A) extract a shared utility `resolveVariantImageMap(productIds)` for all consumers; (B) populate `product_variants.image_url` at seed/ingest time and drop `product_media` color-keyed rows; (C) drop `product_variants.image_url` column entirely. Pick one before adding a 3rd consumer.
- Color matching in `colorImageMap` depends on case normalization (`toLowerCase()` on both sides). Demo seed normalizes color values during insertion, so the lookup works there. Production ingestion paths (n8n Shopify / OpenCart connectors) MUST normalize color casing during catalog sync — otherwise the lookup silently misses and falls back to the product-level image. No error raised; just wrong-image rendering. Verify n8n connector normalization when production tenants onboard.
- Engine has a defensive gate at `reply-engine.service.ts` 5.5c for the `slotAction='confirmation' + entities.color/size` edge case. Pattern: classifier prompt was updated to disambiguate "давайте/беру + specifics" → `fills_missing_slot` (not `confirmation`), but the engine retains a belt-and-braces gate so misclassifications still route correctly. If similar non-determinism patterns surface (other `slotAction` values producing wrong routing), prefer extending engine gates over relying solely on classifier prompt updates. Two-layer defense for routing robustness; the regression scenario `clothing_offer_accept_with_product_specifics` guards this case.
- Body measurements (height/weight) are NOT extracted as classifier entities. The mid-flow size-help branch at `reply-engine.service.ts` `maybeMidFlowSizeHelp` relies on `looksLikePreQualifyData` (regex on raw text in the 30–250 plausible range) plus a strict size-context keyword allowlist `['розмір','зріст','вага']` to detect size queries. Generic recommend stems (`порад`, `порекоменд`, `підказа`, `підібра`) are deliberately excluded from the allowlist because they would over-fire on non-size suggestions like "що порадите для пляжу?". Coverage gap: phrasings like "порадьте розмір" without the word `розмір` would under-fire and fall through to the existing recommendation/AI-fallback path — degraded but not broken. If false-positive/false-negative rates surface in production logs, promote `bodyMeasurements: { height?, weight? }` to the classifier entity schema (CLASSIFY_MESSAGE_TOOL.parameters.entities) so the engine has a structured signal instead of regex + keyword stems.

## Issue Triage Protocol

When encountering a conversation issue, ALWAYS classify it first 
before fixing:

1. **Bug** — code doesn't do what the architecture intended 
   (missing memory write, wrong variable, typo). Quick fix.
   
2. **AI went wrong** — classifier returned wrong intent/slotAction/
   entities. Fix by improving prompt, adding examples, or enriching 
   context.

3. **Architectural** — the design can't handle this case (missing 
   state, no template for scenario, flow doesn't support this 
   path). Needs refactor/plan.

State the classification before proposing a fix. This prevents 
over-engineering bugs and under-engineering architectural gaps.

### Investigation order for any issue

1. Reproduce in simulator first: `npm run simulate -- --tenant 
   <slug> --message "<text>"`
2. Read the trace output — engine emits structured trace at every 
   pipeline stage
3. If classification is wrong → AI went wrong path
4. If classification correct but engine takes wrong action → 
   reread reply-engine.service.ts:46-57 (process() entry point) 
   and walk through the steps
5. If state machine is in unexpected selectionState → check the 
   transitions in the 5.5 selection block (reply-engine flow)
6. Only after #1-5 done, propose a fix

When encountering a conversation issue, ALWAYS classify it first before fixing:

1. **Bug** — code doesn't do what the architecture intended (missing memory write, wrong variable, typo). Quick fix.
2. **AI went wrong** — classifier returned wrong intent/slotAction/entities. Fix by improving prompt, adding examples, or enriching context.
3. **Architectural** — the design can't handle this case (missing state, no template for scenario, flow doesn't support this path). Needs refactor/plan.

State the classification before proposing a fix. This prevents over-engineering bugs and under-engineering architectural gaps.

## Production patterns to replicate

When building any new caller of ReplyEngineService (demo, batch 
processor, future channels), replicate the production pattern from 
`instagram.service.ts:606-622`:

```typescript
const recentMessages = (await conversationsService.findById(
  conversationId
)).messages.slice(-10).map(m => ({ role: m.role, text: m.text }));

await replyEngineService.process({
  tenantId,
  conversationId,
  messageText: combinedText,    // joined buffer texts if debounced
  state: freshState,             // load fresh from DB before call
  recentMessages,                // last 10 from DB at call time
  mediaReference,                // optional, omit for text-only
});
```

Critical: recentMessages is loaded from DB AT CALL TIME, not 
cached, not empty. The engine relies on this to maintain 
conversation context across debounced messages.

When implementing a new caller, do NOT pass `isDemo` flags or 
similar branches into ReplyEngineService — keep it pure. Suppress 
side effects at the caller boundary (skip order dispatch, skip 
Telegram, skip Meta send) rather than instructing the engine to 
behave differently.

### Templates code-as-source-of-truth (demo tenants only)

For demo tenants, response templates live in TypeScript files at
`apps/api/src/scripts/seed/templates/{base,clothing,cosmetics}/index.ts`
and are inserted into `response_templates` rows by the seed scripts.
`getTemplatesForBusinessType('clothing' | 'cosmetics')` merges base
+ vertical with vertical-wins-on-collision dedup. Production tenants
keep their templates DB-authored via the admin panel; this pattern
is for showcase tenants only. To add a new vertical, drop a new
folder under `seed/templates/<vertical>/index.ts`, add the vertical
to `getTemplatesForBusinessType`, write a builder + entry-point seed
script (see Builders pattern below), and follow
`docs/onboarding-new-business-type.md`.

### Builders pattern

Each demo vertical has a builder at
`apps/api/src/scripts/seed/builders/<vertical>-builder.ts` that
orchestrates the full insert pipeline (tenant + settings + store_config
+ catalog + media + size_charts + templates). Common primitives —
`deleteTenantBySlug`, `assertNoOrphans`, `createTenant`,
`createTenantSettings`, `createStoreConfig`, `seedCatalog`,
`copyImages`, `seedProductMedia`, `seedResponseTemplates` — live in
`tenant-builder.ts`. Each entry-point script
(`seed-demo-<vertical>.ts`) does:
1. `deleteTenantBySlug(ds, '<slug>')` (CASCADE)
2. `assertNoOrphans(ds, ['<slug>'])` (defensive)
3. `build<Vertical>Tenant(ds, opts)`
This idempotency pattern lets seeds re-run safely.

### Strategy-aware engine flow

`handlePreQualify` is a thin dispatcher reading
`flow_config.businessType` and routing to
`handlePreQualifyClothing` or `handlePreQualifyCosmetics`. Each
handler reads `flow_config.preQualifyStrategy` and either:
- `before_search` → ask pre-qualify question, return prompt
- `after_search_offered` → fall through, `buildResponse` appends a
  per-vertical offer suffix when the rendered scenario is
  `show_products` and the user hasn't supplied the relevant entity
- `awaitingPreQualifyAnswer` flag drives the next-turn yes/no path;
  `classifyOfferAnswer` uses `slotAction.confirmation`/`rejection`
  with NO regex/keyword matching (purely classifier-driven).

When a new businessType is added, add `handlePreQualify<Vertical>`
mirroring the existing two and extend the `handlePreQualify`
dispatcher.

## Dev Commands

```bash
# Start database
cd infra/docker && docker compose up -d

# Run migrations
cd apps/api && npx ts-node -r tsconfig-paths/register ../../node_modules/typeorm/cli.js migration:run -d src/database/data-source.ts

# Start backend (dev)
cd apps/api && npm run dev

# Start admin panel (dev)
cd apps/admin && npm run dev

# Seed database
cd apps/api && npm run seed

# Build shared package
cd packages/shared && npm run build

# Reset conversations
docker exec docker-postgres-1 psql -U postgres -d directmate -c "DELETE FROM audit_logs; DELETE FROM messages; DELETE FROM conversation_state; DELETE FROM conversations; DELETE FROM customers;"

# Replay last conversation (debugging tool)
cd apps/api && npm run replay
cd apps/api && npm run replay -- --last 3
cd apps/api && npm run replay -- --id <uuid>

# Check conversation logs
cat apps/api/conversations.log | jq .
tail -f apps/api/conversations.log | jq .
```

## Environment Variables (apps/api/.env)

```
NODE_ENV, PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN
META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN
OPENAI_API_KEY, OPENAI_MODEL (gpt-5.4-mini), OPENAI_FALLBACK_MODEL (gpt-5.4)
ENCRYPTION_KEY (64-char hex)
INTERNAL_API_KEY
```

## File Conventions

- Entities: `@Entity('table_name')`, camelCase props, SnakeNamingStrategy handles DB columns
- Migrations: raw SQL in `up()`/`down()`, timestamped filename
- Controllers: `@UseGuards(JwtAuthGuard)`, `@CurrentUser()` decorator for tenant context
- Services: constructor injection, `@InjectRepository()` for TypeORM repos
- Admin pages: TanStack Query for data, Tailwind for styling, existing UI components in `components/ui/`
