# Database Schema

## Purpose
This document defines the initial database schema for the MVP.
The database is the canonical source of truth for:
- tenants and users,
- channel connections,
- products and variants,
- stock balances,
- customers and conversations,
- reservations and draft orders,
- logs and settings.

Primary database: PostgreSQL or Supabase Postgres.

## Conventions
- Use UUID primary keys.
- Use `created_at` and `updated_at` timestamps where relevant.
- Use UTC timestamps in storage.
- Prefer explicit status enums or constrained text fields.
- Keep external system IDs in dedicated columns.

---

## 1. Tenants and Users

### tenants
Represents one client business.

Fields:
- id
- name
- slug
- business_type (`fashion`, `beauty`, `barber`, later extensible)
- timezone
- is_active
- created_at
- updated_at

### users
Internal admin users for a tenant.

Fields:
- id
- tenant_id
- email
- password_hash
- role (`owner`, `manager`, `admin`)
- is_active
- created_at
- updated_at

---

## 2. Brand and Settings

### tenant_settings
Stores tenant-level settings.

Fields:
- id
- tenant_id
- brand_tone_prompt
- supported_languages (jsonb)
- business_hours (jsonb)
- handoff_rules (jsonb)
- ai_settings (jsonb)
- created_at
- updated_at

### manager_examples
Style examples used for response tone replication.

Fields:
- id
- tenant_id
- scenario
- customer_message
- manager_reply
- tags (text[])
- is_active
- created_at

---

## 3. Connections and Integrations

### connections
Stores external integrations per tenant.

Fields:
- id
- tenant_id
- type (`instagram`, `keycrm`, `salesdrive`, `shopify`, `woocommerce`, `google_sheets`, etc.)
- status (`connected`, `disconnected`, `error`, `pending`)
- external_account_id
- access_token_encrypted
- refresh_token_encrypted
- metadata (jsonb)
- last_sync_at
- created_at
- updated_at

### sync_jobs
Tracks sync executions.

Fields:
- id
- tenant_id
- connection_id
- sync_type (`catalog`, `stock`, `customers`, `slots`)
- mode (`full`, `incremental`, `file_import`)
- status (`queued`, `running`, `success`, `failed`)
- started_at
- finished_at
- summary (jsonb)
- error_message
- created_at

---

## 4. Catalog (Fashion MVP)

### products
Parent product record.

Fields:
- id
- tenant_id
- external_product_id
- title
- description
- category
- brand
- status (`active`, `archived`, `draft`)
- metadata (jsonb)
- created_at
- updated_at

Indexes:
- tenant_id
- external_product_id
- full-text / trigram search index on title

### product_variants
Sellable unit for size/color combinations.

Fields:
- id
- product_id
- external_variant_id
- sku
- color
- size
- price
- currency
- active
- metadata (jsonb)
- created_at
- updated_at

Indexes:
- product_id
- sku (unique within tenant or globally depending on integration model)
- color
- size

### stock_balances
Current stock values.

Fields:
- id
- variant_id
- warehouse_code (nullable for MVP if single warehouse)
- available_qty
- reserved_qty
- pending_checkout_qty
- last_synced_at
- created_at
- updated_at

Derived formula:
- effective_available = available_qty - reserved_qty - pending_checkout_qty

Indexes:
- variant_id
- last_synced_at

### product_media
Product images or references.

Fields:
- id
- product_id
- url
- color
- sort_order
- created_at

---

## 5. Customers and Conversations

### customers
Represents end customers messaging the business.

Fields:
- id
- tenant_id
- channel (`instagram` for MVP)
- external_user_id
- username
- full_name
- phone (nullable)
- metadata (jsonb)
- last_seen_at
- created_at
- updated_at

Constraints:
- unique (tenant_id, channel, external_user_id)

### conversations
One conversation thread per customer/channel/account context.

Fields:
- id
- tenant_id
- customer_id
- channel
- channel_account_id
- status (`active`, `human_in_control`, `waiting_customer`, `closed`)
- needs_handoff
- handoff_reason
- last_message_at
- created_at
- updated_at

Indexes:
- tenant_id
- customer_id
- status
- last_message_at desc

### conversation_state
Current structured state for the conversation.

Fields:
- id
- conversation_id
- state_status (`browsing`, `product_selected`, `stock_confirmed`, `collecting_customer_info`, `awaiting_manager_confirmation`, `closed`)
- selected_product_id
- selected_variant_id
- active_checkout_session_id
- last_ai_confidence
- context_json (jsonb)
- updated_at

