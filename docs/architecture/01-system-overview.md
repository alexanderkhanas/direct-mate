# 01 — System Overview

← [Index](00-README.md) · Next: [02 Module Map](02-module-map.md)

---

## 1. The product in architectural terms

DirectMate automates the routine half of Instagram DM sales conversations and escalates the rest to a
human. Every architectural decision follows from two product rules:

1. **Automate routine interactions; escalate uncertain or risky ones.**
2. **The code defines the engine. The admin panel defines the store's behaviour.**

Rule 2 is why there is no per-tenant code anywhere. A store's voice, flow, checkout fields, escalation
policy and reply copy all live in database rows (`store_configs`, `response_templates`, `faq_items`,
`tenant_settings`). Adding a customer means seeding rows, not shipping a branch.

Rule 1 is why the LLM's authority is deliberately tiny. It classifies; it does not speak. When the
deterministic engine cannot resolve a turn, the system hands off to a human rather than improvising.

---

## 2. System context

```mermaid
flowchart TB
    subgraph People
        Customer["🛍️ Customer<br/><i>Instagram DM</i>"]
        Manager["👤 Store manager<br/><i>admin panel + Telegram</i>"]
        Operator["🛠️ Platform operator<br/><i>superadmin</i>"]
        Prospect["👀 Prospect<br/><i>marketing site</i>"]
    end

    subgraph DirectMate["DirectMate platform"]
        API["NestJS API"]
        Admin["React admin SPA<br/>+ landing + demo widget"]
        DB[("PostgreSQL 16")]
        N8N["n8n<br/><i>workflow orchestration</i>"]
    end

    subgraph External["Third parties"]
        Meta["Meta / Instagram<br/>Graph API v21.0"]
        OpenAI["OpenAI"]
        Anthropic["Anthropic<br/><i>A-B seam only</i>"]
        Replicate["Replicate<br/><i>CLIP embeddings</i>"]
        TG["Telegram Bot API"]
        Mono["Monobank Acquiring"]
        Shopify["Shopify Admin API"]
        Torgsoft["Torgsoft POS<br/><i>via FTP</i>"]
    end

    Customer <-->|"DM / story reply / photo"| Meta
    Meta -->|"webhook"| API
    API -->|"send message"| Meta

    Manager --> Admin
    Operator --> Admin
    Prospect --> Admin
    Admin -->|"/api/*"| API

    API --> DB
    API --> OpenAI
    API -.->|"if CLASSIFIER_MODEL=claude-*"| Anthropic
    API --> Replicate
    API -->|"handoff alert"| TG
    API -->|"billing"| Mono
    API -->|"order sync webhook"| N8N
    N8N -->|"x-internal-key"| API
    N8N <--> Shopify
    Torgsoft -->|"FTP: catalogue CSV + images"| N8N
    N8N --> DB
```

---

## 3. Container view (production)

Everything runs on **one VPS** under Docker Compose. Only nginx and the FTP server publish host ports.

```mermaid
flowchart TB
    Net(("Internet"))

    subgraph VPS["Single VPS — docker compose, network: internal"]
        NGINX["nginx :80 :443<br/><i>TLS, routing, rate limits</i>"]
        API["api<br/>node:20-slim<br/><i>no published port</i>"]
        ADMINC["admin<br/>nginx:alpine + static SPA"]
        PG[("postgres:16<br/>3 DBs: directmate, n8n, umami")]
        N8N["n8n"]
        UMAMI["umami<br/><i>product analytics</i>"]
        CERT["certbot<br/><i>renew loop, 12h</i>"]
        FTP["vsftpd :21 :21100-21110<br/><i>Torgsoft uploads</i>"]
        FS[("/srv/directmate-ftp<br/><i>host bind mount</i>")]
    end

    Net --> NGINX
    Net -->|"FTP"| FTP
    NGINX -->|"/"| ADMINC
    NGINX -->|"/api/ → :3000"| API
    NGINX -->|"/channels/ webhooks"| API
    NGINX -->|"/internal/ (IP allowlist)"| API
    NGINX -->|"/n8n/"| N8N
    NGINX -->|"cdn.* (read-only)"| FS
    NGINX -->|"analytics.*"| UMAMI
    FTP --> FS
    N8N --> FS
    API --> PG
    N8N --> PG
    UMAMI --> PG
    CERT -.->|"shared volume"| NGINX
```

