# Connector Architecture for Direct Mate

## Purpose

This document defines how external system connectors should work in Direct Mate.

The goal is to keep integrations flexible and fast to build, while ensuring that core product logic remains deterministic, testable, and owned by the backend.

## Core Principle

A connector should **not** contain the business brain of the product.

A connector is responsible for:
- polling external systems on a schedule
- importing data from external APIs when needed
- importing file-based data when needed
- normalizing payloads
- retrying failed integration calls
- forwarding normalized data to the backend API
- sending alerts when integration flows fail

The backend is responsible for:
- validation
- source-of-truth decisions
- business logic
- state transitions
- persistence
- auditability
- internal consistency

## High-Level Architecture

```text
External System -> n8n Scheduled Connector Workflow -> Backend API -> Postgres/Supabase
```

Examples of external systems:
- Shopify
- KeyCRM
- SalesDrive
- Google Sheets
- booking or salon CRM systems

## Responsibility Split

### n8n Connector Layer

Use n8n for:
- scheduled sync jobs
- pull-based imports from APIs
- file-based imports (CSV/XLSX/XML)
- data normalization
- retries and error recovery
- technical alerts to Slack/Telegram/email
- orchestration of integration workflows
- connection health checks

Do not use n8n as the owner of:
- stock truth
- booking truth
- conversation state
- reservation logic
- checkout logic
- handoff decisions
- tenant access rules
- pricing and subscription rules

### Backend Layer

Use the backend for:
- tenant-aware validation
- mapping external records into internal canonical models
- product and variant upserts
- stock calculations
- slot availability calculations
- reservation creation and expiration
- order draft creation
- escalation rules
- conversation processing
- audit logs
- safe API responses for AI and admin UI

## Canonical Flow Types

There are 2 main connector flow types for the MVP.

---

## 1. Initial or Scheduled Sync

Used when importing products, variants, stock, services, masters, or slots from an external system.

### Example
Shopify catalog sync

### Flow
1. n8n starts on cron or manual trigger
2. n8n calls external API
3. n8n paginates through records if needed
4. n8n normalizes records into Direct Mate internal payload shape
5. n8n sends normalized payload to backend endpoint
6. backend validates payload
7. backend upserts canonical records
8. backend stores sync status and audit logs
9. n8n sends completion/failure notification if needed

### Example endpoint
`POST /integrations/shopify/catalog-sync`

### Example payload
```json
{
  "storeId": "store_123",
  "connectionId": "conn_456",
  "products": [
    {
      "externalProductId": "gid://shopify/Product/123",
      "title": "Radiance Gel Cleanser",
      "description": "Gentle gel cleanser for sensitive skin",
      "status": "active",
      "variants": [
        {
          "externalVariantId": "gid://shopify/ProductVariant/111",
          "sku": "RGC-150",
          "title": "150ml",
          "price": 24,
          "currency": "USD",
          "inventoryQty": 18
        }
      ]
    }
  ]
}
```

---

## 2. Outbound Connector Actions

Used when Direct Mate needs to push something back to the external system.

### Examples
- create draft order in Shopify
- create booking in salon CRM
- update order status in CRM
- send Instagram reply through Meta

### Two approaches

#### Approach A: backend calls external API directly
Recommended for critical domain actions:
- create draft order
- create booking
- reserve slot
- confirm critical state transitions
- send customer-facing outbound actions that are part of the core product flow

#### Approach B: backend requests n8n to perform async connector action
Recommended for:
- non-critical async sync
- notifications
- post-processing
- secondary updates
- enrichment jobs

### Rule of thumb
If the action affects money, customer commitments, stock truth, or booking truth, prefer backend-owned execution.

## Why n8n Should Not Own Domain Logic

n8n is excellent for orchestration, but it becomes hard to maintain if it owns product rules.

Problems caused by domain logic living in n8n:
- duplicated rules across workflows
- hard-to-debug state transitions
- poor testability
- harder multi-tenant support
- harder versioning of business rules
- fragile branching logic over time

Direct Mate should treat n8n as an integration shell, not as the product brain.

## Recommended Connector Pattern

Each connector should be implemented as a small family of workflows, not one giant workflow.

### Shopify example
- `shopify.initial_catalog_sync`
- `shopify.inventory_poll_sync`
- `shopify.connection_health_check`

### KeyCRM example
- `keycrm.catalog_sync`
- `keycrm.stock_sync`
- `keycrm.connection_health_check`

### Meta / Instagram example
- `meta.send_reply`
- `meta.connection_health_check`

## Sync Strategy for the MVP

For the first version, all inbound business data sync should be scheduled.

Recommended default strategy:
- catalog sync: every 15-60 minutes depending on source size
- inventory or availability sync: every 5-15 minutes depending on business needs
- connection health check: every 15 minutes
- full resync: manual trigger from admin panel or nightly maintenance job

This keeps the MVP simpler and reduces operational complexity while connectors and canonical models are still evolving.

## Backend Endpoint Design Principles

Connector-facing backend endpoints should:
- be idempotent
- accept normalized payloads
- validate tenant and connection context
- upsert records safely
- return machine-friendly sync results
- avoid leaking domain internals to n8n

Example response shape:

```json
{
  "success": true,
  "processed": 128,
  "created": 15,
  "updated": 113,
  "skipped": 0,
  "errors": []
}
```

## Data Ownership Model

### External system
Owns:
- raw external records
- external identifiers
- source-side timestamps

### n8n
Owns:
- workflow execution state
- retry attempts
- connector-level operational alerts

### Backend
Owns:
- canonical internal entities
- mapping logic
- source-of-truth interpretation
- business state transitions
- audit logs

### Database
Owns:
- persistent source-of-truth records
- sync history
- connection metadata
- canonical product, availability, and order state

## Implementation Notes for Claude

When building connector support for Direct Mate:
- keep n8n workflows small and single-purpose
- keep all important business rules in backend services
- design sync endpoints to be idempotent
- store external IDs for all imported records
- add sync logs and last-sync timestamps
- assume scheduled sync only for the MVP
- do not introduce webhook-driven ingestion yet
- prefer incremental imports where the source supports them
- support manual resync from admin later

## Summary

For the MVP, a connector in Direct Mate should work like this:

```text
Scheduled n8n workflow -> pull external data -> normalize payload -> call backend API -> backend validates and upserts canonical records -> store sync status -> alert on failure
```

This keeps the first version simple, deterministic, and easy to maintain while leaving room to add webhook-based connectors later if needed.
