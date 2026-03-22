# AI Instagram Assistant — Roadmap

## 1. Roadmap Goal

This roadmap is meant to keep implementation focused and practical.
It is optimized for shipping a real MVP for one pilot client, then hardening the product for reuse.

## 2. Guiding Strategy

### Step 1
Prove the core workflow with one real business and one real Instagram account.

### Step 2
Reduce manual work while keeping human fallback safe.

### Step 3
Standardize repeated patterns into reusable product components.

### Step 4
Only after strong evidence of value, move toward broader SaaS packaging.

## 3. Phase 0 — Product Framing

### Objectives
- define a narrow MVP,
- choose first business vertical,
- choose first pilot client profile,
- define success criteria.

### Deliverables
- product overview document,
- technical specification,
- pricing hypothesis,
- target client profile,
- MVP scope agreement.

### Checklist
- [ ] Finalize first vertical: fashion store
- [ ] Finalize first client profile
- [ ] Define pilot success metrics
- [ ] Decide on pricing approach for pilot
- [ ] Confirm first CRM/source integration target

## 4. Phase 1 — Discovery with Pilot Client

### Objectives
- understand the client's current workflow,
- identify the true source of product/stock data,
- map common conversation patterns,
- define acceptable automation boundaries.

### Deliverables
- integration discovery notes,
- source-of-truth mapping,
- handoff criteria,
- top 20–50 message examples,
- order flow requirements.

### Checklist
- [ ] Identify which system holds real stock
- [ ] Confirm whether API, webhook, or file sync is available
- [ ] Confirm variant structure: SKU / size / color
- [ ] Collect real manager conversation examples
- [ ] Define supported order fields
- [ ] Define business hours and escalation rules

## 5. Phase 2 — Core Backend Foundation

### Objectives
- create backend skeleton,
- define database schema,
- implement conversation-safe domain logic.

### Deliverables
- NestJS backend scaffold,
- Postgres schema,
- base modules,
- environment setup,
- logging foundation.

### Checklist
- [ ] Initialize monorepo or repo structure
- [ ] Create backend project
- [ ] Add config management
- [ ] Add DB connection and migrations
- [ ] Create base modules:
  - [ ] auth
  - [ ] stores
  - [ ] conversations
  - [ ] catalog
  - [ ] availability
  - [ ] orders
  - [ ] integrations
- [ ] Create OpenAPI docs
- [ ] Add structured logging

## 6. Phase 3 — Instagram Integration

### Objectives
- receive real Instagram messages,
- store inbound events,
- send outbound replies.

### Deliverables
- Meta webhook handler,
- account mapping,
- outbound messaging support,
- event normalization.

### Checklist
- [ ] Configure Meta app
- [ ] Set up webhook verification
- [ ] Store Instagram account connection
- [ ] Map Instagram user IDs to customers
- [ ] Save inbound messages
- [ ] Send outbound messages through API
- [ ] Add retries and error handling

## 7. Phase 4 — Product and Stock Sync

### Objectives
- keep catalog and stock data current,
- support first client's source system reliably.

### Deliverables
- sync pipeline,
- normalized product model,
- stock freshness tracking,
- sync logs.

### Checklist
- [ ] Implement connector for first source system
- [ ] Normalize products and variants
- [ ] Upsert stock balances
- [ ] Store last_synced_at timestamps
- [ ] Build sync logs
- [ ] Add manual re-sync capability
- [ ] Add stale-data safeguards

## 8. Phase 5 — AI Reply Engine

### Objectives
- detect intent,
- generate safe and useful replies,
- use deterministic business checks.

### Deliverables
- reply engine,
- product search flow,
- stock-check flow,
- handoff decision logic,
- tone support.

### Checklist
- [ ] Implement intent classification
- [ ] Implement product matching service
- [ ] Implement stock check service
- [ ] Add tone prompt support
- [ ] Add manager example retrieval
- [ ] Add safe-response rules
- [ ] Add low-confidence handoff rules

## 9. Phase 6 — Draft Order Flow

