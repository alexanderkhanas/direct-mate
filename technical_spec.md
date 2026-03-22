# AI Instagram Assistant — Technical Specification

## 1. Technical Objective

Build an MVP that can:
- receive Instagram DMs through Meta,
- process them with AI and deterministic business logic,
- check product availability from synced data,
- generate safe responses,
- collect order details,
- create draft orders,
- escalate to human staff when required.

## 2. Recommended Architecture

### Main stack
- Backend API: NestJS
- Frontend admin panel: React SPA with Vite
- Database: Postgres / Supabase
- Automation / integration layer: n8n
- AI provider: OpenAI or compatible LLM provider
- Channel provider: Meta Instagram Messaging API

### Architecture roles

#### Backend (NestJS)
Responsible for:
- tenant/store logic,
- conversation state,
- product matching logic,
- stock and reservation logic,
- order draft flow,
- escalation rules,
- API contracts for admin panel,
- secure token/credential handling.

#### n8n
Responsible for:
- sync jobs from CRM / store / files,
- integration orchestration,
- scheduled tasks,
- alerts and notifications,
- webhook glue logic,
- async automation support.

#### React admin panel
Responsible for:
- conversation monitoring,
- takeover and handoff,
- connection health,
- settings,
- logs / audit view,
- inventory visibility.

## 3. High-Level System Flow

### Inbound conversation flow
1. Customer sends Instagram DM.
2. Meta sends webhook event.
3. Event is routed through n8n or directly to backend.
4. Backend normalizes the event.
5. Backend loads conversation state and recent messages.
6. Backend classifies intent.
7. If availability is needed, backend performs deterministic lookup.
8. Backend decides whether AI can answer or handoff is required.
9. Backend generates a response.
10. Message is sent back through Meta API.
11. Conversation state and logs are updated.

### Product sync flow
1. Scheduled or event-driven sync is triggered.
2. External source is queried.
3. Products and variants are normalized.
4. Stock data is upserted into Postgres.
5. Sync logs and freshness timestamps are stored.

### Draft order flow
1. AI detects order intent.
2. Backend re-checks stock.
3. Optional soft reservation is created.
4. AI collects order fields.
5. Backend validates fields.
6. Draft order is created.
7. Manager is notified if needed.

## 4. Data Model

### Core tables

#### stores
Represents a business account.

Suggested fields:
- id
- name
- instagram_account_id
- brand_tone_prompt
- active
- created_at
- updated_at

#### customers
Represents Instagram users speaking with the store.

Suggested fields:
- id
- store_id
- instagram_user_id
- username
- full_name
- last_seen_at
- created_at

#### conversations
Represents one conversation thread.

Suggested fields:
- id
- store_id
- customer_id
- channel
- status
- current_state
- last_message_at
- assigned_to_user_id
- created_at
- updated_at

#### messages
Stores inbound and outbound messages.

Suggested fields:
- id
- conversation_id
- direction
- role
- message_text
- tool_calls_json
- metadata_json
- created_at

#### products
Product parent entity.

Suggested fields:
- id
- store_id
- external_product_id
- title
- description
- category
- brand
- status
- created_at
- updated_at

#### product_variants
Variant-level entity.

Suggested fields:
- id
- product_id
- external_variant_id
- sku
- color
- size
- price
- currency
- active
- created_at
- updated_at

#### stock_balances
Availability source for inventory.

Suggested fields:
- id
- variant_id
- available_qty
- reserved_qty
- last_synced_at
- updated_at

#### reservations
Short-lived reservation during checkout.

Suggested fields:
- id
- variant_id
- customer_id
- qty
- status
- expires_at
- created_at

#### draft_orders
Intermediate order entity.

Suggested fields:
- id
- store_id
- customer_id
- conversation_id
- variant_id
- qty
- full_name
- phone
- city
- delivery_provider
- branch
- payment_method
- status
- external_order_id
- created_at
- updated_at

#### manager_examples
Style examples for brand tone.

Suggested fields:
- id
- store_id
- scenario
- customer_message
- manager_reply
- tags
- created_at

#### sync_logs
Sync visibility.

Suggested fields:
- id
- store_id
- source_type
- sync_type
- status
- started_at
- finished_at
- records_processed
- error_message

## 5. Conversation State Model

Suggested conversation states:
- browsing
- clarifying_product
- product_selected
- stock_confirmed
- collecting_order_info
- draft_order_created
- awaiting_manager
- resolved
- cancelled

Suggested order states:
- pending
- awaiting_details
- reserved
- draft_created
- awaiting_confirmation
- confirmed
- failed
- expired

