---
name: DirectMate project overview
description: AI Instagram sales assistant for fashion stores — NestJS + React + Postgres monorepo
type: project
---

DirectMate is an AI Instagram sales assistant for fashion stores.

**Why:** Help fashion businesses auto-handle Instagram DMs using real stock data, reduce manual messaging load, and only escalate to humans when needed.

**How to apply:** When building features, always prioritize: (1) deterministic stock checks before AI replies, (2) conversation state tracking, (3) clean handoff to humans.

Core stack: NestJS API (apps/api), React+Vite admin (apps/admin), Postgres/TypeORM, n8n for integrations, OpenAI-compatible LLM.

Monorepo structure:
- apps/api — NestJS backend, owns ALL business logic
- apps/admin — React+Vite admin panel (TanStack Query, Tailwind)
- packages/shared — shared TypeScript enums
- infra/docker — docker-compose for local dev

Main modules in apps/api/src/modules/:
- auth (JWT login)
- tenants (Tenant, User, TenantSettings entities)
- conversations (Conversation, Customer, Message, ConversationState, ReplyEngineService)
- catalog (Product, ProductVariant, StockBalance, ProductMedia)
- availability (deterministic stock check — never AI-guessed)
- reservations (15-20min soft reservations during checkout)
- orders (CheckoutSession → draft Order flow)
- channels/instagram (Meta webhook handler)
- integrations (Connection, SyncJob — for n8n sync triggers)
- settings (TenantSettings, ManagerExample)
- audit (AuditLog, IntegrationEvent)
- internal (endpoints for n8n: POST /internal/sync/catalog and /stock)

Database: initial migration at apps/api/src/database/migrations/1710000000000-InitialSchema.ts
Config: apps/api/src/config/configuration.ts + validation.schema.ts
Data source: apps/api/src/database/data-source.ts

Key design principle: AI generates replies, backend owns all facts (stock, state, order validation). ReplyEngineService is the stub that needs LLM integration.
