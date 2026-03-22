# DirectMate — MVP Tickets

Tickets are ordered by dependency and priority.
Each ticket should be a single focused PR.

---

## Backend

### BE-01 — Wire outbound Instagram send
**What:** Replace the `[SEND]` log stub in `InstagramService.processInbound()` with a real call to the Meta Graph API.
**Scope:**
- Read page access token from the `connections` table for the active tenant
- `POST https://graph.facebook.com/v19.0/me/messages` with the reply text
- Log success/failure to audit log
- On send failure → escalate conversation instead of silently dropping

**File:** `apps/api/src/modules/channels/instagram/instagram.service.ts`

---

### BE-02 — Instagram connection: store access token
**What:** When a client connects their Instagram account, store the access token in the DB.
**Scope:**
- `POST /connections/instagram/callback` — receives OAuth code, exchanges for page access token, saves encrypted to `connections` table
- Encryption: use AES-256-GCM with a key from env (`ENCRYPTION_KEY`)
- Add `ENCRYPTION_KEY` to `.env.example` and config
- Set `connection.status = connected`, `connection.external_account_id = instagram_page_id`

**File:** `apps/api/src/modules/integrations/integrations.controller.ts` + new `crypto.service.ts`

---

### BE-03 — Webhook routes to correct tenant
**What:** Currently `tenantId` is passed as a query param in the webhook URL. Make it robust.
**Scope:**
- On inbound webhook, extract `recipient.id` (the Instagram page ID)
- Look up `connections` table: `WHERE external_account_id = recipient.id AND type = 'instagram'`
- Resolve `tenant_id` from the connection — remove `?tenantId=` query param dependency
- If no connection found → log and return 200 (Meta requires 200 always)

**File:** `apps/api/src/modules/channels/instagram/instagram.service.ts`

---

### BE-04 — Wire OpenAI into ReplyEngineService
**What:** Replace the `generateReply()` stub with a real OpenAI chat completion call.
**Scope:**
- Install `openai` package
- Build prompt: system message = brand tone + instructions, few-shot examples from `manager_examples`, conversation history, availability context
- Call `openai.chat.completions.create()`
- Return the assistant message text
- On OpenAI error → escalate conversation, log to audit

**File:** `apps/api/src/modules/conversations/reply-engine.service.ts`

---

### BE-05 — POST /conversation/reply endpoint
**What:** Explicit endpoint for n8n (or testing) to trigger inbound message processing without going through the Instagram webhook.
**Scope:**
- `POST /conversation/reply` — accepts the contract from `api_contracts.md`
- Internally calls the same pipeline as `InstagramService.processInbound()`
- Protected by `InternalApiKeyGuard`
- Returns: `conversationId`, `decision`, `reply`, `handoff`, `state`

**File:** new controller method in `apps/api/src/modules/conversations/conversations.controller.ts`

---

### BE-06 — Reservation expiry cron
**What:** Expired reservations should free up stock automatically.
**Scope:**
- Install `@nestjs/schedule`
- Add `ScheduleModule.forRoot()` to `AppModule`
- Add `@Cron('*/5 * * * *')` in `ReservationsService` that calls `expireStale()`
- When expiring: decrement `stock_balances.reserved_qty` for each expired reservation

**File:** `apps/api/src/modules/reservations/reservations.service.ts`

---

### BE-07 — Draft order manager notification
**What:** When a draft order is created, notify the manager.
**Scope:**
- After `OrdersService.createDraft()` succeeds, call a configurable webhook URL
- Store webhook URL in `tenant_settings.ai_settings` (e.g. `{ notificationWebhookUrl: '...' }`)
- POST payload: `{ orderId, customerId, conversationId, totalAmount, status }`
- Fire-and-forget with error logging, never block the order creation

**File:** `apps/api/src/modules/orders/orders.service.ts`

---

### BE-08 — Sync job status lifecycle
**What:** n8n calls `/internal/sync/catalog` or `/internal/sync/stock`, gets a `jobId`, then should be able to report back success/failure.
**Scope:**
- `PATCH /internal/sync/jobs/:id` — accepts `{ status: 'success' | 'failed', summary?, errorMessage? }`
- Updates `sync_jobs` record accordingly
- Updates `connections.last_sync_at` on success
- Protected by `InternalApiKeyGuard`

**File:** `apps/api/src/modules/internal/internal.controller.ts`

---

## Admin Panel

### FE-01 — Design system setup
**What:** Establish base design tokens and reusable components before building screens.
**Scope:**
- Configure Tailwind: custom colors (brand, gray scale, status colors), font, border radius
- Create base components:
  - `Button` (primary, secondary, danger, sizes)
  - `Badge` (status: active, handoff, closed, connected, error)
  - `Card`
  - `Input`, `Textarea`, `Select`
  - `Spinner` / `LoadingState`
  - `EmptyState`
