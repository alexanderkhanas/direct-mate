# DirectMate v2: Agent Architecture Decisions

Nov 3, 2026 · @Alexander Khanas

## How to read this

DirectMate is moving from a classifier-and-router engine to a tool-calling agent. This doc records what was decided and why, so implementation choices stay consistent with the reasoning. It is a decision record, not a step-by-step plan.

Status labels used below:

- **Decided:** Alexander confirmed it.
- **Recommended:** came out of the design discussion but was not explicitly confirmed. Treat it as the default direction, and flag it before building anything hard to undo.

Immediate scope is the agent core (Decisions 1 to 8). The product direction section is context only: the core must not block it, but it is built later.

Facts about the current code came from conversation notes at first. They have since been checked against the repo (Nov 3, 2026, last section), and the doc is corrected where they were wrong. The build order is in [implementation-plan.md](implementation-plan.md).

Changes after review on Nov 3, 2026:

- **Handoff is announced, not silent.** Every "silent handoff" below now reads "announced handoff". The bot already tells customers it is an AI assistant, so a silent stop reads as dead air. Saying the conversation is being passed to a manager is honest, and in the demo it shows the feature working.
- **The old engine is replaced outright.** There are no active clients, so there is no side-by-side migration (first open question).

## Why we're changing the core

The bot is unstable because of how the engine is built, not because of any single bug.

Today a classifier (GPT-5.4-mini) labels each incoming message with an intent, a `recommendedAction` and entities. Code routes that label through gates to mostly hardcoded templates and tracks flow state in enums like `awaiting_product` and `awaiting_variant`.

This breaks on short, context-dependent replies like "так", "L" or "а чорна є?". They only make sense alongside the conversation, and a per-message label throws that context away. A wrong label means a wrong turn, and the model never sees the result of its choice.

The recent fix history is one root bug showing up in different places:

- gate/branch drift from non-deterministic `recommendedAction` (the `isCheckoutWithFullCart` predicate)
- `updateMemoryFromAction` downgrading `awaiting_variant` to `awaiting_product`
- `CoverageJudge` for questions after a product is selected
- `isProductPivotSignal` for "product selected + size named"
- keyword allowlists to stop false size-help triggers

Business context: as of Nov 2026 the product is stagnating and distribution isn't working. P0 is a bot that is rock solid, because every distribution idea (content-led marketing, self-serve onboarding) depends on a bot that can run without supervision.

## Decision 1: A tool-calling agent replaces the classifier and router

**Decided.** The model runs the conversation the way a real shop manager would: it sees the full history, decides what to do next, calls tools to look things up or act, and writes the reply.

The change is in control flow, not in the API. Today code decides the flow and the LLM is a function that returns a label. In the agent, the model decides each step in a loop (call a tool, read the result, decide again) until it writes the reply. A multi-part message like "а чорна є? на 182, 75 кг" is handled in one turn with two or three tool calls and no intent label.

|  | Today | Agent |
| --- | --- | --- |
| Who picks the next step | Gates and branches in code | The model, every step |
| What the model sees | Current message plus extracted memory | Full history plus tool results |
| What the model outputs | A label | Tool calls, then the reply |
| LLM calls per turn | Fixed, 1 to 2 | Variable, usually 2 to 4 |
| Conversation state | `awaiting_*` enums | History plus a structured order draft in the DB |
| Where reliability comes from | Correct routing | Good tools plus output guardrails |

**Goes away:** the classifier, intent enum, `recommendedAction`, routing gates, `awaiting_*` flow states, `CoverageJudge`, the AI fallback path, keyword allowlists.

**Stays, as tool implementations:** product lookup, size charts, product card rendering, the payment details template, order creation, handoff. Existing NestJS services get wrapped, not rewritten.

**New:** the agent runtime, tool definitions, a per-tenant system prompt, the grounding check, the order draft as a table, and the reliability layer (Decision 5).

Tool descriptions become the routing logic. "Call `get_size_help` when the customer mentions height or weight, or asks which size fits" replaces the size keyword allowlist, so these descriptions deserve the care the classifier prompt used to get.

## Decision 2: Vercel AI SDK as the agent runtime

**Decided.** The agent is built on the Vercel AI SDK (`ai` package), using `ToolLoopAgent` with zod-typed tools and a `stopWhen` step cap.

Why this one:

- **Provider-agnostic.** OpenAI, Anthropic and Google sit behind one interface, so the model comparison in Decision 6 is a config change.
- **Thin.** It runs the loop, validates tool arguments and enforces step limits. It does not try to own memory, storage or evals, which DirectMate already has (Postgres history, the simulator).
- **Traceable.** The result's `steps` give the full per-turn trace for logging and for simulator assertions.

