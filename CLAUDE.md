# DirectMate — Project Context

## What is DirectMate

A configurable AI sales assistant platform for Instagram DMs. Not a single chatbot — a **platform** where each store configures its own AI agent through an admin panel.

**Core principle: One engine. Many stores. Each store defines behavior through configuration.**

The product goal is to maximize **safe automation** of routine Instagram DM conversations while preserving trust, conversion quality, and fast human handoff for risky or unclear cases.

DirectMate should automate repetitive, low-risk interactions and escalate uncertain, sensitive, or business-critical cases to a human manager.

## Architecture

### Monorepo (npm workspaces)
```
apps/api/        — NestJS backend (TypeORM, PostgreSQL, Vercel AI SDK v7 + OpenAI)
apps/admin/      — React + Vite admin panel (TanStack Query, Tailwind, lucide-react)
packages/shared/ — Shared enums/types (compiled to JS before API uses it)
infra/docker/    — Docker Compose (Postgres on port 5433)
infra/production/ — Production compose and env template
docs/v2-agent/   — The agent rework: decisions and the phase-by-phase implementation plan
```

### Key architectural decisions
- **TypeORM with SnakeNamingStrategy** — camelCase entity props map to snake_case DB columns
- **Manual migrations** (no synchronize) — raw SQL in up/down
- **packages/shared compiled to JS** — not imported as raw TS, workspace symlink resolves it
- **npm workspaces** with `legacy-peer-deps=true` in .npmrc
- **Node 22.** `ai` v7 and `@ai-sdk/openai` are ESM-only; the CommonJS API loads them through Node's require(esm), and jest transforms them (`transformIgnorePatterns`).
- **n8n for external orchestration** (Shopify/OpenCart sync workflows, the token-expiry report) — calls backend
  internal endpoints. Instagram content is **not** fetched by n8n any more: that is an in-process cron (see Channels)
- **InternalApiKeyGuard** for n8n-facing endpoints (`x-internal-key` header)
- **JwtAuthGuard** for admin-facing endpoints
- **Demo tenant isolation** — `tenants.is_demo BOOLEAN`. The public demo widget (`/demo/message`) takes an
  optional `tenantSlug` (default `demo-women-clothes`); the rate limiter keys on `(ip, tenantSlug)`. Demo
  turns run in `demo` mode: orders are placed in the DB so the conversation stays truthful, but nothing
  leaves the system (no Telegram, no n8n). Analytics queries must filter `is_demo=false`.