### Objectives
- move from product conversation to order capture,
- reduce manual work in checkout.

### Deliverables
- order intent detection,
- optional reservation flow,
- structured order detail collection,
- draft order creation.

### Checklist
- [ ] Detect order intent
- [ ] Re-check stock before checkout
- [ ] Add optional reservation table/logic
- [ ] Build order detail collection flow
- [ ] Validate phone/city/branch/payment data
- [ ] Create draft order entity
- [ ] Add manager notification on draft creation

## 10. Phase 7 — Admin Panel MVP

### Objectives
- give operators visibility and control.

### Deliverables
- admin login,
- dashboard,
- conversations screen,
- connections screen,
- settings screen,
- logs screen.

### Checklist
- [ ] Create React admin app
- [ ] Add auth flow
- [ ] Build dashboard screen
- [ ] Build conversations list and thread view
- [ ] Add takeover / release controls
- [ ] Add connections status page
- [ ] Add tone and rules settings page
- [ ] Add logs / audit view

## 11. Phase 8 — Handoff and Reliability

### Objectives
- ensure failures and edge cases are safe,
- improve operator confidence.

### Deliverables
- human handoff workflow,
- alerts,
- idempotency,
- error handling,
- recovery tools.

### Checklist
- [ ] Add Slack/Telegram alert flow
- [ ] Add conversation escalation status
- [ ] Add idempotent webhook processing
- [ ] Add retry policy for external calls
- [ ] Add fallback messages on failure
- [ ] Add runbooks for common issues

## 12. Phase 9 — Pilot Launch

### Objectives
- release to one real client,
- observe carefully,
- iterate fast.

### Deliverables
- live deployment,
- support workflow,
- baseline KPI tracking,
- issue tracker.

### Checklist
- [ ] Deploy backend
- [ ] Deploy admin panel
- [ ] Deploy n8n instance
- [ ] Run end-to-end testing
- [ ] Start with limited conversation volume if needed
- [ ] Review first live conversations daily
- [ ] Track KPI baseline
- [ ] Record failure patterns

## 13. Phase 10 — Post-Pilot Hardening

### Objectives
- convert one-off logic into reusable product patterns.

### Deliverables
- reusable connector patterns,
- cleaner settings model,
- improved auditability,
- more robust deployment and ops.

### Checklist
- [ ] Refactor client-specific assumptions
- [ ] Standardize integration interfaces
- [ ] Improve internal documentation
- [ ] Extract reusable config objects
- [ ] Add stronger admin controls
- [ ] Add better analytics

## 14. Phase 11 — Toward Multi-Client Productization

### Objectives
- prepare for more than one client,
- define product boundaries more clearly.

### Deliverables
- tenant model hardening,
- usage limits,
- pricing tiers,
- onboarding flow design.

### Checklist
- [ ] Add tenant-aware config isolation
- [ ] Add plan and usage tracking
- [ ] Add more reusable connection patterns
- [ ] Define onboarding checklist for new clients
- [ ] Prepare founder pricing / standard pricing transition

## 15. Deferred / Later Features

These should not block the MVP.

### Later candidates
- multi-product cart flow,
- payment link generation,
- shipping label creation,
- advanced analytics,
- full self-serve onboarding,
- multilingual localization depth,
- support for more channels,
- beauty/barber slot adapter,
- campaign and broadcast workflows where allowed.

## 16. Suggested Execution Order

A practical order of implementation:

1. Product framing
2. Pilot client discovery
3. Backend foundation
4. Instagram integration
5. Product/stock sync
6. AI reply engine
7. Draft order flow
8. Admin panel
9. Reliability + handoff
10. Pilot launch
11. Hardening
12. Productization

## 17. Definition of MVP Done

The MVP can be considered done when all of the following are true:
- one real client is connected,
- inbound Instagram DMs are processed reliably,
- product availability is checked from synced data,
- AI can answer common questions safely,
- handoff works,
- draft orders can be created,
- admin panel provides visibility,
- the team can operate the system in production,
- basic success metrics are being tracked.