Version note: v7 is the current major (released 25 Jun 2026) and renamed several APIs, for example `stepCountIs` became `isStepCount` (v7 still exports `stepCountIs` as an alias). Pin the major version, since many tutorials still show v6 names ([source](https://www.issoh.co.jp/tech/details/10402/)).

v7 and its providers are ESM-only, while `apps/api` is CommonJS. Verified Nov 3, 2026 on `ai` 7.0.162: on Node 22 they load through `require(esm)` from `nest build` output and ts-node with no tsconfig change. Jest needs a transform for `ai`, `@ai-sdk/*` and `@workflow/serde`. Production and CI moved from Node 20 (end of life Apr 2026) to Node 22 for this. Node 22 itself reaches end of life in Apr 2027, so the next move is to Node 24.

| Alternative | Why not |
| --- | --- |
| Hand-rolled loop | The loop itself is easy, but argument validation, step caps and traces are boilerplate the SDK already gets right. |
| OpenAI Agents SDK (`@openai/agents`) | Good guardrails, sessions and tracing, but its tooling centres on OpenAI. Reasonable fallback if the AI SDK disappoints. |
| Mastra | Bundles memory, evals and workflows, which duplicates what DirectMate has and imposes more structure. |
| LangChain / LangGraph | Too heavy for one agent. |
| Claude Agent SDK | Built for coding and computer-use agents, the wrong shape for a DM bot. |

## Decision 3: Determinism lives in tools and guardrails

**Recommended.** The model gets freedom over language, not over facts or side effects.

- **The model owns:** understanding the customer, deciding what to ask next, wording and tone.
- **Code owns:** prices, stock, sizes, order state, payment details and handoff. The model reaches these only through tools.

Initial tool set (working names):

| Tool | Kind | Purpose |
| --- | --- | --- |
| `search_products` | read | Find candidates in the tenant catalog |
| `get_product` | read | Full details, variants and stock for one product. Required before quoting price, colour or size availability |
| `get_size_help` | read | Size recommendation from height and weight, limited to sizes in stock (charts are images; numeric ranges live in `flow_config.sizeChart`) |
| `send_size_chart` | side effect | Send the size chart image |
| `update_order_draft` | state | Read and write the structured order draft |
| `show_products` | side effect | Send product images (there is no card or carousel today: images go out as separate DMs, at most 4) |
| `send_payment_details` | side effect | Send the exact bank details template |
| `place_order` | side effect | Turn a complete order draft into an order (idempotent) |
| `handoff` | side effect | Announced handoff to a human |

The order draft is the existing `checkout_sessions` model. Payment details don't exist yet and become a new per-store setting. The final tool list is in the implementation plan.

Constraints that follow:

- **Templates survive as tool outputs.** Product cards, size chart images and the payment template keep their exact rendering. The problem was the classifier choosing them, never the templates.
- **The order draft is DB state,** read and written through tools. What's in the cart never depends on the model remembering the conversation.
- **Side effects check DB state, not the model's say-so.** For example, `send_payment_details` refuses unless the order draft is complete.
- **Grounding check before every send.** Any price, size or stock claim in the outgoing text must match a tool result from that turn. On failure, regenerate once, then announced handoff.
- **Side effects support a dry-run mode.** Shadow mode (see Product direction) runs the agent on live traffic without sending anything, so every side-effect tool needs a path that records what it would have done instead of doing it. Design this in from the start, because retrofitting it is painful. The existing per-store `operatingMode` is the natural switch.
- **Side-effect tools are idempotent** (Decision 5).

## Decision 4: One AI-friendly knowledge source per tenant

**Decided** in concept: each tenant has a single source the agent works from. **Recommended:** no vector DB at the start.

Each tenant's source has three parts:

1. **Normalized catalog:** products, variants (size, colour), price, stock, images and size chart links, in one internal shape regardless of origin (Shopify, feed, sheet).
2. **Knowledge doc:** delivery, returns, payment and fit notes ("ці джинси маломірять, беріть на розмір більше"), plus anything else a manager would know.
3. **Tone profile:** how this shop's manager writes, with real example messages (Decision 7).

Why no vector DB yet: a typical shop has 20 to 300 SKUs. A compact catalog index (id, name, category, colour, price, sizes in stock) fits in a cached system prompt, and the agent calls `get_product` for detail. This follows the existing principle of adding vector search only when a real catalog shows the problem. pgvector remains the path if a tenant's catalog outgrows the prompt or fuzzy matching fails in evals. This supersedes the earlier note that pgvector was a near-term priority.

## Decision 5: The production reliability layer

**Recommended.** The agent library is a small part of reliability. The rules below are what no framework provides, and they decide whether the bot is rock solid in production.

| Problem | Rule |
| --- | --- |
| Message bursts ("привіт", "а є чорна?", "на 182" within seconds) | Debounce per conversation: wait a few seconds after the last message, then run once over all new messages |
| Overlapping runs | One lock or queue per conversation, so two runs never answer the same thread |
| Webhook duplicates and retries | Store each message `mid` and ignore repeats |
| Retries after a partial failure | Side-effect tools check state first: payment details are never sent twice, an order is never created twice |
| A human manager replies | An `is_echo` message the bot didn't send pauses the bot on that thread. Echoes include the bot's own sends, so match against the `mid`s the bot sent |
| Model error, timeout or step cap hit | Announced handoff with fixed copy, never a broken or partial reply |
| Invented facts | Grounding check (Decision 3) before sending |

Message pipeline, in order:

1. Webhook arrives; drop it if the `mid` was already seen.
2. If it's an echo the bot didn't send, pause the bot on that thread and stop.
3. Debounce the conversation.
4. Take the per-conversation lock.
5. Run the agent over the history plus all new messages.
6. Run the grounding check and the russism guard (Decision 7).
7. Send in live mode, or record in shadow mode.
8. On any failure along the way, announced handoff.

Latency: two to four model calls per turn is fine for DMs, where human managers take minutes. Start with a step cap of 6 and tune it from traces.

## Decision 6: The model is chosen by eval, not carried over

**Recommended.** Start on GPT-5.4-mini because it's already integrated, then pick the production model by running the new agent through the simulator.

The earlier A/B (GPT-5.4-mini vs Claude Haiku 4.5 over 115 scenarios, where GPT won on breakage, cost and latency) measured classification. Running a whole conversation, choosing tools and writing Ukrainian is a different job, so that result does not carry over.

Score each candidate on two separate axes:

1. **Tool and fact correctness:** right tools and arguments, no invented prices or sizes, complete order drafts, handoff when it should happen.
2. **Ukrainian quality:** naturalness, register and russisms (Decision 7).

Also measure cost per conversation and latency per turn. Candidates are the mid tiers of OpenAI, Anthropic and Google. Ukrainian usually takes more tokens than English, so measure cost on real Ukrainian conversations.

Research context: no reliable public benchmark compares current frontier models on conversational Ukrainian. A UNLP 2026 benchmark on normative grammar and orthography found smaller models scoring at most 42.1% and the largest around 60% ([source](https://aclanthology.org/people/oksana-popkova/unverified/)), so small tiers will make more language mistakes. Open Ukrainian models such as MamayLM and Lapa are strong for their size but need GPU hosting and have weaker tool calling, so they are out for the agent ([leaderboard](https://benchmarklist.com/benchmarks/ukrainian_llm_leaderboard/)).

## Decision 7: Ukrainian language quality

**Recommended.** Real examples and guards matter more than the choice of model.

1. **Few-shot from real manager messages,** pulled from the tenant's IG history (backfill, see Product direction). This is what makes the bot sound like this particular shop.
2. **A short style guide in the system prompt.** It bans bureaucratic openers ("Дякуємо за ваше звернення", "Чим можу допомогти?") and lists the classic russisms with their fixes.
3. **A deterministic russism guard before sending:** a regex list of known errors. On a hit, regenerate once. It adds no latency to clean replies.
4. **A Ukrainian judge in the simulator.** A stronger model scores each reply for naturalness and russisms, so language regressions fail like any other test.

Starting russism list:

| Wrong | Right |
| --- | --- |
| на протязі | протягом |
| приймати участь | брати участь |
| вибачаюсь | перепрошую |
| слідуючий | наступний |
| являється | є |
| по розміру | за розміром |

Tone policy: match the shop's casual tone, but always write clean Ukrainian. If a manager writes in surzhyk, the bot does not copy it, because from a bot it reads as errors.

## Decision 8: The simulator stays and asserts outcomes

**Recommended.** The simulator is the most valuable asset in this rewrite. Keep every scenario (200 scenarios and 594 turns as of Nov 2026, including ones derived from production traces) and rerun them against the agent.

Assertions move from routes to outcomes, because the agent's path through a turn is no longer fixed:

| Old assertion | New assertion |
| --- | --- |
| Routed to `size_help` | Recommended a size that is in stock for that product |
| `recommendedAction` is checkout | Order draft complete: product, variant, name, phone, delivery |
| Fallback triggered | Handoff triggered when it should be, and announced |

New assertions with no old equivalent:

- Every price, size and stock claim in a reply matches a tool result.
- No russisms, and the Ukrainian judge score clears a threshold.

Every run records the per-step trace (tool calls, arguments, results, final text), so failures can be debugged and interesting traces can become new scenarios.

## Product direction the core must not block

**Context only, not this phase.** These items came out of the same discussion and are built later. Where they constrain the core now, it's marked as an architecture implication.

All of these are **Recommended**. Two revise Alexander's original idea, and the original is noted.

1. **Onboarding interview.** A conversational setup inside the tenant admin asks about the shop, policies and delivery, and where the products live. Original idea: an MCP connector for Claude. Revised: build it in-app first, because target owners are mostly not technical. The part worth keeping is the feeling of building it yourself.
2. **Product sources.** Accept Google Merchant Center XML (variants via `item_group_id`), YML (the common export from Ukrainian platforms like Prom, Rozetka and Horoshop), a Google Sheet template, and the existing Shopify integration. Later, extract products from IG posts for shops with no website. A feed is a URL re-synced daily, not a one-time upload. *Architecture implication:* every source normalizes into the one catalog shape from Decision 4.
3. **IG connect and backfill.** On day one, pull recent history through the Conversations API. Limits: details only for the 20 most recent messages per conversation, and Requests-folder threads inactive for 30 days aren't returned ([source](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api)). The output is a tone profile plus extracted facts, which the owner approves before use. Store as little raw chat as possible, and redact names, phones and Nova Poshta addresses.
4. **Shadow mode instead of a blind 14-day learning period.** Original idea: collect manager messages for 14 days, then show a demo. Revised: backfill gives day-one learning, then for 7 to 14 days the agent drafts a reply to every incoming DM without sending it. The admin shows the customer message, the manager's actual reply and the bot's draft side by side. Live manager replies arrive as `is_echo` webhook events ([source](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)). *Architecture implication:* dry-run side effects (Decision 3).
5. **Paywall and phased go-live.** The shadow report is the sales pitch ("the bot matched your manager on X of Y real conversations"), and paying turns on autopilot. Rollout follows the existing phased plan: nights first, then 24/7, with handoff whenever a human is needed.
6. **MCP connector later.** With the backend as clean tools, an MCP server is a thin layer. Treat it as a marketing experiment for an AI-savvy audience, after the core and in-app onboarding.

Distribution, outside engineering scope: content-led "friend recommendation" reels (for example, "how to set up an IG bot for your clothing store") that show the result in the first seconds.

Order of work: agent core and simulator, then self-serve onboarding, then shadow mode with the side-by-side view and paywall, then content, then MCP.

## Principles carried over

These came from the old architecture and still hold in the agent:

- **Handoff over guessing.** When the bot is uncertain or something fails, it hands off instead of improvising. The handoff is announced to the customer. This replaces the earlier "silent handoff" rule, because the bot discloses that it is an AI assistant.
- **Never gate critical actions on non-deterministic model output.** In the agent, side effects check DB state, not the model's word.
- **Investigator discipline.** Verify bug scope empirically, re-read the actual code, and mark findings as verified or assumed.
- **Defense-in-depth against entity leaks.** Tools return only data scoped to the current tenant and conversation.
- **Per-store configuration in `flowConfig` and `operatingMode`,** not hardcoded business-type logic.
- **Plain language** in anything a shop owner sees.

## Open questions and facts to verify

Open questions:

- ~~Does the agent run alongside the old engine behind `operatingMode` during migration, or replace it outright?~~ Settled: replace outright.
- Which model goes to production? Settled by the Decision 6 eval.
- How long is the debounce window? Start with a few seconds and tune on real traffic.
- Is the shadow period 7 or 14 days?
- What is the retention policy for data pulled in the backfill?

Verify against the code before building, since these come from notes, not the repo:

All checked on Nov 3, 2026. The details, with code references, are in the implementation plan's "Verified facts" table.

- [x] **Simulator:** 200 scenarios and 594 turns, not 41. 107 scenarios assert routes (scenario, selection state), which the agent no longer has. 124 target tenants that the seed scripts can't rebuild.
- [x] **Services to wrap:**
  - Product lookup, size charts, order creation and handoff exist.
  - There are no product cards (only images) and no payment details at all.
  - Size charts are images; numeric ranges sit in `flow_config.sizeChart`.
  - Lookups by product ID don't check the tenant.
- [x] **Webhooks:** they don't dedupe by `mid`. `is_echo` is handled, but the bot doesn't store the `mid`s it sends. It tells its own echoes from a manager's by timing guesses, which misfire both ways.
- [x] **`operatingMode`:** values are `learning | active | paused`. `paused` is never checked, and `learning` already runs a dry run.
- [x] **History:** stored in `messages` (role, text, `mid`). Extra replies on the Instagram path are not saved.

## Sources

- [Vercel AI SDK v6 and v7 overview](https://www.issoh.co.jp/tech/details/10402/)
- [OpenAI Agents SDK for TypeScript](https://openai.github.io/openai-agents-js)
- [Instagram Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api)
- [Instagram webhook notification examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)
- [UNLP 2026 Ukrainian proficiency benchmark](https://aclanthology.org/people/oksana-popkova/unverified/)
- [Ukrainian LLM Leaderboard](https://benchmarklist.com/benchmarks/ukrainian_llm_leaderboard/)
