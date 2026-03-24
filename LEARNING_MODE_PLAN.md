# Store-Scope Learning Mode (14-Day Observation)

## Context

When a new store connects, we want a 14-day "learning" phase where:
1. Bot receives all Instagram webhooks but **does NOT reply**
2. It stores all conversations between the real manager and customers
3. After conversations accumulate, AI analyzes them to extract: templates, phrases, voice/tone signals, conversation patterns
4. Store owner reviews extracted data in admin panel
5. Bot goes live with store-specific training

This reuses the existing screenshot training pipeline (extraction → grouping → review → apply) but with **live conversation data** instead of screenshots.

## Architecture

### Operating Modes (per store)

Add `operatingMode` to StoreConfig:

```
"learning"  — Bot silent, stores all conversations, runs periodic extraction
"active"    — Bot replies using templates + AI
"paused"    — Bot completely disabled
```

### Learning Mode Flow

```
Instagram Webhook arrives
  → Detect: is this from customer or manager?
    → Customer message: save as (inbound, user)
    → Manager reply (is_echo=true, sender=our page): save as (outbound, manager)
    → Bot's own reply (our externalMessageId): skip/ignore
  → If operatingMode === "learning": STOP here, don't call reply engine
  → If operatingMode === "active": proceed with normal flow
```

### Manager Reply Detection

Instagram sends `is_echo: true` on messages sent FROM the business account. Two cases:
- **Bot sent it**: We track `lastSentMessageIds` in memory. If `mid` matches → skip
- **Manager sent it**: `is_echo: true` but `mid` NOT in our sent list → save as `role: manager`

### Periodic Learning Extraction

A scheduled job (cron, every 24h or on-demand) that:
1. Fetches all conversations from the learning period that haven't been analyzed yet
2. Groups messages into complete conversations (customer + manager turns)
3. Sends each conversation to GPT-4o for extraction (same prompt as screenshot pipeline):
   - Good phrases, avoid phrases
   - Voice signals (tone, empathy, formality)
   - Scenario classification
   - Template suggestions
4. Stores results in `extracted_conversation_fragments`, `extracted_phrases`, `extracted_voice_signals`
5. Store owner reviews in the existing Training UI

### What Changes vs Screenshot Pipeline

The screenshot pipeline extracts from **images** (GPT-4o vision). The learning pipeline extracts from **text conversations** already stored in our DB. Same output format, same review flow, same approval → manager_examples conversion.

The only difference: input is structured text (from `messages` table), not images.

## Files to Modify

### 1. `apps/api/src/modules/engine/entities/store-config.entity.ts`
- No schema change needed — `flowConfig` jsonb already supports arbitrary fields
- Add `operatingMode` to `flowConfig`: `{ operatingMode: "learning" | "active" | "paused" }`

### 2. `apps/api/src/modules/channels/instagram/instagram.service.ts`
- Add `is_echo` detection in `handleWebhook()`
- Track sent message IDs (in-memory Set, keyed by conversationId)
- When `is_echo` + not our message → save as `role: manager`
- Check `operatingMode` before calling `processInbound()` — if "learning", just save message and return

### 3. New: `apps/api/src/modules/screenshot-training/conversation-learning.service.ts`
- `extractFromConversations(tenantId)` — fetches unanalyzed conversations, sends to GPT-4o (text, not vision), stores results in same tables as screenshot pipeline
- Reuses `ExtractedConversationFragment`, `ExtractedPhrase`, `ExtractedVoiceSignal` entities
- Creates a `ScreenshotImportJob` record (rename conceptually to "ImportJob") to track the extraction batch

### 4. `apps/api/src/modules/engine/store-config.controller.ts`
- Add `PATCH /engine/config/mode` endpoint to switch operating mode
- Validate transitions: learning → active (only if templates exist), active → paused, etc.

### 5. Admin panel: `apps/admin/src/pages/SettingsPage.tsx`
- Add operating mode selector: Learning / Active / Paused
- Show learning progress: "Day 8/14 — 47 conversations captured, 23 analyzed"
- "Finish Learning & Go Live" button

### 6. Migration
- No new tables needed — reuses existing `messages`, `extracted_*` tables
- Add a `source` column to `extracted_conversation_fragments`: `'screenshot' | 'live_observation'`
- Add `analyzed_at` column to `conversations` to track which ones have been processed

## Key Design Decisions

1. **No new tables** — reuse existing extraction pipeline tables
2. **Same review flow** — store owner reviews in Training tab (same UI for screenshots and live observations)
3. **Same output** — extracted phrases, voice signals, manager examples — all go to the same place
4. **Gradual transition** — store can be in "learning" for 14 days, then owner reviews and switches to "active"
5. **Manager replies saved with `role: manager`** — distinguishable from bot replies (`role: assistant`)
6. **Text extraction uses GPT-4o-mini** (cheaper than vision) — we already have structured text, no need for vision model

## Verification

1. Connect a test store in "learning" mode
2. Send messages from customer account → messages saved, no bot reply
3. Manager replies in Instagram → detected via `is_echo`, saved as `role: manager`
4. Run extraction → fragments, phrases, signals created
5. Review in Training tab → approve → manager examples created
6. Switch to "active" mode → bot starts replying using extracted templates