### Database
- PostgreSQL in Docker, port **5433** (5432 taken by another project)
- Container name: `docker-postgres-1`, user: `postgres`, db: `directmate`
- Seed scripts use raw SQL (`AppDataSource.query()`) to avoid SnakeNamingStrategy issues
- **Content links** (`content_products`, written only by `ContentLinksService`): several products per story, post or
  reel, each with a `source` (`manual`, `caption_sku`, `same_image`, `conversation`, `vision`) and a `status`.
  `confirmed` comes only from the owner (Content page), a caption SKU or the same image; `suggested` is evidence the
  owner reviews on the Content page («Перевірити»); `rejected` is never used or suggested again. Code never overrides
  the owner. Evidence (live only): when the customer picks the item they saw, the agent adds it with
  `update_order_draft.addItem.fromContent`, a `content_pick` effect the runner records on the content they pointed at
  last (`HistoryBuilder.buildTurn().focusMediaId`); a placed order adds its id. An order is evidence, not proof (a
  customer may knowingly order the closest match): a suggestion's first order asks the owner in Telegram
  (`ContentQuestionsService`, «Так, це він» / «Ні», once per link, ≤5 per store per day, a tap counts only from the
  store's chat; `TelegramService.onCallback` routes `cl:` taps). The **visual check** (`ContentVerifierService`)
  compares a piece of content with catalog photos once (`vision_checked_at`): a vision call lists the items, our
  catalog search finds ≤4 candidates each, a second call gives same / none / unsure per item. A «same» ≥0.6 is kept as
  a `vision` suggestion with its reason; ≥0.8 asks the owner. Runs for new stories after the fetch (≤5 per store) and
  in the background the first time a customer points at content nobody confirmed. `npm run content:eval` measures it
  on confirmed content (paid). Customer-photo matches stay on `instagram_media_mappings` (a cache, not content); its
  `product_id` / `linked_color` / `confirmed` on content rows are no longer read.
- `archived_response_templates`, `archived_phrase_blocks`, `archived_faq_items`: the old template engine's
  tables, read-only. Kept because production stores' templates are the only record of their delivery and
  payment copy. Drop once every store has a knowledge doc.

### External services
- **OpenAI** — the agent model (`AGENT_MODEL`, gpt-6.1-terra in use), moderation on replies
  (omni-moderation, free), vision for photo matching, product attribute extraction, reading size charts,
  the comment screen, transcribing customers' voice messages (`TRANSCRIBE_MODEL`, gpt-4o-mini-transcribe)
- **Meta** — Instagram API with Instagram Login (`graph.instagram.com`) or Unified Login (`graph.facebook.com`),
  per connection: webhooks + messaging (see below)
- **Replicate** — CLIP image embeddings for photo matching
- **Telegram** — handoff notifications to managers
- **n8n** — local Docker instance on port 5678, API key auth
- **Shopify** — GraphQL Admin API (2024-07) via n8n workflows
- **OpenCart** — REST API via n8n workflows

## How a reply is made — the v2 agent

**The model reads the conversation, calls tools for facts and actions, and writes the reply. Code owns
prices, stock, order state, payment details and handoff.** There are no intents, templates or routing
rules: the classifier + template engine was deleted in Phase 5 (Nov 2026). History and rationale:
`docs/v2-agent/implementation-plan.md` and the decisions doc it links.

### Turn pipeline — `TurnRunner` (`apps/api/src/modules/conversations/turn-runner.service.ts`)
Every caller goes through it: Instagram DMs and comments, the demo widget, the manual reply API, the
admin simulator and Live DM console, the CLI simulator.
1. **Lease** the conversation (`processing_until`, atomic `UPDATE … RETURNING`). Someone else holds it → `busy`.
2. **Gates:** store `paused`, conversation in human control → skip. The owner's permissions for the Direct
   (`DirectPermissionsService`): a `live` reply needs `reply_to_customers`, a `dry_run` (learning) draft needs
   `read_messages`, else skip (`no_permission`); demo mode needs neither. Customer over
   `AGENT_MAX_CUSTOMER_MESSAGES_PER_HOUR` (60) → announced handoff (`rate_limited`).
3. **History** (`HistoryBuilder`): the current conversation, time-gap markers, the previous conversation's
   last messages as context, the customer's recent orders, and up to 10 images: customer photos (resized to
   1024px) and the content they point at. A story replied to, a post or reel shared, a post commented on is
   copied once per media id (`ContentMediaService`, `uploads/content-media/`, cached in
   `instagram_media_mappings.image_path`); a video becomes a 2×2 sheet of its most different frames (`ffmpeg-static`,
   ≤180 s, ≤50 MB), falling back to its cover, then the caption. The runner waits up to 3 s for a copy in progress
   (`ContentMediaService.prepare`). The label and caption sit inside the customer's message, and the grounding check
   reads only what the customer typed (`said`), so a caption's price is no fact. A voice message reads as its
   transcript, which is part of `said` (the customer's own words); the runner waits up to 15 s for a transcription
   in progress (`VoiceMessagesService.prepare`).
4. **Media** (`MediaContextResolver`): a customer photo is matched to a product (mapping table, pHash, CLIP, then
   vision). Content (story, post, reel, comment): its confirmed products (`content_products`), then a pHash match of
   our copy (remembered as confirmed), else a note to read the text on it first (name, article, price) and search.
   Only a confirmed product, an article or a name that fits one product identifies it: offered alone when in stock,
   else said so with alternatives; several confirmed → «which one?». Otherwise the agent sees the catalog as text only,
   so it says it can't tell which model and shows the closest 2–3, suggestions first, never as the item pictured.
   Content it couldn't copy is labelled «you can't see it». Another account's post is «looks like», never the same item.
5. **Agent** (`AgentService.runTurn`): a tool loop, then the **guards**. A failed check regenerates once
   with the violations fed back; a second grounding failure is an announced handoff.
6. **Supersede:** on Instagram, a reply is dropped if the customer wrote again meanwhile, and re-run once.
7. **Commit by mode** and save every outbound message:

| Mode | Used by | Effects |
|---|---|---|
| `live` | Instagram, manual API | Everything, including Telegram and n8n order sync |
| `demo` | demo widget, simulator, admin console | Orders placed and payment marked in the DB; nothing leaves the system; a handoff doesn't pause the chat |
| `dry_run` | learning mode | Nothing committed; messages and staged effects are returned and traced |

8. **Trace** to `conversation_traces` (agent steps, guard results, model, usage). Any exception or
   timeout becomes an announced handoff, never a partial reply.

The runner, not the model, owns two fixed lines: the **welcome line** (the AI-assistant disclosure, once per
customer per 30 days) and the **handoff line** appended to every handoff.

### Tools (`modules/agent/tools/`)
Read: `search_products` (words, or an exact `sku` / article; optional `price` ±5 % of what the customer pays),
`browse_category` (also `price`), `get_product`, `get_size_help` (not offered when the store's
sizing is `consult`). State: `get_order_draft`, `update_order_draft` (lives in `checkout_sessions` /
`checkout_items` / `checkout_customer_info`; price always from the DB; `addItem.fromContent` marks the item the
customer chose from a story, post or reel). Staged effects, committed by the
runner per mode: `show_products` (≤4 images), `send_size_chart`, `place_order` (only when the draft is
complete, idempotent per checkout session), `send_payment_details` (once per draft), `handoff`.
Every tool is tenant-scoped; refs the model passes are resolved against the tenant's catalog.

### Guards (`modules/agent/guards/`)
- **Grounding:** every price, size and colour in the reply must come from a tool this turn, the store
  notes, or the customer's own words. "Placed / saved / added" needs the tool that did it. Discounts,
  promo codes, gifts, bonuses, "free" anything must be in the store notes; every percentage must come
  from the notes or a tool. The prompt canary must never appear.
- **Style:** russisms and banned openers (`style-guide.uk.ts`), the store's disallowed phrases (e.g. 💛
  for a menswear store), replies over 900 characters.