**Three domains, one nginx:**

| Host | Serves |
|---|---|
| `${DOMAIN}` (directmate.app) | admin SPA, `/api/*`, Instagram webhooks, OAuth, Swagger, `/n8n/` |
| `cdn.directmate.app` | Torgsoft product images from `/srv/directmate-ftp` — regex-whitelisted to `/{tenant}/images/*.{jpg,png,webp,gif}` |
| `analytics.directmate.app` | self-hosted Umami |

📌 **Deliberate:** the CDN's regex whitelist is a security boundary. The same directory holds each
tenant's `sync/TSGoods.trs` catalogue export, which is unreachable purely because the regex only admits
`images/`. "Just serve the tree" would leak customer catalogues.

Full detail: [10 — Deployment](10-deployment.md).

---

## 4. The six entry points

`ReplyEngineService.process()` is the single funnel for conversational logic. Six different callers
drive it, and each is tagged with a `TraceSource` so a trace can never be mistaken for production
traffic.

```mermaid
flowchart LR
    subgraph Callers
        IG["InstagramService<br/><code>instagram</code> / <code>instagram_dry_run</code>"]
        DEMO["DemoMessageBufferService<br/><code>demo_widget</code>"]
        SIM["SimulatorService<br/><code>simulator_scenario</code> / <code>live_console</code>"]
        CLI["simulate-conversation.ts<br/><code>simulator_cli</code>"]
        YAML["ConversationTestRunner<br/><code>conversation_test</code>"]
        INT["ConversationReplyController<br/><code>manual_api</code>"]
    end

    IG --> ENGINE
    DEMO --> ENGINE
    SIM --> ENGINE
    CLI --> ENGINE
    YAML --> ENGINE
    INT --> ENGINE

    ENGINE["<b>ReplyEngineService.process()</b><br/>pure: no sends, no orders, no Telegram"]

    ENGINE --> OUT["ReplyEngineOutput<br/>decision · reply · extraReplies<br/>handoff · stateUpdate · orderPayload"]

    OUT -->|"caller decides side effects"| SIDE
    subgraph SIDE["Side effects — owned by the caller, never the engine"]
        S1["Meta send"]
        S2["Telegram notify"]
        S3["Order creation"]
        S4["escalate()"]
    end
```

📌 **Deliberate — the engine is pure.** It never sends a message, never creates an order, never pings
Telegram. Callers suppress side effects at their own boundary. The demo path simply *does not call*
`ordersService.createFromConversation()`; there is no `isDemo` flag threaded through the engine. Any new
caller must follow this pattern.

⚠️ **Hazard:** `buildOrderPayload` sets `customerId = input.state.conversationId` — a placeholder.
`InstagramService` overwrites it with the real `customer.id` before calling `OrdersService`. A new
caller that forgets writes a garbage `orders.customer_id`, and there is no FK to catch it.

---

## 5. The primary request path: an inbound Instagram DM

```mermaid
sequenceDiagram
    autonumber
    participant C as Customer
    participant M as Meta
    participant N as nginx
    participant IC as InstagramController
    participant IS as InstagramService
    participant PM as pending_messages (DB)
    participant RE as ReplyEngineService
    participant CL as ClassifierService
    participant AV as AvailabilityService
    participant TE as TemplateEngineService
    participant TG as TelegramService

    C->>M: DM "Є ця сорочка в L?"
    M->>N: POST /channels/instagram/webhook
    N->>IC: proxy (limit_req webhooks)
    IC->>IS: verifySignature (only if header present)
    IC-->>M: 200 {received:true} (immediate ack)
    Note over IC,IS: handleWebhook is fire-and-forget

    IS->>IS: echo filter (3 layers), media-ref extraction
    IS->>PM: persist inbound message + upsert debounce row (flush_at = now+5s)

    loop every 2s
        IS->>PM: SELECT DISTINCT debounce_key WHERE flush_at <= now()
    end

    IS->>IS: pg_advisory_lock(conversationId)
    alt conversation is human_in_control OR operating_mode = learning
        IS-->>IS: return without replying
    else
        IS->>RE: process({source:'instagram', messageText: joined, recentMessages: last 10})
        RE->>CL: classify (1 forced tool call)
        CL-->>RE: intent · entities · slotAction · confidence
        RE->>RE: policy gate → ~10 numbered routing stages
        RE->>AV: product search / hydration
        RE->>TE: render(scenario) → template text + images
        TE-->>RE: {text, templateId, imageUrls}
        RE-->>IS: {decision, reply, extraReplies, handoff, stateUpdate}
    end

    alt handoff.required
        IS->>TG: notifyHandoff (withRetry, un-awaited)
        IS->>M: send announce copy to customer
    else
        IS->>M: send images (best-effort) then text (retried 3×)
        IS->>M: send each extraReplies bubble
    end

    RE-->>RE: persist conversation_traces row (finally, void-ed)
```

