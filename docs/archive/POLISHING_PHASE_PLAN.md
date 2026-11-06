# DirectMate — Polishing Phase Plan (Bot Conversation Flow)

> Scope: only issues that affect the **live bot ↔ customer Instagram DM**.
> Derived from the full 73-finding codebase audit (2026-06-14), filtered to
> the 34 conversation-flow findings and adversarially verified against the
> code. Infra/billing/deploy, admin SPA, DB-dashboard perf, GDPR/retention,
> and backups are tracked separately and are **out of scope here**.

**Severity legend:** 🔴 critical · 🟠 high · 🟡 medium · 🔵 low
**Counts (after dedupe of shared-root-cause findings):** 1 🔴 · 5 🟠 · 11 🟡 · 14 🔵

The recurring pattern: most of these are **single-process-correct but
concurrency-fragile** — they bite under two simultaneous customers now, or
the moment a second replica is added.

---

## P0 — Bot goes silent / stops replying

The highest-impact cluster: customer sends a message and gets nothing.

### 🟠 1. `failedTurns` never resets → conversation permanently locked into handoff
- **File:** [reply-engine.service.ts:3167](apps/api/src/modules/conversations/reply-engine.service.ts#L3167) (increment), [:264](apps/api/src/modules/conversations/reply-engine.service.ts#L264) (lifetime gate)
- **Customer sees:** "the bot died mid-conversation" — after enough *cumulative* fallback failures (transient OpenAI blips count) the bot stops replying entirely and routes every message, even a clean "так, беру", to a human. No self-heal.
- **Root cause:** `memory.failedTurns` is only ever incremented, never reset; the precheck escalates on the lifetime count, not consecutive failures. Lives only in `template_first_with_safe_fallback` mode.
- **Fix:** reset `memory.failedTurns = 0` on any successful template render / AI fallback (top of the success return in `buildResponse`), or make it a consecutive-failure counter that resets on success. Ideally distinguish transient OpenAI errors from genuine "bot can't answer".

### 🟠 2. No OpenAI timeout → turns hang up to ~10 min, blocking the customer's whole queue
- **Files:** [reply-engine.service.ts:212](apps/api/src/modules/conversations/reply-engine.service.ts#L212), [classifier.service.ts:338](apps/api/src/modules/engine/classifier.service.ts#L338), [instagram-content.service.ts:75](apps/api/src/modules/channels/instagram/instagram-content.service.ts#L75); raw `fetch` sites in image-embedding `callReplicate`/`pollPrediction`
- **Customer sees:** during an OpenAI/CDN hiccup the turn hangs for minutes; because the per-conversation advisory lock is held, every *subsequent* message for that customer blocks too. The engine's soft-handoff-on-error never fires because the call never throws — it just waits.
- **Root cause:** OpenAI client built with only `apiKey` → SDK defaults to a 600000ms (10-min) timeout + 2 retries. No `AbortController` on hot-path `fetch()`.
- **Fix:** set `timeout` (8–15s) and `maxRetries: 1` on every `new OpenAI()`; wrap raw fetch calls in an `AbortController` deadline. Fail to handoff on timeout instead of blocking. *(Merges audit findings #4 + #17.)*

### 🟠 3. Advisory lock leaks (lock/unlock on different pooled connections) → second message wedges
- **File:** [instagram.service.ts:646](apps/api/src/modules/channels/instagram/instagram.service.ts#L646) (lock), [:831](apps/api/src/modules/channels/instagram/instagram.service.ts#L831) (unlock), [conversationLockKey:865](apps/api/src/modules/channels/instagram/instagram.service.ts#L865)
- **Customer sees:** their next message blocks indefinitely on `pg_advisory_lock` until the leaked physical connection recycles; reply-latency spikes, pool exhaustion under load.
- **Root cause:** `dataSource.query()` borrows/returns a pooled connection per statement, so the session-level lock is acquired on connection X and the `unlock` runs on a possibly-different connection Y → Postgres only emits a `WARNING`, the lock on X never releases. The comment at L644 already references `pg_advisory_xact_lock` but the code uses the session form.
- **Fix:** pin one `QueryRunner` for the whole critical section, or use `pg_advisory_xact_lock` inside an explicit transaction (auto-released on commit). *(Merges #2 + #30; do alongside finding 4 below and #22/#23.)*

### 🟠 4. Telegram handoff notification swallowed below the retry wrapper → manager never alerted
- **File:** [telegram.service.ts:129-189](apps/api/src/modules/notifications/telegram.service.ts#L129); consumed at [instagram.service.ts:716](apps/api/src/modules/channels/instagram/instagram.service.ts#L716)
- **Customer sees:** on any Telegram hiccup or empty/misconfigured chat list, the escalated conversation goes fully silent — bot already paused (`escalate()` ran first), manager never pinged, customer ignored.
- **Root cause:** `sendMessage` has its own try/catch that logs and returns `void` on failure, so the `withRetry` wrapper never sees a rejection and never retries. Empty `telegramChatIds` resolves successfully with zero notifications and no warning.
- **Fix:** make `sendMessage` throw on non-ok/network error so `withRetry` engages; `sendToAll` → `Promise.allSettled` and throw if all fail; emit a loud WARN when a tenant has zero chat IDs at handoff time.

---

## P1 — Duplicate replies / double orders

### 🟡 5. Debounce flush is read-then-delete (non-atomic) → double reply
- **File:** [instagram.service.ts:560-598](apps/api/src/modules/channels/instagram/instagram.service.ts#L560) (`find` at 562, `delete` at 569), poller `setInterval` at [:100](apps/api/src/modules/channels/instagram/instagram.service.ts#L100)
- **Customer sees:** the same combined batch sent twice (and a draft order created twice) the moment a second replica is added; even single-process if a flush overruns the poll interval.
- **Root cause:** `find({debounceKey})` then a separate `delete({debounceKey})` with no atomic claim; the advisory lock is acquired *after* this window so it serializes but doesn't dedupe.
- **Fix:** atomic claim — `DELETE FROM pending_messages WHERE debounce_key=$1 AND flush_at<=now() RETURNING *` (single statement), or `SELECT … FOR UPDATE SKIP LOCKED`. Add an outbound idempotency key.

### 🟡 6. Debounce poller has no re-entrancy guard → overlapping ticks double-process
- **File:** [instagram.service.ts:100](apps/api/src/modules/channels/instagram/instagram.service.ts#L100) (`setInterval`, not awaited)
- **Customer sees:** under realistic latency (slow OpenAI + multiple keys ready), a tick fires while the previous is still running → duplicate replies / double draft order.
- **Fix:** add an in-flight boolean guard (skip the tick if the previous `pollTasks` hasn't resolved), and/or the same atomic-claim fix as #5.

### 🟡 7. Duplicate-order protection is only the in-memory `orderCreated` flag — no DB backstop
- **File:** [reply-engine.service.ts:3303-3306](apps/api/src/modules/conversations/reply-engine.service.ts#L3303); orders schema [InitialSchema.ts:341](apps/api/src/database/migrations/1710000000000-InitialSchema.ts#L341)
- **Customer sees:** under any persist race / multi-process, one confirmation → duplicate orders + duplicate Shopify/OpenCart drafts.
- **Fix:** partial unique index on `orders(conversation_id) WHERE status != cancelled` (or unique on `checkout_session_id`); keep the memory flag as fast path, treat the unique-violation as authoritative.

### 🔵 8. Inbound messages not deduped by `mid` → Meta redelivery doubles the LLM input
- **File:** [instagram.service.ts:469-558](apps/api/src/modules/channels/instagram/instagram.service.ts#L469)
- **Customer sees:** duplicate transcript bubbles; the debounced engine call sees `"Привіт\nПривіт"`, which can change classification/entities.
- **Fix:** UNIQUE on `(tenant_id, external_message_id)` for inbound rows (or a short-TTL processed-mid set); insert pending with `ON CONFLICT DO NOTHING` keyed on `messageId`.

---

## P1 — Conversation state corrupted mid-flow

### 🟡 9. `POST_ORDER_PASSIVE_INTENTS` lists non-enum intents → a post-order "так" wipes the order/cart state
- **File:** [reply-engine.service.ts:707](apps/api/src/modules/conversations/reply-engine.service.ts#L707) (list), 710 (passive branch), 728 (destructive reset)
- **Customer sees:** after an order, replying "так"/"добре"/"ок" (classified `confirm_choice`, which isn't in the list) falls into the reset branch → engine silently discards completed-order state + cart; next message starts a brand-new flow. Also clears `orderCreated`, defeating the idempotency guard → possible duplicate draft.
- **Root cause:** 3 of 5 list entries (`gratitude`/`small_talk`/`goodbye`) are dead strings; `confirmation` is a slot_action, not an intent. Only `thanks` is real.
- **Fix:** use real enum values + gate on `slotAction === 'confirmation'`; add a unit assertion that every list entry is a member of the `primary_intent` enum.

### 🟡 10. Classifier mutates shared `this.model` on the singleton → concurrent conversations cross-contaminate model + cost
- **File:** [classifier.service.ts:691-700](apps/api/src/modules/engine/classifier.service.ts#L691) (mutation across `await`), reads at 590/606
- **Customer sees / cost:** when conversation A is in escalation-verification (fallback model open), conversation B's routine classify reads the mutated field → B runs/billed on the expensive `gpt-5.4` instead of `gpt-5.4-mini`, **or** a fallback verification runs on the cheap model → wrong handoff decision. Also mis-stamps `conversation_traces.openai_calls` cost telemetry.
- **Root cause:** singleton provider + `(this as any).model = fallbackModel` straddling a network `await` is exactly where the event loop interleaves.
- **Fix:** never mutate instance state — parameterize the model: `private runClassify(model, params)` (or a `modelOverride` arg) read into a local `const` used for both the request and the usageSink push. *(Merges #6 + #8b + #9 — one fix resolves all three.)*

### 🟡 11. Re-sending the same story_reply / photo mid-flow resets selection state and loops
- **File:** [reply-engine.service.ts:272](apps/api/src/modules/conversations/reply-engine.service.ts#L272) → `resolveMediaProduct` (915-1035) → `handleColorLinkedMedia` (1093-1212)
- **Customer sees:** a customer who already chose a variant and is about to confirm gets thrown back to the start whenever they re-reference the same media; OOS/partial branches clear a confirmed `selectedVariantId`. (Observed twice in prod — conv `3e4d3d51`.)
- **Fix:** make media re-resolution idempotent — when resolved `productId === memory.selectedProductId` AND `selectionState ∈ {awaiting_variant, awaiting_confirmation, confirmed}`, treat it as a no-op reference re-send and let the text drive routing. Only run the state-mutating media-link path on first resolution per conversation.

### 🟡 12. `Conversation.messages` loads ALL messages every turn with no chronological order
- **File:** [conversation.entity.ts:64](apps/api/src/modules/conversations/entities/conversation.entity.ts#L64); consumed [instagram.service.ts:665](apps/api/src/modules/channels/instagram/instagram.service.ts#L665)
- **Customer sees:** on long threads (the high-value repeat customers) `slice(-10)` can hand the classifier a non-chronological / wrong last-10 window → degraded intent/entity quality; also loads N rows to use 10.
- **Fix:** dedicated query `messagesRepo.find({ where:{conversationId}, order:{createdAt:'DESC'}, take:10 })` then reverse, or `@OrderBy({createdAt:'ASC'})` + a LIMIT query. Don't load the full relation on the hot path.

### 🔵 13. `correction` → fresh search doesn't reset `selectedColor`/`selectedSize`/`variantStep`
- **File:** [reply-engine.service.ts:1799-1803](apps/api/src/modules/conversations/reply-engine.service.ts#L1799)
- **Customer sees:** a "ні, давайте інше" to a new product carries a stale axis → wrong variant question / `{variant_list}` narrowed to a non-existent color's sizes (the sweater-photo bug class, broader than the documented `selectedVariantId`-only gap).
- **Fix:** also clear `selectedColor`/`selectedSize`/`variantStep` in the correction clear. Centralize a `clearVariantAxisState(memory)` helper used by all correction/reset sites (codebase already trends this way with `clearMediaLinkAxisScoping`).

### 🔵 14. Stale `recommendedSize` leaks across products on `adds_to_cart`
- **File:** [reply-engine.service.ts:822-855](apps/api/src/modules/conversations/reply-engine.service.ts#L822)
- **Customer sees:** a second item gets pre-filtered/auto-narrowed to a size recommended for an *unrelated* garment → wrong auto-selection or the size question is skipped.
- **Fix:** clear `memory.recommendedSize` (and `recommendedSkinType` for cosmetics) in both `adds_to_cart` branches — recommendation is product-scoped, not conversation-scoped.

### 🔵 15. Size-chart help routing depends on an unenforced `dialogue_act`
- **File:** [reply-engine.service.ts:4914-4934](apps/api/src/modules/conversations/reply-engine.service.ts#L4914)
- **Customer sees:** whether a sizing-help ask gets "ask for measurements" vs the plain chart image hinges on the model emitting `dialogue_act='ask_recommendation'`, which no prompt rule enforces. Degrades to a sane branch, so low impact — but the contract isn't pinned.
- **Fix:** add an explicit dialogue_act steering example to the classifier prompt, or disambiguate on phrasing/`primary_intent` instead. At minimum fix the comment so it doesn't claim a contract the prompt doesn't enforce.

---

## P1 — Photo / media turns break or stall

### 🟡 16. Photo-match runs fully synchronous on the reply hot path (the 28s turn)
- **File:** [reply-engine.service.ts:915-982](apps/api/src/modules/conversations/reply-engine.service.ts#L915) → `matchCustomerPhoto` [instagram-content.service.ts:620](apps/api/src/modules/channels/instagram/instagram-content.service.ts#L620)
- **Customer sees:** waits 5–60s+ for a reply on a photo DM; if Replicate is cold/queued the turn can hang past Instagram's webhook timeout. Most expensive turn type in the system (1 Replicate prediction + 1 GPT-4o vision over ~26 images).
- **Fix:** send an immediate ack bubble ("Секунду, дивлюсь 💛"), run pHash→CLIP→vision as a background job that posts the resolved reply when done. At minimum cap with an `AbortController` deadline (8–10s) and fall back to handoff on timeout.

### 🔵 17. Debounce buffer keeps only ONE `mediaReference` → second photo silently dropped
- **File:** [instagram.service.ts:572](apps/api/src/modules/channels/instagram/instagram.service.ts#L572)
- **Customer sees:** sends two product photos in a burst → bot only considers the first; the second is ignored with no handoff and no log.
- **Fix:** process media references sequentially, or when >1 distinct reference is present fall back to handoff/clarify. At minimum log a warning when references are coalesced.

### 🔵 18. `post_share` parsing relies on one field name → high-intent shares silently ignored
- **File:** [instagram.service.ts:326-353](apps/api/src/modules/channels/instagram/instagram.service.ts#L326)
- **Customer sees:** sharing a product post/reel (high intent) is silently treated as nothing actionable when Meta uses a payload shape outside the two hard-coded types/the single id field.
- **Fix:** broaden detection to `ig_reel` + alternate id keys (`payload.id`, `payload.ig_post_media_id`, `payload.media_id`); when attachments exist but none parse, route to handoff (`unrecognized_attachment`) rather than returning null.

---

## P2 — Checkout produces wrong outcomes

### 🟠 19. No reservations are ever created → stock not held during checkout (overselling)
- **File:** [reservations.service.ts](apps/api/src/modules/reservations/reservations.service.ts) (whole module is dead — never injected/called)
- **Customer sees:** the last in-stock variant can be sold to multiple customers at once; `confirm_last_in_stock` gives false confidence. `pending_checkout_qty` is read in availability math but never written, so `effectiveAvailable` is always `availableQty - 0 - 0`.
- **Fix:** wire `ReservationsService` into the checkout gate (reserve on `awaiting_confirmation` / `pendingCheckoutQty` on confirm, release on cancel/expire/sync) **or** explicitly remove the dead reservation code and document that overselling is accepted at current scale (a human confirms `AwaitingManagerConfirmation` before external sync — the current operational backstop). If kept, also fix the non-atomic `reservedQty += qty` read-modify-write.

### 🔵 20. Order total is JS float (no rounding); quantity hardcoded to 1
- **File:** [reply-engine.service.ts:4686](apps/api/src/modules/conversations/reply-engine.service.ts#L4686) (`quantity:1`); total math [orders.service.ts:91-94](apps/api/src/modules/orders/orders.service.ts#L91)
- **Customer sees:** multi-qty orders undercharged/under-shipped (always qty 1); orders can be created with `totalAmount` 0 on a price-parse miss; off-by-a-cent totals. All silent.
- **Fix:** carry real qty in `cartItems`; compute money in integer cents (or round to 2dp); refuse/handoff when `unitPrice` resolves to 0 rather than persisting a 0-total order.

### 🔵 21. Manager not notified on order creation (fire-and-forget)
- **File:** [orders.service.ts:401-423](apps/api/src/modules/orders/orders.service.ts#L401) (`notifyManager`), call site 127-136
- **Customer sees:** customer thinks they ordered; an order awaiting manager confirmation can exist with no human ever alerted (misconfig/webhook outage), discoverable only by scanning logs.
- **Fix:** dispatch after the transaction commits; persist a `notified_at`/`notification_failed` flag (outbox table for at-least-once); surface un-notified `AwaitingManagerConfirmation` orders in the admin; warn when `notificationWebhookUrl` is unset for a tenant that creates orders. *(Merges #24 + #33.)*

### 🔵 22. `buildOrderPayload` sets `customerId = conversationId` (latent FK trap)
- **File:** [reply-engine.service.ts:4694](apps/api/src/modules/conversations/reply-engine.service.ts#L4694)
- **Note:** no active corruption today (Instagram overrides the field), but a trap for the next `ReplyEngineService` caller — orders would attribute to a wrong/nonexistent customer.
- **Fix:** thread the real `customerId` into `ReplyEngineInput`, or set it null/undefined in the payload and require the caller to populate it.

---

## P2 — Manager handoff trust (bot talks over a human)

### 🟡 23. Manager-reply echo path swallows DB errors → bot keeps replying alongside a live human
- **File:** [instagram.service.ts:399-401](apps/api/src/modules/channels/instagram/instagram.service.ts#L399) → `handleManagerReply` (905-947)
- **Customer sees:** on a transient DB error during manager-reply detection, the `takeover()` (set `human_in_control`) is swallowed → bot fails to pause and double-voices alongside the manager. Narrow window (throw at `saveMessage` or the `takeover` UPDATE before commit), but high embarrassment.
- **Fix:** make `takeover` the first must-succeed step (before `saveMessage`); wrap the sequence so a failure to set `human_in_control` is retried or re-attempted on the next manager echo; consider a transaction around the state mutation.

### 🔵 24. Manager-reply path mutates status without the advisory lock → races bot `processInbound`
- **File:** [instagram.service.ts:905-947](apps/api/src/modules/channels/instagram/instagram.service.ts#L905)
- **Customer sees:** bot can fire a reply into a conversation a human is simultaneously taking over.
- **Fix:** acquire the same `conversationLockKey` advisory lock in `handleManagerReply` around the takeover+status writes (do in tandem with #3 so the lock actually works on a pinned connection).

### 🔵 25. `extraReplies[i].text` failure escalates after the primary bubble already sent → real answer dropped
- **File:** [instagram.service.ts:762-794](apps/api/src/modules/channels/instagram/instagram.service.ts#L762)
- **Customer sees:** on a Meta hiccup that succeeds for bubble 1 but fails for bubble 2, the customer keeps only the greeting + the handoff "checking" message; the real answer is dropped and never persisted to `messages`.
- **Fix:** save each `extra.text` to `messages` like the primary; send the substantive contextual reply as the *primary* bubble (greeting as the extra) so a bubble-2 failure doesn't drop the meaningful content.

---

## P3 — Hygiene / slow leaks

### 🔵 26. `recentSendByRecipient` Map grows unbounded; cross-process echo filtering breaks
- **File:** [instagram.service.ts:64](apps/api/src/modules/channels/instagram/instagram.service.ts#L64) (set at 153/224, read at 379, never deleted)
- **Impact:** single-process: slow heap growth / GC pressure. Multi-process: bot echoes arriving on a different worker (or after the 20s window) are mistaken for manager replies → spurious `human_in_control` → bot goes silent on a healthy conversation.
- **Fix:** evict on a TTL like `recentSentMids` (10s echo window). For multi-process, persist sent mids to a shared store and dedup echoes by `mid` in the DB rather than by time window. *(Merges #21 + #28.)*

### 🔵 27. Advisory lock key is a 32-bit hash of the UUID → collisions serialize unrelated conversations
- **File:** [instagram.service.ts:865-872](apps/api/src/modules/channels/instagram/instagram.service.ts#L865)
- **Impact:** occasional cross-conversation head-of-line blocking at scale; worse combined with the lock leak (#3).
- **Fix:** use full UUID entropy — `pg_advisory_lock(int4, int4)` seeded from two 32-bit halves, or first 8 bytes of `sha1(uuid)` as a bigint.

---

## Security-adjacent (include with this phase)

### 🔴 28. Webhook processed without signature verification when the header is absent
- **File:** [instagram.controller.ts:41-54](apps/api/src/modules/channels/instagram/instagram.controller.ts#L41)
- **Why here:** not an organic-flow bug, but it *corrupts real conversations* — spoofed customer DMs (burn LLM spend + outbound sends), spoofed `is_echo` events flip arbitrary conversations to `human_in_control`. The repo's own Mono webhook ([subscriptions.controller.ts:61](apps/api/src/modules/subscriptions/subscriptions.controller.ts#L61)) already does it the correct fail-closed way.
- **Fix:** fail closed — reject (401) whenever `META_APP_SECRET` is configured and either the signature header or `rawBody` is missing; only allow the unsigned path in an explicit env-gated dev mode.

---

## Suggested execution order

1. **Same-day, small + high-impact:** #1 (`failedTurns` reset), #2 (OpenAI timeout), #28 (webhook fail-closed), #9 (`POST_ORDER_PASSIVE_INTENTS` wipe), #16 (photo-match ack + deadline), #11 (media re-send idempotency).
2. **Concurrency batch (one PR):** #3 (lock leak via pinned QueryRunner) + #24 (manager-reply lock) + #27 (lock key entropy); then #5/#6 (atomic flush + poller guard) + #7 (order unique constraint) + #8 (mid dedup).
3. **State hygiene cleanup (one PR):** #10 (classifier model param), #12 (messages query), #13 (correction axis clear via `clearVariantAxisState`), #14 (recommendedSize clear), #15 (size-chart routing/comment).
4. **Handoff trust:** #4 (Telegram throws), #23 (echo-path takeover-first), #25 (extra-bubble persistence).
5. **Checkout integrity:** decide #19 (wire reservations vs. document overselling), #20 (qty + integer-cents money), #21 (manager-notify durability), #22 (customerId trap), #17/#18 (media parsing robustness).

---

## Out of scope (filtered out of this plan — tracked in the full audit)

`MONO_MERCHANT_TOKEN`/billing wiring, certbot reload, deploy/healthcheck/migration-race, REPLICATE env, admin SPA error boundaries, DB indexing for dashboards, `conversation_traces`/`conversations.log` PII retention + rotation, FKs on `checkout_sessions`/`orders`, `InternalApiKeyGuard` timing, superadmin JWT recheck, impersonation-token-in-URL, prompt-caching token cost, and the audit's coverage gaps (n8n workflow internals, engine regression-test depth, token lifecycle, multi-tenant query isolation, rate limiting, backups).