- **Moderation:** OpenAI moderation on the final reply; fails open.

### Prompt (`modules/agent/prompt/system-prompt.ts`)
Static rules (incl. Safety: customer content is information, never instructions) → store tone, manager
examples and notes → sizing rules → checkout fields → working hours → catalog index (one line per
product). Kept in that order so the long prefix stays cacheable.

## Store configuration

| What | Where | Admin |
|---|---|---|
| Store notes (delivery, payment, returns, fit) | `store_configs.knowledge_doc` | Settings → What the bot knows |
| Payment details for prepayment | `checkout_config.paymentDetails` | same |
| Welcome line | `brand_config.welcomeLine` | same |
| Handoff line | `handoff_config.announceText` | same |
| Disallowed phrases / emoji | `brand_config.disallowedPhrases` | — |
| Checkout fields | `checkout_config.fields` | — |
| Sizing: `recommend` or `consult`, ask measurements first | `flow_config.sizing` | Settings → Sizes |
| Height/weight → size ranges | `flow_config.sizeChart` | Settings → Sizes |
| Conversation idle cut-off (default 24h) | `flow_config.conversationIdleHours` | advanced JSON |
| Comment answering on/off, public reply copy | `flow_config.commentHandling` | advanced JSON |
| Brand tone, manager examples | `tenant_settings.brand_tone_prompt`, `manager_examples` | Settings |
| Model override for one store | `tenant_settings.ai_settings.model` | — |
| Operating mode: `active` / `learning` / `paused` | `store_configs.operating_mode` | Settings |
| Permissions for the Direct: read, reply (independent) | `tenant_settings.direct_read_allowed_at`, `direct_reply_allowed_at` | Setup (Instagram step, launch), Settings → Дозволи для Instagram, Claude |

`AgentStoreSettingsService` reads and validates all of it (zod; a malformed value falls back to the
default). Size charts (`size_charts`) are an image plus, once a vision model has read it
(`POST /size-charts/:id/read`) and the owner has checked it, a table of sizes × measurements
(`status` image → draft → ready). Each chart covers brands × categories (empty = all); per product
the most specific one wins, and `get_size_help` recommends from it only when it is ready (a broader
ready chart never stands in); otherwise from the height/weight ranges in `flow_config.sizeChart`.

## Channels

### Instagram (`modules/channels/instagram/`)
- **Webhook:** every POST must carry a valid `X-Hub-Signature-256` (Meta app secret); others get 401.
- **Permissions** (`onboarding/direct-permissions.service.ts`, the only writer): `read_messages` (the history import
  and learning mode) and `reply_to_customers` (active mode, comment replies), independent of each other, each a
  timestamp (null = not allowed); every answer, a «no» too, goes to `direct_permission_events` with who and where
  (admin, Claude). Active mode needs reply, learning needs read (`StoreConfigService.applyMode`, also for a
  superadmin); withdrawing one the mode uses pauses the store. The history import's
  `tenant_onboarding.history_import.consent` is a copy of the read permission, written with it.