## 6. Deterministic Rules

### Availability rules
- AI must never assert stock without a backend stock check.
- Variant-level checks are required for fashion.
- If stock freshness is too old, AI must not confidently confirm availability.
- If effective availability is zero or below, AI must not promise the item.

### Effective stock formula
`effective_available = available_qty - reserved_qty`

### Reservation rules
- Reservation is optional in MVP but recommended.
- Reservation timeout should be short, for example 15–20 minutes.
- Reservation must expire automatically.

### Handoff rules
Trigger handoff if:
- product cannot be matched confidently,
- data is stale,
- CRM/source sync is failing,
- customer requests human support,
- customer asks for custom discounts or edge cases,
- AI confidence is too low,
- order creation fails.

## 7. API Design

### Suggested backend endpoints

#### Instagram / channel
- `POST /webhooks/meta/instagram`
- `POST /channels/instagram/send`

#### Conversations
- `POST /conversation/reply`
- `GET /conversations`
- `GET /conversations/:id`
- `POST /conversations/:id/takeover`
- `POST /conversations/:id/release`

#### Availability
- `POST /availability/check`
- `POST /catalog/search`

#### Orders
- `POST /orders/draft`
- `GET /orders/drafts`
- `GET /orders/drafts/:id`

#### Connections
- `GET /connections`
- `POST /connections/meta`
- `POST /connections/crm`
- `POST /connections/test`

#### Admin settings
- `GET /settings`
- `PATCH /settings/tone`
- `PATCH /settings/handoff-rules`
- `PATCH /settings/business-rules`

## 8. AI Responsibilities vs Backend Responsibilities

### AI responsibilities
- classify intent,
- interpret natural language,
- generate customer-facing messages,
- follow brand tone,
- ask structured follow-up questions,
- summarize context for a manager.

### Backend responsibilities
- determine what is factually safe to say,
- compute availability,
- manage conversation state,
- validate order inputs,
- trigger handoff,
- create reservations and draft orders,
- enforce business rules.

## 9. n8n Responsibilities

n8n should not be the product brain.
It should act as the automation and integration shell.

Recommended n8n responsibilities:
- CRM sync jobs,
- stock sync jobs,
- CSV/XLSX import flows,
- retryable external integrations,
- Slack/Telegram notifications,
- operational alerts,
- scheduled cleanup / maintenance flows.

## 10. Frontend Admin Requirements

### MVP admin screens
- Login
- Dashboard
- Conversations
- Catalog / stock status
- Connections
- Settings
- Logs / audit

### Frontend stack
- React SPA
- Vite
- TypeScript
- React Router
- Tailwind CSS
- shadcn/ui
- TanStack Query

## 11. Integration Modes

### Mode A — Realtime API + webhook
Use when CRM or platform supports API and stock change webhooks.
Best for modern systems.

### Mode B — Scheduled API sync
Use when API exists but outbound webhooks do not.
Run periodic sync every few minutes.

### Mode C — Legacy file import
Use CSV/XLSX/XML when client systems are older.
Support manager-driven or automated file drops.

## 12. Instagram / Meta Requirements

### Functional assumptions
- client must use Instagram Professional account,
- Meta app integration is required,
- messaging permissions must be approved,
- webhook endpoint must be configured,
- messaging is mainly for inbound customer-service style flows.

### Technical needs
- webhook verification,
- access token storage,
- account mapping,
- send message support,
- conversation/user mapping.

## 13. Reliability Requirements

### Must-have reliability rules
- idempotent webhook handling,
- retry policy for external calls,
- logging of every sync and outbound action,
- fallback to handoff on critical failure,
- clear audit trail for AI actions.

### Suggested observability
- request logs,
- webhook processing logs,
- sync logs,
- error alerts,
- conversation event logs,
- stock freshness metrics.

## 14. Security and Access

### Minimum requirements
- secure credential storage,
- role-based admin access,
- environment separation,
- audit logs for manual actions,
- server-side validation for all mutations.

## 15. Recommended Repo Structure

```txt
apps/
  api/        # NestJS backend
  admin/      # React SPA admin panel
packages/
  shared/     # shared types, schemas, utils
infra/
  docker/
  scripts/
docs/
```

## 16. Implementation Phases

### Phase 1
- Instagram inbound handling
- product sync
- stock sync
- conversation reply logic
- basic admin views

### Phase 2
- draft order flow
- reservation support
- handoff UX
- improved logs

### Phase 3
- stronger analytics
- reusable integrations
- plan limits
- multi-tenant hardening