This table is critical.
It stores product and flow state outside of raw message history.

### messages
Raw and normalized messages.

Fields:
- id
- conversation_id
- tenant_id
- direction (`inbound`, `outbound`)
- role (`user`, `assistant`, `manager`, `system`)
- external_message_id
- text
- raw_payload (jsonb)
- tool_calls (jsonb)
- created_at

Indexes:
- conversation_id
- external_message_id
- created_at

---

## 6. Reservations and Checkout

### reservations
Soft reservations for selected variants.

Fields:
- id
- tenant_id
- conversation_id
- customer_id
- variant_id
- qty
- status (`active`, `expired`, `cancelled`, `converted`)
- expires_at
- created_at
- updated_at

Indexes:
- variant_id
- status
- expires_at

### checkout_sessions
Tracks the checkout flow.

Fields:
- id
- tenant_id
- conversation_id
- customer_id
- status (`collecting_customer_info`, `ready_for_draft_order`, `draft_created`, `cancelled`, `expired`)
- reservation_id
- expires_at
- created_at
- updated_at

### checkout_items
Items inside a checkout session.

Fields:
- id
- checkout_session_id
- product_id
- variant_id
- qty
- unit_price
- currency
- created_at

### checkout_customer_info
Captured delivery and contact data.

Fields:
- id
- checkout_session_id
- full_name
- phone
- city
- delivery_provider
- branch
- payment_method
- comment
- created_at
- updated_at

---

## 7. Orders

### orders
Draft or confirmed orders.

Fields:
- id
- tenant_id
- checkout_session_id
- customer_id
- external_order_id
- status (`draft`, `awaiting_manager_confirmation`, `confirmed`, `cancelled`)
- total_amount
- currency
- source (`instagram_ai`)
- created_at
- updated_at

### order_items
Fields:
- id
- order_id
- product_id
- variant_id
- qty
- unit_price
- currency
- created_at

---

## 8. Audit and Logs

### audit_logs
Tracks important business decisions.

Fields:
- id
- tenant_id
- conversation_id
- type (`availability_check`, `ai_decision`, `handoff`, `reservation_created`, `draft_order_created`, `sync_event`)
- status (`success`, `failed`, `warning`)
- details (jsonb)
- created_at

Indexes:
- tenant_id
- conversation_id
- type
- created_at desc

### integration_events
Stores webhook or sync event traces.

Fields:
- id
- tenant_id
- connection_id
- event_type
- external_event_id
- payload (jsonb)
- processed
- processed_at
- created_at

Useful for retries and idempotency.

---

## 9. Optional Beauty/Barber Extension

These tables should not be part of the first fashion build, but the schema should leave room for them.

### service_providers
- id
- tenant_id
- external_provider_id
- name
- active
- metadata
- created_at
- updated_at

### services
- id
- tenant_id
- external_service_id
- name
- duration_min
- price
- currency
- active
- created_at
- updated_at

### time_slots
- id
- tenant_id
- provider_id
- service_id
- starts_at
- ends_at
- status (`available`, `reserved`, `booked`, `blocked`)
- last_synced_at
- created_at
- updated_at

---

## Initial SQL Outline

```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  business_type text not null,
  timezone text not null default 'Europe/Kyiv',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  password_hash text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table tenant_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  brand_tone_prompt text,
  supported_languages jsonb not null default '[]'::jsonb,
  business_hours jsonb,
  handoff_rules jsonb,
  ai_settings jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
```

The remaining tables should follow the same style and can be generated into a first migration.

---

## Recommended First Migration Order
1. tenants
2. users
3. tenant_settings
4. connections
5. customers
6. conversations
7. messages
8. products
9. product_variants
10. stock_balances
11. reservations
12. checkout_sessions
13. checkout_items
14. checkout_customer_info
15. orders
16. order_items
17. audit_logs
18. integration_events

---

## Notes for Implementation
- Add trigram or full-text indexes for product search.
- Consider row-level security only if using Supabase auth directly; otherwise keep it in the app layer for MVP.
- Keep raw CRM payloads in dedicated JSON columns only where useful.
- Use explicit uniqueness rules to avoid duplicate customers, messages, reservations, and draft orders.
- Add cleanup jobs for expired reservations and stale checkout sessions.