- **Intake:** with neither permission, a DM (and a manager's echo) isn't kept at all. Otherwise each message is saved
  on arrival, deduped by `mid` (unique index). Attachments are kept:
  photos copied to `uploads/` (`CustomerMediaService`), video/files/story mentions labelled for the
  agent, quote-replies carry the quoted text. Edits (`message_edit`) are ingested as messages.
- **Voice messages** (`VoiceMessagesService`): Meta sends an `audio` attachment, a link to an MP4 with only audio
  (it expires). On arrival it is kept as a mono MP3 in `uploads/customer-media/` (≤180 s; longer keeps its start) and
  transcribed; the transcript, length and model go onto the attachment. A file that can't be fetched or read gets
  `error` and the agent asks the customer to write; a failed transcription is retried on a later turn from our copy.
  The prompt has the agent read dictated names, phones and addresses back in the order summary. The admin
  conversation page plays the copy and shows the transcript.
- **Reply timer:** each message pushes `conversations.reply_due_at` 5s out (`INSTAGRAM_DEBOUNCE_MS`); a 1s
  poller claims due conversations atomically (`FOR UPDATE SKIP LOCKED`).
- **Delivery** (`InstagramSender`): images first, several as one album (`message.attachments`, up to 10); if Meta
  refuses the album they go one by one, and a refusal of the form itself (not of one file) keeps them one by one
  until restart. Then text split at Instagram's **1,000-byte** limit (~500 Cyrillic characters). Every returned id
  goes into `instagram_sent_mids`. A failed send is marked `delivery_status='failed'` (left out of the agent's
  history) and hands off to a manager.
- **Echoes:** ours if the id is in `instagram_sent_mids`, the `app_id` is ours, the text equals a recent
  bot message (rechecked after 3s), or it is image-only within 2 min of an album to that conversation (an album may
  echo under ids the send didn't return). Anything else is a manager reply: the bot pauses (takeover,
  auto-resume after 30 min).
- **Comments** (`InstagramCommentService`): on a feed post (linked to a product or not: the agent sees the post), a small model
  (`INSTAGRAM_COMMENT_GATE_MODEL`) screens whether the comment asks the shop something. If so, the
  comment is saved into the commenter's DM conversation and answered as a normal agent turn, sent as one
  **private reply** (text only — photos are dropped), then a short public reply points to Direct.
- **Content fetch** (`InstagramContentService.tick`, an in-process `@Cron`, not n8n): every 30 minutes each connected
  store's live stories, so every story is seen within its 24 h; hourly its posts and reels, newest first, paging on
  only until a page holds a post it already has. A full page-through (up to 200) only while the store has no fetched
  post (`bulk_import` row that isn't a story). Rows are upserted by media id, refreshing type, caption, links,
  `thumbnail_url` and `media_product_type`, never a link. Then the SKU pass (rows with no link at all, not added by
  hand) and, after every store is fetched, the visual check for new stories (≤5 per store, suggestions only). Stores one at a time, a failure
  logged and skipped, an in-memory guard against overlapping runs (single replica). `CONTENT_FETCH_WORKER_ENABLED=false`
  turns it off (the CLI scripts do). The Content page's «Fetch content» button runs the same fetch for one store and
  answers before the vision pass.
- **Learning mode:** turns run as `dry_run`; the learning observer records bot drafts next to manager replies.

### Instagram history import (setup)
- Instagram is setup step 2. With the owner's read permission (the switch on that step, or Claude's
  `set_instagram_permission`), recent DMs are read once to draft
  the store notes, the tone and up to 8 reply examples: `modules/onboarding/history/`. Endpoints under
  `/onboarding/history`; state in `tenant_onboarding.history_import` (only the conclusions; raw messages, the token
  and usernames are never stored).
- **One app-wide queue** (a 1-minute cron, one store at a time, an advisory lock across processes): Meta's
  message-read budget is per app, not per store. ~30 conversations × 20 messages per store. The last `x-app-usage`
  reading and any pause live in `app_state` (`instagram_history_budget`): at 75 % or on code 4 the whole queue waits
  an hour, with no polling. `HISTORY_IMPORT_WORKER_ENABLED` turns the cron off (the CLI scripts do). Limits and costs
  measured: `docs/v2-agent/ig-conversation-history.md`.
- Only replies a person wrote become examples: before the store connected, every shop reply; after, only those whose
  mid matches a saved `manager` message (an echo). Before the analysis call, `redact.ts` removes phones (UA and
  international), emails, cards, IBAN, Nova Poshta numbers, street addresses, participant usernames and names after a
  greeting; a customer message with delivery data or a full name becomes «[дані для доставки]». Names written
  elsewhere in a message can slip through, so the owner reviews the examples before «Застосувати». Notes facts feed
  the notes draft, which the owner saves. Consent off stops a running read and clears everything drawn from it.

### Demo widget, simulator, manual API
`modules/demo/` (debounce buffer, rate limiter, daily budget per model), `modules/testing/` (admin
Simulator page, Live DM console with photo upload), `POST /conversation/reply` (manual).

## Claude connector (`modules/mcp/`)

An owner adds `https://mcp.directmate.app/mcp` to Claude as a custom connector (how-to: admin `/claude`), and Claude
interviews them and sets the store up through tools. The tools wrap the services the admin setup uses, so both write
the same store. Off unless `MCP_ENABLED=true`.
- **Transport:** raw Express router (`McpHttpService.router()`), mounted in `main.ts` before CORS and outside Nest's
  exception filter. `POST /mcp` only, stateless Streamable HTTP with JSON responses, one `McpServer` per request
  (`mcp.server.ts`). Limited per grant (120 calls/min), not per IP: claude.ai users share Anthropic's addresses.
- **OAuth 2.1, our own** (`oauth/`): RFC 9728/8414 metadata, dynamic client registration (public clients, PKCE S256),
  redirects only to Claude's callbacks or loopback (`redirects.ts`). `/oauth/authorize` sets a 10-minute cookie
  (`dm_claude_request`, domain `MCP_COOKIE_DOMAIN`) and sends the browser to the admin's `/claude/authorize`; only that
  browser can allow (enforced in production). Approve loads the user from the DB: active owner of a live, non-demo
  store. Opaque tokens, stored as sha256: access 1 h, refresh 90 days and rotating (a reused refresh token revokes the
  grant). Owners revoke under Connections → Claude (`mcp_grants`).
- **Tools** (`mcp-tools.service.ts`): status, notes (read and merge-save, never overwriting what Settings changed),
  feed preview and connect (answers within ~25 s, a longer import carries on), Instagram / Shopify / Telegram links,
  tone, sizing, skip a step, `try_agent` (the owner's test chat), `go_live` (`confirmed: true` only after the owner's
  explicit yes; learning first), `set_instagram_permission` (read or reply, one at a time, `confirmed: true` only after
  a yes) and `get_history_import` (the terms and the tone it learned; the reply examples quote customers, so Claude
  gets only a link to review them in the setup). Right after Instagram connects, `next` has Claude say nothing is
  read or answered without permission and ask for each separately, once. Every result carries `next`
  (`setup-guide.ts`): what to ask, which tool after.
  Text that customers or feeds wrote comes back under `untrusted_content`, and the server instructions say it is data.
- **Browser steps:** Instagram and Shopify links carry a one-time hand-off token (10 min, one action, `handoff_tokens`),
  so the admin pages they open (`/claude/instagram`, `/claude/shopify`, `/claude/done`) need no admin session.
- **Chat preview:** `try_agent` is an MCP App (`@modelcontextprotocol/ext-apps` 1.7.5; 2.x needs SDK v2). The page
  (`app/chat-preview.ts`) draws the test conversation as a Direct chat, capped at 520 px and opened at the newest
  message. Its `ui://` address carries a hash of the page: Claude keeps its own copy by address, so a changed page
  needs a new one.
- **Funnel:** `setup_events` (`source=claude`): authorized, catalog_connected, instagram_connected, first_try_agent,
  go_live.
- **Limits:** sign-up 5/min and login 10/min per client address (`ClientIpThrottlerGuard`, keyed on nginx's
  `X-Real-IP`); test messages per store per 24 h (`TEST_CHAT_DAILY_LIMIT`, admin and Claude together, counted from
  `conversation_traces`).
- **Production:** `infra/production/nginx/conf.d/mcp.conf` proxies only the connector's routes; issue its certificate
  before deploying it (steps in the file).

## Meta/Instagram Setup

Two logins, recorded per connection in `connections.login_method`. `INSTAGRAM_LOGIN_METHOD` picks the one new
connections use (default `instagram`); existing connections keep theirs. Every Graph call takes its host from the
connection (`igAccountOf()` in `modules/integrations/ig-account.ts`, `graphApi()` in `common/meta-graph.ts`) and names
the account id; the paths are the same on both hosts.

- **Instagram Login (`instagram`, the default since 21 Nov 2026).** The owner logs in at instagram.com, no Facebook.
  `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` = the Instagram app under the Meta app's "API setup with Instagram
  login" (id 4566420570267244). Scopes `instagram_business_basic`, `instagram_business_manage_messages`,
  `instagram_business_manage_comments` (comments not approved yet: granted only to people with a role on the app).
  - OAuth: `www.instagram.com/oauth/authorize` (state `<token>.<returnTo>.ig`) → `/auth/instagram/callback` → code at
    `api.instagram.com/oauth/access_token` → 60-day token at `graph.instagram.com/access_token?grant_type=ig_exchange_token`
    (never saved short-lived) → `GET graph.instagram.com/v27.0/me?fields=user_id,username`: `user_id` is the
    professional account id = webhook `entry.id` = `external_account_id` (no `user_id` → `exchange_failed`).
  - Calls on `IG_GRAPH_API` (`graph.instagram.com/v27.0`). Tokens are renewed daily once fewer than 10 days are left
    (`IntegrationsService.refreshInstagramTokens`, `@Cron` 04:00, `INSTAGRAM_TOKEN_REFRESH_WORKER_ENABLED`; also
    `POST /internal/instagram/refresh-tokens`); an expired one marks the connection `error` and the store reconnects.
  - History import: Meta returns content only for a conversation's 20 most recent messages, and Instagram Login's
    edge may list only ids, so the client then reads each message by id (2 calls/s per account).
  - Webhooks are set under "API setup with Instagram login" and signed with the Instagram app secret.
- **Unified Login (`unified`).** Facebook Login for Business with a system-user token. `META_APP_ID` /
  `META_APP_SECRET` = the **Meta** app's; `META_LOGIN_CONFIG_ID` = the "Instagram API (Unified Login)" configuration,
  which owns the permissions (the login URL carries no scopes). Calls on `GRAPH_API` (`graph.facebook.com/v27.0`).
  - OAuth: `facebook.com/dialog/oauth?config_id=…` (state `….fb`) → code at `graph.facebook.com/v27.0/oauth/access_token`
    for a Business Integration System User token (no refresh grant; an expiring one is only logged) →
    `GET /me/assigned_instagram_accounts`: its id is `entry.id`. **`/me` is the system user, never the account.**
    More than one shared account → `reason=multiple_accounts`.
  - **Blocked for real stores:** Meta opens system-user-token configurations only to people with a role on the app
    ("Feature Unavailable" for everyone else) until the business is a Tech Provider; a user-token configuration
    opens. Kept for when Meta lifts that.
- **Both:** the callback subscribes the account with `POST {host}/{ig-id}/subscribed_apps?subscribed_fields=messages,comments`,
  or `messages` alone when Meta refuses comments (not granted); without it no webhook arrives. The webhook check
  accepts a signature from either app's secret, and an echo's `app_id` from either app.
- Webhook URL: `https://directmate.app/channels/instagram/webhook` (one callback per webhook setting: pointing one at
  ngrok takes it away from production). Verify token: `directmate_verify_a3f7b9c2e1d4`.
- Token stored encrypted in `connections` table
- Both sender and receiver must be app testers in development mode (Instagram Tester role, accepted on instagram.com)

## Testing

- **Unit tests** (`cd apps/api && npm test`): mock models, free, run on every commit by the pre-commit hook.
- **Simulator** (`npm run simulate`): real model calls through the same `TurnRunner`, in `demo` mode
  against the local DB. **It costs money — suggest the command; run it only when asked.** Scenario packs
  live in `apps/api/src/scripts/scenarios/<tenant>/`. Assertions check outcomes, not wording:
  `handoff`, `handoffReason`, `orderDraft`, `orderPlaced`, `paymentDetailsSent`, `toolCalled`,
  `replyContains`, `replyMentionsSize/Color`, `shortlist`, `replyMaxChars`; implicitly, the guards
  passed and the step cap wasn't hit. `advanceHours` tests conversation boundaries; `image` sends a
  photo; `expectedFailure` marks a known bug.
- Scenarios written for the old engine still run: `mapLegacyExpect` (`modules/testing/scenario-assertions.ts`)
  drops their route-only checks and lists them per turn. They are due a rewrite to outcome checks before
  the Phase 6 model comparison.
- `scenarios/demo-altamen/attacks.ts` is the prompt-injection pack: run it after any prompt or model change.
- Tenants the seeds can rebuild: `demo-altamen`, `demo-women-clothes`, `demo-cosmetics`. The packs for
  `clothes-store`, `luxespace`, `pilot`, `men-demo-store` and `showcase-women-clothes` need those
  tenants' data locally (copied from prod).

## Issue Triage Protocol

When encountering a conversation issue, ALWAYS classify it first before fixing:

1. **Bug** — code doesn't do what the architecture intended (a tool returns the wrong data, a guard
   misfires, a missing write). Quick fix.