**Timing:** the webhook is acked in milliseconds; the reply lands ~5 s later (debounce) plus classifier
latency. The debounce window **slides** — every message in a burst pushes the deadline out another 5 s,
so the batch flushes 5 s after the customer *stops* typing.

---

## 6. Where the AI is (and is not)

```mermaid
flowchart TB
    IN["Inbound message"] --> CLS

    CLS["<b>ClassifierService</b><br/>OpenAI gpt-5.4-mini · forced tool call<br/>temperature 0 · no streaming<br/><i>1 call per turn — the only AI on the happy path</i>"]

    CLS --> POL["<b>PolicyEngineService</b><br/>pure, no I/O<br/>escalate · fallback · continue"]
    POL --> ENG["<b>ReplyEngineService</b><br/>~7,400 lines · 77 helpers<br/>10 numbered stages<br/><i>fully deterministic</i>"]
    ENG --> TPL["<b>TemplateEngineService</b><br/>DB templates + variable interpolation<br/><i>no LLM at all</i>"]
    TPL -->|"template found"| OUT["Reply"]
    TPL -->|"no template"| FB{"fallback allowed?"}
    FB -->|"yes"| AIF["<b>AI fallback</b><br/>gpt-5.4 · temp 0.3<br/><i>exceptional path</i>"]
    FB -->|"strict_templates_only"| HO["<b>Handoff</b>"]
    AIF --> OUT
    HO --> OUT

    subgraph Aside["Off the reply path"]
        VIS["Vision — gpt-4o<br/>customer photo matching"]
        CLIP["CLIP via Replicate<br/>ViT-L/14, 768-dim"]
        PH["dHash 64-bit<br/>exact-image match"]
        SCR["Screenshot training<br/>gpt-4o vision extraction"]
    end
```

Per turn on the happy path there is **exactly one LLM call**. Everything else is deterministic.
Details in [03 — AI & Engine](03-ai-engine.md).

---

## 7. Data flow: how a catalogue gets in

There are three ingestion paths, and they do not share code.

```mermaid
flowchart LR
    subgraph Sources
        SH["Shopify"]
        TS["Torgsoft POS<br/><i>customer's own PC</i>"]
        SEED["Seed scripts<br/><i>demo + showcase tenants</i>"]
    end

    SH -->|"GraphQL Admin API"| N8N
    TS -->|"plain FTP<br/>TSGoods.trs + images"| FTPD["vsftpd<br/>/srv/directmate-ftp/&lt;slug&gt;/"]
    FTPD -->|"FTP node reads CSV"| N8N["n8n workflow<br/><i>parse + normalize + AI keyword enrich</i>"]
    FTPD -->|"nginx read-only"| CDN["cdn.directmate.app"]

    N8N -->|"POST /internal/sync/catalog-import<br/>x-internal-key"| API["CatalogService.importCatalog"]
    SEED -->|"raw SQL"| DB
    API -->|"1 txn, SAVEPOINT per product"| DB[("products · product_variants<br/>stock_balances · product_media<br/>categories")]

    DB --> EMB["ProductMediaEmbedderService<br/><i>setInterval 60s</i>"]
    EMB -->|"CLIP"| REP["Replicate"]
    REP --> DB
```

⚠️ **Hazard:** n8n workflow definitions are **not in this repo**. They live only in the `n8n_data`
Docker volume. Losing that volume loses the Torgsoft and Shopify pipelines.

