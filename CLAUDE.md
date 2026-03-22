# DirectMate — Project Context

## What is DirectMate

A configurable AI sales assistant platform for Instagram DMs. Not a single chatbot — a **platform** where each store configures its own AI agent through an admin panel.

**Core principle: One engine. Many stores. Each store defines behavior through configuration.**

The goal is **70-80% automated order completion** from Instagram DMs, saving stores the cost of full-time sales managers.

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
- AI reply engine v2 with state machine, dialogue acts, assistant memory
- Product catalog with multi-strategy search (ILIKE + trigram fuzzy on title/category)
- Availability service with stock checking
- Crypto service (AES-256-GCM) for encrypting access tokens
- Shopify connection (manual token paste, encrypted storage)
- Screenshot training pipeline (GPT-4o vision extraction, conversation grouping, review/approve workflow)
- Privacy policy page for Meta app requirements
- Conversation logging to `conversations.log`

### Admin Panel (apps/admin)
- Login, Dashboard, Conversations, Connections, Settings, Training, Logs pages
- Settings: brand tone editor, handoff rules, manager examples (Q&A pairs)
- Connections: Instagram + Shopify connection management
- Training: screenshot upload with drag-and-drop, extraction review with chat-style transcript display

### n8n Workflows (deployed)
- **Shopify: Catalog Sync** — GraphQL, paginated, every 30min
- **Shopify: Inventory Poll Sync** — GraphQL, every 10min
- **Shopify: Connection Health Check** — every 15min
- **OpenCart: Catalog Sync** — REST API with session auth, paginated
- **OpenCart: Inventory Poll Sync** — REST API, paginated
- **OpenCart: Connection Health Check** — API login verification

## Current AI Architecture (NEEDS REFACTORING)

The current reply engine uses generative AI for responses. This produces inconsistent, "bot-sounding" replies. The spec in `direct_mate.md` defines the correct architecture.

### Current (broken) flow:
```
message → AI classifies + generates reply → send
```

### Target architecture (from direct_mate.md):
```
message → AI classification only (intent, entities, stage)
  → engine picks scenario from store config
  → engine selects template
  → engine interpolates variables
  → anti-repetition check
  → safety validation
  → send reply
```

**AI should do: classification, entity extraction, stage detection**
**AI should NOT do: writing reply text**

Reply text comes from **templates** configured per store.

## Key Configurations (Per Store)

From `direct_mate.md`, each store configures:

1. **Brand Config** — language, formality, emoji policy, allowed/disallowed phrases
2. **Flow Config** — enabled stages, transitions, progression
3. **Scenario Config** — intent-to-scenario mapping, template groups per scenario
4. **Template Config** — editable templates with variables, blocks, priorities, variants
5. **Phrase Blocks** — reusable openers, CTAs, reassurance phrases
6. **Checkout Config** — fields to collect, order, validation, single vs step-by-step
7. **Escalation Config** — always-escalate intents, confidence thresholds, sentiment triggers
8. **Catalog Mapping** — source type, field mapping, price format
9. **Recommendation Config** — mode (single/top-3), attribute priority
10. **Handoff Config** — notification channel (Telegram), pause behavior, summary
11. **FAQ Config** — delivery, payment, returns, custom answers
12. **Fallback Config** — strict_templates_only / template_first_with_safe_fallback

## Conversation Flow Stages

```
greeting → need_discovery → product_discovery → showing_options
  → selection_help → product_selected → checkout_started
  → collecting_customer_info → order_confirmation
  → post_order_support | handoff_to_manager
```

## AI Understanding Contract

AI returns structured data, NOT reply text:
```json
{
  "primary_intent": "product_inquiry",
  "entities": { "category": "сукня", "color": "чорна" },
  "conversation_stage": "product_discovery",
  "sentiment": "neutral",
  "confidence": 0.88,
  "recommended_next_action": "show_matching_products"
}
```

## Template System

Templates are store-configurable with variables:
```json
{
  "scenario": "show_price",
  "blocks": [
    "Ціна на {product_name} — {price} грн 💛",
    "Якщо хочете, можу одразу допомогти з оформленням"
  ],
  "required_variables": ["product_name", "price"]
}
```

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

## Known Issues / TODOs

### Critical — Next Steps
- **Refactor reply engine to template-based system** (current generative approach sounds "bot-like")
  - AI only classifies (intent, entities, stage)
  - Engine selects template from store config
  - Engine interpolates variables
  - Fallback to AI generation only when no template matches
- **Template management in admin panel** — CRUD for templates, phrase blocks, scenarios
- **Store configuration system** — brand config, flow config, checkout config, escalation config

### Important
- Telegram notification on handoff (TODO in instagram.service.ts)
- Long-lived Instagram token exchange (current tokens expire in ~1 hour)
- Product search: also search in `description` field
- Multi-product orders (cart concept)
- Order persistence and status tracking

### Technical Debt
- `apps/api/dist/` files were tracked in git (now gitignored)
- `17841400073793607` webhook entries logged as "No connected Instagram account" — this is the second IG Business Account ID, harmless but noisy
- ConnectionsPage has pre-existing TypeScript errors
- Some `as any` casts on TypeORM jsonb column updates

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