2. **The model went wrong** — it picked the wrong tool, skipped one, misread the conversation or ignored
   a rule, while the tools gave it what it needed. Fix with the prompt, a tool description, or what a
   tool returns (a note in the tool output is often more reliable than a prompt rule).
3. **Architectural** — the design can't handle the case (missing data, no tool for it, a store setting
   that doesn't exist). Needs a plan.

State the classification before proposing a fix.

### Investigation order
1. Read the turn's trace: admin → Conversations → Trace tab (copy as markdown), or the simulator's output
   JSON. It has every tool call with its input and output, the guard findings per attempt, and the
   history the agent was given.
2. Reproduce in the simulator: `npm run simulate -- --tenant <slug> --message "<text> || <next turn>"`.
3. Tool output wrong or missing → bug or architectural. Tool output right, reply wrong → the model.
4. A handoff with reason `unsure` usually means a tool gave the model something it couldn't use — check
   the last tool result before blaming the prompt.

## Demo stores and seeds

- **Builders** (`apps/api/src/scripts/seed/builders/<vertical>-builder.ts`) build a demo tenant end to end:
  tenant, settings, store config with knowledge doc and fixed lines, catalog, media, size charts. Common
  primitives live in `tenant-builder.ts`. Entry scripts (`seed-demo-<vertical>.ts`) delete the tenant by
  slug (CASCADE — conversations go too), assert no orphans, then build.