---

## 8. Technology inventory

| Concern | Choice | Notes |
|---|---|---|
| API framework | NestJS 11 (Express platform) | `rawBody: true` for webhook signature verification |
| ORM | TypeORM 0.3 + `SnakeNamingStrategy` | `synchronize: false`; 38 hand-written migrations |
| Database | PostgreSQL 16 | `pg_trgm` for fuzzy search. **No pgvector** — deliberately |
| Vector search | raw `BYTEA` + in-JS cosine | 768-dim CLIP; fine to ~5–10k images/tenant |
| Image hashing | 64-bit **dHash** via `sharp` | column is named `phash`; the algorithm is dHash |
| LLM | OpenAI SDK 6.x, Anthropic SDK 0.111 | routed per-call by model id |
| Auth | passport-jwt, bcrypt | plus an internal API key and 3 webhook signature schemes |
| Scheduling | `@nestjs/schedule` + raw `setInterval` | 3 crons + 2 interval workers, all in-process |
| Frontend | React 18, Vite 5, TanStack Query 5, Tailwind 3 | no state library; polling, no websockets |
| Prerender | react-snap | 4 public routes for SEO |
| Analytics | self-hosted Umami | replaced PostHog |
| Payments | Monobank Acquiring | signed webhooks (SHA256 + fetched public key) |
| Orchestration | n8n (self-hosted) | shares the Postgres instance |
| Infra | Docker Compose, nginx, certbot, vsftpd | single VPS, no orchestrator |
| CI/CD | GitHub Actions → rsync → build on server | no tests in CI |

---

## 9. Bounded contexts

```mermaid
flowchart TB
    subgraph Identity["Identity &amp; tenancy"]
        T1["tenants · users · tenant_settings"]
    end
    subgraph Conv["Conversation"]
        C1["customers · conversations · messages<br/>conversation_state · conversation_traces"]
    end
    subgraph Cat["Catalogue"]
        K1["products · product_variants · stock_balances<br/>product_media · categories"]
    end
    subgraph Eng["Engine configuration"]
        E1["store_configs · response_templates<br/>phrase_blocks · faq_items · size_charts"]
    end
    subgraph Ord["Commerce"]
        O1["orders · order_items<br/>checkout_* · reservations"]
    end
    subgraph Int["Integration"]
        I1["connections · sync_jobs<br/>instagram_media_mappings · pending_messages"]
    end
    subgraph Train["Training"]
        R1["screenshot_import_* · extracted_*<br/>manager_examples"]
    end
    subgraph Bill["Billing"]
        B1["subscription_plans · subscription_usage<br/>subscription_plan_configs"]
    end

    Identity --> Conv
    Identity --> Cat
    Identity --> Eng
    Conv --> Ord
    Cat --> Conv
    Eng --> Conv
    Int --> Cat
    Int --> Conv
    Train --> Eng
    Identity --> Bill
```

`tenants` is the root of the cascade tree — 33 of 44 tables carry `tenant_id`, and almost all FKs to it
are `ON DELETE CASCADE`. Deleting a tenant is a very large, very fast delete.

Full schema: [05 — Data Model](05-data-model.md).

---

## 10. What is deliberately *not* here

Knowing the negative space saves you from looking for things that do not exist:

- **No message queue.** Debouncing uses a Postgres table plus a 2-second poller. Background work is
  `@Cron` and `setInterval` in the API process.
- **No websockets.** The admin panel polls (5s–60s intervals depending on the page).
- **No row-level security and no automatic tenant filter.** Every query passes `tenant_id` by hand.
- **No horizontal scaling.** Several correctness-critical caches are per-process `Map`s.
- **No pgvector.** Embeddings are `BYTEA`, ranked in Node.
- **No tests in CI.** The `build` job is a compile-check gate; the simulator is run manually.
- **No backups in the repo.** No `pg_dump` cron, no snapshot script.
- **No error tracking / APM / alerting.** Observability is `conversation_traces`, `audit_logs`,
  `conversations.log`, and `docker logs`.

Each of these is revisited with severity and options in [12 — Risks & Tech Debt](12-risks-and-tech-debt.md).
