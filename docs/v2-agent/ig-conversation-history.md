# Reading Instagram DM history (Unified Login)

What we know about pulling a store's past Instagram DMs through the Graph API. It's input for the onboarding history import.

**How we know it:** read-only calls on 7 Nov 2026 against `directmate_demo_shop` (`17841441761068120`). The calls used the Unified Login token stored for `demo-altamen`, while the Meta app was in **Development mode**. Facts marked *docs* come from Meta's pages and weren't tested. Treat the cost figures as one sample, not a benchmark.

## TL;DR

- **The history is readable.** It covers every conversation, messages months old, and replies a manager typed in the Instagram app. Text comes 50 messages per call.
- **Meta's 20-message cap doesn't apply here.** The cap in `decisions.md` (only a conversation's 20 most recent messages return content) comes from the Instagram Login docs. A message 149 back and four months old returned its text.
- **The limit is the app's hourly budget for message reads, not a call count.** One page of 50 messages costs about **7%** of it. A blocked read keeps the block going, so back off for a full hour.
- **Onboarding doesn't need a long job.** About 30 conversations × 20 messages fits inside one hour's budget and takes under a minute. Shadow mode collects the rest from webhooks at no cost.

## Endpoints

All on `GRAPH_API` (`graph.facebook.com/v27.0`), `Authorization: Bearer <system-user token>`. `/me` is the system user, so every path names the Instagram account ID.

| What | Call | Verified |
|---|---|---|
| Conversation list | `GET /{ig-id}/conversations?platform=instagram&fields=id,updated_time,participants&limit=25` | ✅ |
| Messages with content | `GET /{conversation-id}?fields=messages.limit(50){id,created_time,from,to,message,attachments,is_unsupported}`, then follow `messages.paging.next` | ✅ |
| One message | `GET /{message-id}?fields=id,created_time,from,to,message,attachments` | ✅ |

- `participants` returns usernames, so a conversation is identifiable without extra calls.
- `messages.limit(100)` still returns **50**. Treat 50 as the page maximum.
- Content comes **inline on the messages edge**. There's no need for a call per message. The fields `{…}` expansion on the edge is what makes that work.
- Permission: `instagram_manage_messages` (already in our configuration). Clients without a role on the app need Advanced Access and the app in Live mode (*docs*).

## What the reads returned

**Conversation list:**
- 10 conversations, the oldest updated in July 2026, all on one page.

**Message paging (one thread with `_khanas`):**
- **347** messages, from May 14 to Nov 7 2026.

**Content, inline, 3 pages:**
- 149 messages; 113 had text and 36 were attachments only (photos).
- Every message had `from` and `created_time`.

**Old messages:**
- #149 (Jul 10, «Є розмір М?») returned its text both inline and when fetched by itself.

**Manager reply typed in the Instagram app:**
- «Тест тест тест тест» (15:02 UTC) appeared as the newest message, `from: directmate_demo_shop`.

**Bot reply vs human reply:**
- History can't tell them apart: both are `from` the shop account, with no `app_id` in history.

### Separating the manager's replies from the bot's

Only human replies should become examples. History doesn't say who wrote a shop-side message, so:

- **Before the store connected DirectMate** (`connections.created_at`), shop-side messages are human. The exception is another auto-reply tool such as ManyChat, which we can't detect from history. This is the bulk of an onboarding import.
- **After connecting**, drop messages whose ID is in `instagram_sent_mids`. That table is pruned after 30 days (`pruneSentIds`), so filter before then. Message IDs from the old Instagram Login integration use a different format and won't match (*docs*, migration guide).
- **Live, no API cost:** every manager reply already arrives as an `is_echo` webhook. `handleEcho` saves it as a `manager` message and pauses the bot, as checked live on Nov 7.

## Rate limits

### Documented (*docs*)

| Limit | Value | Notes |
|---|---|---|
| Conversations API | 2 calls/sec per Instagram account | Unclear whether the messages edge counts here |
| App-level ("Platform") limit, error code **4** | 200 calls × the app's daily active users, rolling hour; also throttled when `total_cputime` / `total_time` reach 100% | Header `x-app-usage` (percentages) |
| Business Use Case limit for Instagram, error code **80002** | 4,800 × impressions per 24h, per app and account | Header `x-business-use-case-usage`, with `estimated_time_to_regain_access` in minutes. The docs say it applies to system-user tokens, yet also say messaging is excluded. Unresolved |
| Send API | 100/sec per account for text (the Instagram overview page); the rate-limiting page says 300 | The two pages disagree |
| Private replies to comments | 750/hour per account | |
| Requests folder | Threads inactive for 30 days aren't returned | From the Instagram Login docs; not checked on Unified |

Meta's best-practice notes:
- **Stop at the limit.** Calls made while limited push recovery further out.
- **Spread calls out** instead of sending bursts.
- **Request only the fields you need.**
- **Watch `x-app-usage`** to see how close the app is.

### What we observed

**Which budget each call uses:**
- **Only the messages edge** counts against the app-level budget (`x-app-usage`).
- The conversation list and plain account calls (`/{ig-id}?fields=username`) report under `x-business-use-case-usage`. They sat at **1%** and kept working while message reads were blocked.
- So sends, profile lookups and media calls are not affected by a history import.

**What a message read costs:**

| Read | `total_time` |
|---|---|
| ~20 fast calls paging one thread with `messages.limit(100){id,created_time}` | **126%**, blocked; `call_count` was only 19% |
| 3 pages of 50 with full content, plus 3 one-message calls | **21%** |
| One more 5-message read | **+3%** (24%) |

**What a block looks like:** HTTP 403, code 4, `"(#4) Application request limit reached"`, `is_transient: true`. It hit the messages edge only.

**Recovery is slow, and blocked attempts make it slower.** While polling every 10 minutes, `total_time` went 134 → 118 → 115 → 109 → **113** → **116**, rising whenever the polls continued. After the polling stopped (last call ~12:05 UTC), the next read at 14:59 UTC showed **0%**. The Mac slept in between, so the exact clear time is unknown, but it was under three hours of quiet.

**Not known yet:**
- How the budget scales in Live mode. The docs say it grows with daily active users, and a B2B app has few.
- Whether asking for fewer fields (dropping `to`, `attachments`) lowers the cost per page.

## Recommendation for the onboarding import

What the agent uses from history (`system-prompt.ts`, `store-settings.service.ts`):
- the brand tone paragraph;
- at most **8** manager examples (`MAX_MANAGER_EXAMPLES = 8`);
- store notes, which come from the owner in the interview. History only suggests facts.

So:

1. **First pass, at connect time:** the newest ~30 conversations with at least one shop-side reply, the last ~20 messages each.
   - That's ~600 messages, ~12 pages at ~7% each, so ~85% of one hour's budget.
   - At 2 calls/sec it finishes in **under a minute**. Run it while the owner does the interview.
2. **Pace by the header, not a timer.** Read `x-app-usage` after every messages call. Pause the import above ~75% `total_time`.
3. **On code 4, stop for a full hour.** Don't poll on a short timer: blocked calls kept the counter above 100%.
4. **If the first pass finds too few human replies** (a quiet store, or one where another tool replied), queue **one** top-up an hour later instead of a long job.
5. **Shadow mode fills the rest** from echo webhooks: newer, store-specific and free.
6. **Where the output goes:** `tenant_onboarding.history_import` (jsonb) already exists, and nothing writes it yet.
   - `notes-drafter.service.ts` reads `history_import->'facts'` (delivery, payment and returns statements).
   - `onboarding.service.ts` treats `history_import.applied` as "tone step done".
7. **Privacy** (`decisions.md`): keep as little raw chat as possible, redact names, phones and Nova Poshta addresses, and have the owner approve the tone profile and facts before use.

The budget is per app, shared by every store. Several stores onboarding in the same hour compete for it, so the import should be one queue for the whole app rather than one job per store.

## Open questions

- Budget scaling in Live mode, and real cost per page on a store with long threads and many photos.
- Whether the Requests-folder 30-day rule holds under Unified Login.
- How to detect replies sent by other automation tools (ManyChat and similar) in history. Possible signals are identical repeated texts and instant reply times.
- `decisions.md`, Product direction item 3, still states the 20-message cap. Update it when the import is designed.

## Sources

- Meta, "Migrate your App" to Unified Login (pasted into the session, 7 Nov 2026): host change, `/{ig-user-id}/conversations`, message ID format change.
- [Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)
- [Instagram Platform overview: rate limits](https://developers.facebook.com/documentation/instagram-platform/overview)
- [Messaging API, Instagram Login: Requests-folder rule](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)
- [Unified Login get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started) and [business onboarding](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/business-onboarding): "Allow access to messages" must be on, or messaging calls fail.
- [OpenReply issue #104](https://github.com/diwenne/openreply/issues/104): community report that `/conversations` works with the system-user token.
