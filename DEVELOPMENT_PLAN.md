# DirectMate — Development Roadmap & Plan

## Product Vision

Ukrainian SaaS platform for automating Instagram DM sales. Monthly subscription per store. Manual onboarding for first 1-3 stores, then self-service. Any category of Ukrainian Instagram store.

**Target: 70-80% of DM conversations automated** — the bot handles routine sales flow, escalates only when truly needed.

## Key Design Decisions (from user answers)

- **Order flow**: Bot collects info → auto-create draft order in Shopify/OpenCart → manager confirms
- **Manager handoff**: Manager replies in Instagram directly. Bot detects non-bot replies (is_echo) and stays silent. Auto-resumes when manager stops replying.
- **Cart**: Multi-product orders (customer can add several products before checkout)
- **Templates**: Store owner edits in admin panel (you set up initial set during onboarding)
- **Training**: Big screenshot batch at onboarding + occasional additions
- **Analytics**: Full dashboard (conversion funnel, automation rate, response time)
- **Deployment**: VPS (DigitalOcean/Hetzner) with Docker Compose

---

## Phase 1: Fix Current AI Flow (NOW)

**Goal**: Make the existing conversation flow work correctly end-to-end.

### 1.1 Fix reply engine bugs (already partially done)
- [x] Stage gates prevent premature checkout
- [x] Memory tracks actual action, not classifier's recommendation
- [x] Short reply resolver for "Так", "Добре", "Підкажіть"
- [x] Product search triggers for `ready_to_order` intent
- [ ] Fix: after "Оформлюємо X?" + "Так" → go to `collect_checkout_info`, not repeat
- [ ] Fix: AI fallback shouldn't override memory with wrong state
- [ ] Fix: product list template should show prices, variants, and group nicely

### 1.2 Variant selection flow

The bot must handle the product → variant → checkout pipeline correctly:

**Case A: User specifies product + variant in one message**
- "Хочу червону помаду Silk Color" → product found, variant matched (color=червона) → skip variant question → "Оформлюємо Silk Color Помада (Червоний), 17.9 UAH?"

**Case B: User specifies product but not variant**
- "Хочу помаду Silk Color" → product found, 4 color variants → ask which variant
- Template `ask_variant_choice`: "Silk Color Помада є у відтінках: Nude Pink, Rosewood, Terracotta, Ягідно-червоний. Який вам подобається? 💛"

**Case C: User specifies category but not product**
- "Хочу помаду" → multiple products found → show product list (existing flow)
- After user picks product → check if multiple variants → ask variant if needed

**Case D: Single variant product**
- Product has only 1 variant (e.g., one size) → skip variant question entirely → go to "Оформлюємо?"

**Implementation:**
- After product is selected (confirm_selection), check variant count
- If 1 variant → auto-select, proceed to checkout
- If multiple variants AND user didn't specify (no color/size in entities) → `ask_variant_choice` template
- If multiple variants AND user specified (entities.color or entities.size) → try to match variant → if matched, proceed; if ambiguous, ask
- Memory stores `selectedVariantId` only when variant is confirmed

### 1.3 Template improvements
- [ ] Add `confirm_order_summary` template: "Ваше замовлення: {product} ({variant}), {price}. Дані: {name}, {phone}, {city}, НП {branch}. Все вірно?"
- [ ] Add `ask_variant_choice` template: "{product_name} є у варіантах:\n{variant_list}\nЯкий вам подобається? 💛"
- [ ] Add `confirm_with_variant` template: "Оформлюємо {product_name} ({variant_name}), {price}? 💛"
- [ ] Add `cross_sell` template: after order, suggest related product
- [ ] Templates should pull product descriptions from DB for recommendations

### 1.3 Verification
Test full conversation flow:
1. "Привіт" → greeting template
2. "Хочу червону помаду" → search → show products with prices
3. "Підкажіть" → recommend from shown list
4. "Давайте цю" → "Оформлюємо {product}?"
5. "Так" → collect delivery info
6. "Іван, 099..., Київ, НП5" → order summary confirmation
7. "Так" → order confirmed → draft order created

---

## Phase 2: Order System & Handoff (1-2 weeks)

**Goal**: Complete the order lifecycle and manager handoff.

### 2.1 Order persistence
- Save orders to `orders` + `order_items` tables (already exist)
- Status: draft → confirmed → shipped → delivered
- Link order to conversation + customer

### 2.2 Draft order creation in Shopify
- After bot confirms order, call Shopify Admin API to create draft order
- n8n workflow: `POST /internal/orders/create` → Shopify `draftOrderCreate` GraphQL mutation
- Store Shopify order ID in our `orders` table