- **Store notes as code** for demo stores: `seed/knowledge/*.ts` (+ `demo-store-copy.ts` for the welcome,
  handoff and fake payment lines). Production stores edit theirs in the admin panel.
- **Backfills instead of reseeding** for stores that hold conversations: `backfill:agent-config` (store notes
  and lines onto demo stores, fills only empty fields), `backfill:altamen-titles`,
  `backfill:altamen-descriptions`, `backfill:media-phash`. Each has a `:prod:` variant that runs the
  compiled script.
- **men-demo-store** (cold-outreach demo) can't be rebuilt from this repo. `snapshot:men-demo`,
  `verify:men-demo`, `restore:men-demo` guard its configuration.
- **showcase-women-clothes** is synced from prod (`scripts/sync-showcase-from-prod.sh`). Never reseed it locally.
- `DemoService` loads `is_demo` tenants at boot: after seeding a new demo tenant, restart the API.
  Deploy order: migrations → seed/backfill → restart.

## Production patterns to replicate

A new caller of the agent (a channel, a batch job) calls `TurnRunner.run({ tenantId, conversationId, mode,
source, … })` after saving the customer's message. The runner loads history from the DB itself. Pick the
mode for the side effects you want; never add `isDemo`-style flags inside the agent. Set `source` (a
`TraceSource`) so every trace says where it came from.