- No page changes yet, just the component library

**File:** `apps/admin/src/components/ui/`

---

### FE-02 — Layout and sidebar design
**What:** Replace the current plain sidebar with a proper design.
**Scope:**
- Logo / product name at the top
- Nav items with icons (use `lucide-react`)
- Active state highlight
- Bottom section: current user email + sign out
- Consistent page wrapper with header slot

**File:** `apps/admin/src/components/Layout.tsx`

---

### FE-03 — Login page design
**What:** Polish the login page.
**Scope:**
- Centered card with logo
- Proper input styling from FE-01
- Error state display
- Loading state on submit button

**File:** `apps/admin/src/pages/LoginPage.tsx`

---

### FE-04 — Dashboard design
**What:** Make the dashboard actually useful for the operator.
**Scope:**
- Stats row: total conversations, needs handoff, auto-handled today, draft orders today
- Recent conversations needing attention (needs_handoff = true) — list with link to each
- Recent sync status (last catalog sync, last stock sync, freshness)
- All data from existing API endpoints

**File:** `apps/admin/src/pages/DashboardPage.tsx`

---

### FE-05 — Conversations list design
**What:** Make the conversations list scannable and actionable.
**Scope:**
- Tabs or filter pills: All / Needs handoff / Active / Closed
- Each row: customer username, last message preview, time, status badge, handoff badge
- Highlight needs-handoff rows (e.g. red left border)
- Polling every 15s for new conversations
- Pagination or infinite scroll

**File:** `apps/admin/src/pages/ConversationsPage.tsx`

---

### FE-06 — Conversation detail design
**What:** Full conversation view for operators.
**Scope:**
- Header: customer username, status badge, takeover/release button
- Chat bubble UI: inbound (left), outbound (right), role label (AI / Manager)
- Right panel: conversation state (selected product, selected variant, checkout status)
- Handoff banner if `needs_handoff = true` with reason
- Auto-scroll to latest message
- Polling every 5s for new messages while open

**File:** `apps/admin/src/pages/ConversationDetailPage.tsx`

---

### FE-07 — Catalog page (new)
**What:** Give operators visibility into synced products and stock.
**Scope:**
- Product list with search by name
- Each product: title, category, variant count, last synced
- Expand to show variants: size, color, price, effective stock, freshness indicator (green/yellow/red)
- Manual re-sync button → calls `POST /internal/sync/stock`

**Files:** new `apps/admin/src/pages/CatalogPage.tsx` + add route in `App.tsx` + add to sidebar

---

### FE-08 — Settings page design
**What:** Full settings screen for the operator.
**Scope:**
- Brand tone textarea (existing, needs design)
- Manager examples: list of examples, add new (customer message + manager reply + tags), delete
- Handoff rules: max failed turns, stock freshness minutes, sentiment escalation toggle
- Business hours: timezone, days of week, start/end time
- Save button per section with success feedback

**File:** `apps/admin/src/pages/SettingsPage.tsx`

---

### FE-09 — Connections page design
**What:** Operator sees which integrations are connected and their health.
**Scope:**
- Each connection: type icon, status badge, last sync time
- Instagram connection: show connected account name/ID
- CRM connection: show source type, last sync, record count from last job
- Disconnect button with confirm dialog
- Placeholder "Connect Instagram" button (OAuth flow — not wired yet)

**File:** `apps/admin/src/pages/ConnectionsPage.tsx`

---

## First Client

### CL-01 — First client setup checklist
**What:** Operational steps before going live (not code).
- [ ] Client Instagram page connected via OAuth (BE-02 must be done)
- [ ] `ENCRYPTION_KEY` set in production env
- [ ] Meta app webhook URL configured pointing to production
- [ ] Catalog synced via n8n → verify products visible in FE-07
- [ ] Stock synced and fresh (< 10 min old)
- [ ] Brand tone prompt written with client
- [ ] 5–10 manager example conversations added via FE-08
- [ ] Handoff rules confirmed with client
- [ ] Admin user created for client (`npm run seed`)
- [ ] End-to-end test: send DM → AI replies → visible in admin panel
- [ ] Takeover flow tested
- [ ] Draft order flow tested

---

## Suggested order

```
BE-02 → BE-03 → BE-01   (Instagram connect → route → send)
BE-04                    (OpenAI — can run in parallel)
BE-05                    (n8n reply trigger)
BE-06                    (cron — small, anytime)
BE-07                    (notifications — after orders work)
BE-08                    (sync lifecycle — coordinate with n8n)

FE-01 → FE-02 → FE-03   (design system first, then layout, then login)
FE-04 → FE-05 → FE-06   (dashboard → list → detail)
FE-07 → FE-08 → FE-09   (catalog → settings → connections)

CL-01                    (after all above)
```
