# DirectMate — MVP Roadmap

## Goal
Ship a working product for the first client.
The system handles inbound Instagram DMs automatically, checks real stock, replies in the client's tone, and escalates to a human when needed.
The admin panel gives full visibility and control.

n8n workflows are managed separately and will call the API endpoints defined here.

---

## Status legend
- [ ] To do
- [x] Done
- [~] In progress

---

## 1. Backend API

### Foundation
- [x] NestJS monorepo setup
- [x] Postgres + TypeORM + migrations
- [x] JWT auth (`POST /auth/login`, `GET /auth/me`)
- [x] Global error shape
- [x] Swagger docs at `/docs`
- [x] Seed script (tenant + admin user)
- [x] Naming strategy (snake_case)

### Instagram channel
- [x] Webhook verification (`GET /channels/instagram/webhook`)
- [x] Inbound webhook handler (`POST /channels/instagram/webhook`)
- [x] Inbound message saved to DB
- [x] Outbound message send via Meta Graph API
- [x] Connection record stores page access token (per client)
- [x] Webhook routes to correct tenant by Instagram account ID

### Conversation engine
- [x] Customer find-or-create
- [x] Conversation find-or-create
- [x] Conversation state tracking
- [x] Message history saved
- [x] Takeover / release endpoints
- [x] Escalation logic (sets needs_handoff)
- [x] `POST /conversation/reply` — explicit endpoint for n8n to trigger processing

### Availability
- [x] `POST /availability/check` — deterministic stock lookup
- [x] Stock freshness gate (refuses stale data)
- [x] Effective stock formula (`available - reserved - pending_checkout`)

### AI reply engine
- [x] Intent flow skeleton (ReplyEngineService)
- [x] Handoff trigger on max failed turns
- [x] Brand tone + manager examples loaded into context
- [x] OpenAI call wired (`gpt-4o` via `openai` SDK)
- [x] Prompt template: tone + examples + conversation history + availability result
- [ ] Low-confidence handoff

### Catalog sync (called by n8n)
- [x] `POST /internal/sync/catalog` — accepts sync job from n8n
- [x] `POST /internal/sync/stock` — accepts sync job from n8n
- [x] `POST /internal/sync/catalog-import` — bulk product+variant+stock import (normalized payload from n8n)
- [x] `POST /internal/sync/stock-import` — bulk stock update by externalVariantId
- [x] Product upsert
- [x] Variant upsert
- [x] Stock balance upsert
- [x] Sync job status updates (`PATCH /internal/sync/jobs/:id`)
- [x] Freshness timestamp updated on each sync (`connections.last_sync_at`)

### Orders
- [x] Checkout session start
- [x] Customer info collection
- [x] Draft order creation
- [x] Manager notification on draft order created (fire-and-forget webhook)

### Reservations
- [x] Soft reservation create/cancel
- [x] Reservation expiry cron job (every 5 min, frees `reserved_qty`)

### Connections
- [x] `GET /connections`
- [x] `POST /connections/:id/disconnect`
- [x] `POST /connections/instagram` — manual access token entry (encrypted, stored)
- [x] `POST /connections/shopify` — manual Shopify domain + access token entry (encrypted)

### Settings
- [x] `GET /settings` / `PATCH /settings`
- [x] Manager examples CRUD

---

## 2. Admin Panel

### Auth
- [x] Login page (functional)
- [x] Login page — design pass (logo card, styled inputs, error state)

### Layout & navigation
- [x] Sidebar navigation skeleton
- [x] Sidebar — design pass (logo + icon, active states, Lucide icons, user email)
- [ ] Responsive layout

### Dashboard
- [x] Total conversations count
- [x] Needs handoff count
- [x] Add: auto-handled vs escalated ratio
- [ ] Add: draft orders today
- [x] Design pass (stat cards with icons, "needs attention" list)

### Conversations
- [x] Conversations list (functional)
- [x] Conversation detail with message thread (functional)
- [x] Takeover / release buttons (functional)
- [x] Conversations list — design pass (filter tabs, status badges, handoff highlight, timestamps)
- [x] Conversation detail — design pass (chat bubble UI, role labels, state panel)
- [x] Real-time or polling refresh (15s list / 5s detail)
- [x] Handoff banner when conversation needs attention

### Connections
- [x] Connections list (functional)
- [x] Disconnect button (functional)
- [x] Design pass (status badges, last sync time, account name)
- [x] Connect Instagram form (paste pageId + access token → POST /connections/instagram)

### Settings
- [x] Brand tone edit (functional)
- [x] Manager examples list + add/delete
- [x] Handoff rules edit (max failed turns, freshness minutes, sentiment toggle)
- [ ] Business hours edit
- [x] Design pass

### Catalog / stock
- [x] Products list with search
- [x] Stock levels per variant (effective available)
- [x] Last synced timestamp visible (freshness indicator green/amber/red)

### Logs
- [x] Audit log viewer by conversation ID (functional)
- [x] Design pass (badges, formatted timestamps, JSON details)
- [ ] Sync job history

---

## 3. First Client Checklist

These must be completed before going live with the first store.

- [ ] Client Instagram account connected (access token stored in DB)
- [ ] Catalog synced from client's source system (via n8n)
- [ ] Stock synced and fresh
- [ ] Brand tone prompt written and tested
- [ ] 5–10 manager example conversations added
- [ ] Handoff rules configured
- [ ] Webhook URL registered in Meta app dashboard
- [ ] End-to-end test: send a real DM → AI replies → check admin panel
- [ ] Takeover flow tested manually
- [ ] Draft order flow tested manually
- [ ] Admin user created for client

---

## 4. n8n Workflows (Shopify Connector)

- [x] `Shopify: Catalog Sync` — every 30 min, fetches products → normalizes → imports to backend
- [x] `Shopify: Inventory Poll Sync` — every 10 min, fetches variant stock → updates backend
- [x] `Shopify: Connection Health Check` — every 15 min, verifies token validity
- [ ] Configure with real Shopify credentials and activate
- [ ] Connect Shopify form in admin panel (paste domain + access token → POST /connections/shopify)

---

## Out of scope for MVP
- Multi-client self-serve onboarding
- Payments inside chat
- Outbound / broadcast messaging
- Advanced analytics
- Multilingual depth beyond basic support
- Appointment / slot booking vertical