## Known issues / tech debt

- **Self-serve setup gaps:** a Shopify token isn't checked on connect, and its products wait for an operator-run n8n
  sync (the founder gets a Telegram notice). `POST /catalog/feeds` imports in one request of up to 1–2 min, longer than a
  default 60 s proxy timeout. Connecting a second product source doesn't disconnect the first. Notes edited in Settings
  after setup aren't reflected in the setup draft (`tenant_onboarding.notes_draft`), so saving from setup again
  overwrites them.

- **Store notes:** production stores (`clothes-store`, `luxe-space`, `pilot`) have no knowledge doc yet —
  that is the onboarding work. Until then the agent hands off delivery and payment questions there.
- **Promise check reads negations in the notes as offers:** a note saying «знижок немає» counts as the
  store offering discounts. Write notes without promise words, or fix `checkPromises` to skip negated
  sentences in the notes.
- **Number-sized products** (trousers 42–58, jeans 30–38, shoes) get a size recommendation only from a
  ready size chart that covers them: the height/weight ranges are one letter-size table per store.
- **Instagram history import:** Live mode needs Advanced Access to `instagram_manage_messages` (App Review). The
  read budget is shared by every store, so two stores connecting in the same hour may wait for the next hour.
  Replies sent by other auto-reply tools (ManyChat and similar) look like a person's in history and can't be told
  apart. After the store connects, a reply counts as a person's only if its echo was saved as a `manager` message.
  Not yet run end to end against a live account.
- **Comment private replies are text only;** the agent is told, but a staged photo is silently dropped. Comments on
  reels are still ignored.
- **Content images and voice messages:** the in-progress and already-tried captures and transcriptions are per process
  (a second replica could copy twice).
  Files under `uploads/content-media/` are never deleted: covers that only stood in, re-copies after a file went
  missing, and copies of other accounts' posts all stay. The content fetch cron skips its run while the history
  import's Graph budget pause (`app_state.instagram_history_budget`) is on; the «Fetch content» button doesn't.
  `ffmpeg-static` downloads its binary from GitHub during `npm ci`; if that fails a deploy, install ffmpeg with apt and
  set `FFMPEG_BIN`.
- **Live Instagram checks still pending:** on Instagram Login, that manager replies arrive as echoes (else subscribe
  `message_echoes`), that the history import reads message text and tells the shop's messages by `from.id`, and
  stories/media on graph.instagram.com; on Unified Login, the echo `app_id` and `entry.id` shape. Comment replies for
  real stores wait for `instagram_business_manage_comments` approval.
- Three local tenants (`clothes-store`, `men-demo-store`, `luxe-space`) share one IG account id;
  `findByExternalAccountId` has no ordering, so a live DM lands in any of them. Keep one connected.
- men-demo-store's brand tone says "Never reveal you are AI", which contradicts its welcome line.
- Demo budget config is still named after the old models (`DEMO_BUDGET_CENTS_GPT54_MINI` / `…_GPT54`) and
  only caps those two; other agent models fall back to the mini cap.
- Demo buffer, demo rate limiter: per-process in-memory `Map`s. Move to Redis before running more than one replica.
- `app.set('trust proxy', true)` in `main.ts` accepts any `X-Forwarded-For`; tighten once the deploy
  topology is fixed (Cloudflare → nginx → Node).
- E2E tests (`apps/api/test/`) cover only `/demo`.
- `flow_config` is `Record<string, unknown>` on the entity; the agent reads it through zod schemas in
  `store-settings.service.ts`. Some jsonb updates still use `as any`.
- `variants.color` / `variants.size` are reused for non-clothing axes (cosmetics: mask type in `color`,
  SPF in `size`). Move to typed attribute columns when a third vertical lands.
- `product_variants.image_url` is a dead column; per-colour images live in `product_media` keyed by
  `(product_id, color)` and two consumers build the map independently (`catalog.service.ts`,
  `availability.service.ts`). Colour matching there lowercases both sides — catalog sync must keep
  colour casing consistent.
- Shopify sync stores colours in the `size` field (`selectedOptions[0]`).
- Cosmetics demo images come from public CDNs into `test-assets/cosmetics/`; a rotted URL shows as a
  missing image, not a failure.
- `MessageBubble.tsx` (demo widget) shows at most 4 images per message.

## Dev Commands

```bash
# Start database
cd infra/docker && docker compose up -d

# Run migrations
cd apps/api && npx ts-node -r tsconfig-paths/register ../../node_modules/typeorm/cli.js migration:run -d src/database/data-source.ts

# Start backend / admin (dev)
cd apps/api && npm run dev
cd apps/admin && npm run dev

# Build shared package
cd packages/shared && npm run build

# Seed demo stores
cd apps/api && npm run seed:demo:altamen        # also :women-clothes, :cosmetics
cd apps/api && npm run backfill:agent-config -- --dry

# Simulator (costs model calls)
cd apps/api && npm run simulate -- --list
cd apps/api && npm run simulate -- --scenario <key>
cd apps/api && npm run simulate -- --tenant demo-altamen --message "Привіт || а чорна є?"

# One-off agent turn / product attributes
cd apps/api && npm run agent:try
cd apps/api && npm run attributes:extract -- --tenant demo-altamen
cd apps/api && npm run content:eval -- --tenant demo-altamen   # visual check vs confirmed content (paid)

# Unit tests (free)
cd apps/api && npm test
```