### 2.3 Telegram handoff notifications
- When bot escalates → send Telegram message to manager
- Include: customer username, conversation summary, reason for escalation
- Telegram bot token stored in tenant settings

### 2.4 Manager reply detection
- Detect `is_echo: true` messages where sender = our page ID but message was NOT sent by our API
- On detection: set conversation `status = 'human_in_control'`, stop bot replies
- Auto-resume: after no manager reply for 30 min, set back to `active`
- Admin panel: manual "Resume bot" button

### 2.5 Multi-product cart
- `cart_items` in conversation state memory (array of {productId, variantId, qty})
- Templates: "Додати ще щось?" after product selection
- Checkout collects info for entire cart, not just one product

---

## Phase 3: Admin Panel Polish (2-3 weeks)

**Goal**: Production-ready admin panel for store owners.

### 3.1 Template management UI
- CRUD for response templates with live preview
- Drag-and-drop priority ordering
- Variable picker (show available {variables} for each scenario)
- Template testing: type a customer message, see which template would fire

### 3.2 Store configuration UI
- Brand config: language, formality, emoji preferences
- Flow config: enable/disable stages
- Checkout config: which fields to collect, Nova Poshta vs Ukrposhta
- Escalation config: confidence threshold, always-escalate intents

### 3.3 Conversations page
- Live conversation list with status badges (active, handoff, completed)
- Click to see full transcript (chat-style UI)
- Manual "Take over" / "Resume bot" buttons
- Filter by status, date, customer

### 3.4 Dashboard & Analytics
- **Conversion funnel**: messages → product shown → checkout → order completed
- **Automation rate**: % conversations without human intervention
- **Response time**: average bot reply time
- **Revenue**: total orders, average order value
- Time period selector (today, week, month)

### 3.5 Connections page fix
- Fix existing TypeScript errors
- Show connection status, last sync time
- Reconnect / refresh token buttons

---

## Phase 4: Production Readiness (1-2 weeks)

**Goal**: Deploy to VPS, handle real traffic.

### 4.1 Deployment
- Docker Compose: API + Admin (nginx) + Postgres + Redis
- SSL via Let's Encrypt / Cloudflare
- Persistent webhook URL (no more ngrok)
- Environment-specific configs

### 4.2 Instagram token management
- Long-lived token exchange (60-day tokens)
- Auto-refresh before expiry
- Alert when token is about to expire

### 4.3 Security & reliability
- Rate limiting on webhook endpoint
- Webhook signature verification (already done)
- Error recovery: retry failed message sends
- Graceful degradation: if OpenAI is down, send "Секунду, зараз уточню" and queue

### 4.4 Monitoring
- Health check endpoint
- Conversation log rotation
- Error alerting (Telegram notifications for system errors)
- OpenAI usage tracking (cost per tenant)

---

## Phase 5: Self-Service & Scale (future)

### 5.1 Multi-tenant self-service
- Registration flow
- Store setup wizard (connect Instagram, upload screenshots, customize templates)
- Billing integration (Stripe or LiqPay for Ukrainian market)

### 5.2 OpenCart order integration
- Same as Shopify but via OpenCart REST API

### 5.3 Advanced AI
- Product image analysis (customer sends photo → bot identifies product)
- Voice message transcription
- Multi-language support (if expanding beyond Ukraine)

---

## Immediate Next Steps (what to build right now)

1. **Fix remaining reply engine bugs** (Phase 1.1 — the bugs from log analysis)
2. **Test full conversation flow end-to-end** (Phase 1.2 verification)
3. **Order persistence + Shopify draft order** (Phase 2.1-2.2)
4. **Telegram handoff** (Phase 2.3)
5. **Manager reply detection** (Phase 2.4)

---

## Files & Architecture Summary

```
apps/api/src/
  modules/
    engine/                    # Template engine, classifier, policy
      classifier.service.ts    # AI classification only
      template-engine.service.ts # Template selection + rendering
      policy-engine.service.ts  # Escalation rules
      store-config.controller.ts # CRUD for templates/config
    conversations/
      reply-engine.service.ts  # Orchestrator: classify → policy → search → template → fallback
    channels/instagram/
      instagram.service.ts     # Webhook handler, debouncing, message send
    screenshot-training/       # Screenshot upload, extraction, review
    catalog/                   # Product CRUD
    availability/              # Product search (ILIKE + trigram)

apps/admin/src/
  pages/
    TrainingPage.tsx           # Screenshot training UI
    ConnectionsPage.tsx        # Instagram/Shopify connections
    ConversationsPage.tsx      # Conversation list (needs work)
    DashboardPage.tsx          # Analytics (needs work)
    SettingsPage.tsx           # Store config (needs work)
```
