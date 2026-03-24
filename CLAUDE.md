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
- Instagram webhook handler with debouncing (5s), message_edit fallback, echo filtering
- **Template-based reply engine** with slot-filling flow, AI classification only
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
- Message debouncing: 5s window, collects multiple messages before processing

## Known Issues / TODOs

### Critical — Next Steps
- **Test selection flow end-to-end** — variant matching, corrections, checkout gate
- **Order persistence** — save orders to DB, create draft order in Shopify
- **Telegram handoff notifications** — notify manager when bot escalates
- **Manager reply detection** — detect is_echo from manager, pause bot

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

## Issue Triage Protocol

When encountering a conversation issue, ALWAYS classify it first before fixing:

1. **Bug** — code doesn't do what the architecture intended (missing memory write, wrong variable, typo). Quick fix.
2. **AI went wrong** — classifier returned wrong intent/slotAction/entities. Fix by improving prompt, adding examples, or enriching context.
3. **Architectural** — the design can't handle this case (missing state, no template for scenario, flow doesn't support this path). Needs refactor/plan.

State the classification before proposing a fix. This prevents over-engineering bugs and under-engineering architectural gaps.

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