## Environment Variables (apps/api/.env)

```
NODE_ENV, PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN
META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_LOGIN_CONFIG_ID, INSTAGRAM_OAUTH_REDIRECT_URI
INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET (Instagram Login), INSTAGRAM_LOGIN_METHOD (instagram | unified; new connections)
INSTAGRAM_TOKEN_REFRESH_WORKER_ENABLED (daily renewal of Instagram Login tokens; default on, the CLI scripts turn it off)
APP_BASE_URL, BACKEND_BASE_URL, ADMIN_BASE_URL
OPENAI_API_KEY, OPENAI_VISION_MODEL
AGENT_MODEL, AGENT_MAX_STEPS, AGENT_TIMEOUT_MS, AGENT_REASONING_EFFORT, AGENT_TEMPERATURE
AGENT_MAX_CUSTOMER_MESSAGES_PER_HOUR, AGENT_MODERATION, JUDGE_MODEL
INSTAGRAM_DEBOUNCE_MS, INSTAGRAM_COMMENT_GATE_MODEL
ATTRIBUTES_MODEL, ATTRIBUTES_REASONING_EFFORT, ATTRIBUTES_WORKER_ENABLED
HISTORY_IMPORT_WORKER_ENABLED (the Instagram history import cron; default on, the CLI scripts turn it off)
CONTENT_FETCH_WORKER_ENABLED (the Instagram content fetch cron: stories, posts, reels; default on, the CLI scripts turn it off)
FFMPEG_BIN (optional: an ffmpeg binary for video frames instead of ffmpeg-static's)
CONTENT_VISION_MODEL (the visual check of content, defaults to ATTRIBUTES_MODEL), CONTENT_VISION_REASONING_EFFORT (default low)
TRANSCRIBE_MODEL (customers' voice messages, default gpt-4o-mini-transcribe)
SIZE_CHART_MODEL (vision; reads uploaded size charts, defaults to ATTRIBUTES_MODEL), SIZE_CHART_REASONING_EFFORT (default low)
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME
DEMO_DEBOUNCE_MS, DEMO_MAX_MESSAGE_LENGTH, DEMO_RATE_LIMIT_SESSIONS_PER_HOUR, DEMO_BUDGET_CENTS_GPT54_MINI, DEMO_BUDGET_CENTS_GPT54
ENCRYPTION_KEY (64-char hex), INTERNAL_API_KEY, ANTHROPIC_API_KEY (Phase 6)
MCP_ENABLED, MCP_PUBLIC_URL (the MCP host's origin; the connector is `${MCP_PUBLIC_URL}/mcp`), MCP_COOKIE_DOMAIN (production:
directmate.app), MCP_DEV_TENANT_ID / MCP_DEV_TOKEN (development only: a static bearer for MCP Inspector and curl)
TEST_CHAT_DAILY_LIMIT (test messages per store per 24 h; default 100, 0 = no cap)
```

## File Conventions

- Entities: `@Entity('table_name')`, camelCase props, SnakeNamingStrategy handles DB columns
- Migrations: raw SQL in `up()`/`down()`, timestamped filename
- Controllers: `@UseGuards(JwtAuthGuard)`, `@CurrentUser()` decorator for tenant context
- Services: constructor injection, `@InjectRepository()` for TypeORM repos
- Admin pages: TanStack Query for data, Tailwind for styling, existing UI components in `components/ui/`
- Owner-facing copy (admin, setup, owner and manager Telegram messages) calls it «AI-агент» / "AI agent", never
  «бот» / "bot": it's sold as more than a chatbot. The exception is our Telegram bot (@DirectMateBot). Customers
  are told «AI-асистент» by the welcome line.
- Icons: only from `components/icons.tsx` (Google Material Symbols Rounded, weight 300, imported as SVG components;
  brand logos inline). Never import an icon library directly.
- Setup flow (`/onboarding`, full-screen, outside `<Layout>`): the shell is `pages/onboarding/SetupShell.tsx`; each step in
  `pages/onboarding/steps/` hands its one primary action to the footer with `useSetupStep()`. Primitives (buttons,
  alerts, chips, sheets) are in `components/setup/ui.tsx`, colours are the `dm-*` Tailwind tokens, strings live in
  `i18n/setup/<area>.ts`. The API reports eight steps; the owner sees six (tone inside «Спробуйте AI-агента», Telegram inside
  «Увімкнути AI-агента»). Design source: the «DirectMate Onboarding Design» canvas.
