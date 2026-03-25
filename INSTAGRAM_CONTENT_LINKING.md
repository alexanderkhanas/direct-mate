# Plan: Instagram Content-to-Product Linking

## Context

When a customer replies to a story or shares a post asking about a product, the bot has no way to know which product they mean. The webhook payload contains media IDs but they're currently ignored. We need to:
1. Parse media references from webhook payloads
2. Maintain a mapping table linking Instagram media IDs to products
3. Populate mappings via bulk import, SKU matching, and admin UI
4. Use the mapping in the reply engine to auto-resolve product context

## Current State

- Webhook handler extracts only `message.text` and `message.mid` — ignores attachments, reply_to, referral
- `messages.raw_payload` field exists but is never populated
- `product_media` table has `url` and `color` but no Instagram media ID
- Products have `externalProductId` (Shopify ID) and variants have `sku`
- Instagram access token stored encrypted in `connections` table

## Architecture

### New table: `instagram_media_mappings`

```sql
CREATE TABLE instagram_media_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instagram_media_id text NOT NULL,        -- IG media ID from Graph API or webhook
  media_type text NOT NULL DEFAULT 'post', -- post, story, highlight, carousel_item
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  caption text,                            -- cached caption text
  media_url text,                          -- cached image URL (may expire for stories)
  permalink text,                          -- permanent link (posts/highlights only)
  match_method text,                       -- sku_from_caption, ai_suggested, manual, bulk_import
  match_confidence real,                   -- 0-1 for AI matches
  confirmed boolean NOT NULL DEFAULT false, -- human-confirmed match
  expires_at timestamptz,                  -- for stories (24h TTL)
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_media_mappings_tenant_media ON instagram_media_mappings(tenant_id, instagram_media_id);
CREATE INDEX idx_media_mappings_product ON instagram_media_mappings(product_id);
```

### Webhook payload extraction

**File:** `apps/api/src/modules/channels/instagram/instagram.service.ts`

Extract from webhook `messaging` object:
- `message.reply_to.mid` → story/post reply reference
- `message.reply_to.story.id` → story media ID (story replies)
- `message.attachments[].payload.url` → shared media URL
- `message.referral` → carousel/ad referral with media product ID

When a media reference is found:
1. Look up `instagram_media_mappings` by the media ID
2. If found + has `product_id` → inject into reply engine as `productContext`
3. If not found → **silent handoff to human manager** (store the media ID as unlinked for later linking)
4. If customer sends a standalone photo/image → **silent handoff** (bot cannot process images)

**Critical rule:** Never ask for clarification about media. Never reveal the bot can't handle something. All low-confidence or unresolvable media cases → silent handoff via existing mechanism. The customer should never know they are talking to a bot.

Also: populate `messages.raw_payload` with the full webhook JSON for audit.

### Content fetching service

**New file:** `apps/api/src/modules/channels/instagram/instagram-content.service.ts`

Methods:
- `fetchPosts(connectionId)` → GET `/me/media?fields=id,caption,media_type,permalink,timestamp` (paginated)
- `fetchHighlights(connectionId)` → GET `/me/highlights` → GET `/{highlight-id}/media?fields=id,caption,media_url,permalink`
- `fetchActiveStories(connectionId)` → GET `/me/stories?fields=id,caption,media_url,timestamp`
- `matchCaptionToProduct(caption, tenantId)` → extract SKU or use AI to suggest product match

### Content import flow

**Onboarding bulk import:**
1. Fetch all posts + highlights via Graph API
2. For each: extract caption, check for SKU pattern in caption
3. If SKU matches a product variant → auto-link with `match_method='sku_from_caption'`, `confirmed=false`
4. If no SKU → use GPT to match caption text against product catalog → `match_method='ai_suggested'`, `match_confidence=0.x`
5. Present all matches in admin UI for confirmation

**Periodic story fetch (cron):**
- Every 4 hours, fetch active stories
- Store in mappings with `expires_at = now() + 24h`
- The mapping persists even after story expires (storyId from webhook still resolves)

**SKU pattern matching:**
- Configurable per tenant in `store_configs.brand_config`
- Default pattern: look for `#SKU_xxx` or `Артикул: xxx` in caption
- Match against `product_variants.sku`

### Reply engine integration

**File:** `apps/api/src/modules/conversations/reply-engine.service.ts`

Before classification, check if the inbound message has a media reference:
```typescript
if (mediaReference) {
  const mapping = await this.mediaService.findByMediaId(tenantId, mediaReference.mediaId);
  if (mapping?.productId) {
    // Inject product into classification context
    // Skip product search — we already know which product
    productData = await this.availabilityService.checkByProductId(mapping.productId);
  }
}
```

This means when a customer replies to a story about "Silk Color Помада", the bot immediately knows which product and can show price/variants without asking.

If no mapping found → silent handoff:
```typescript
if (mediaReference && !mapping?.productId) {
  // Unknown media — hand off silently, don't ask for clarification
  return this.doHandoff(input, 'unlinked_media_reference', 'Секунду, зараз перевірю 💛');
}
```

### Admin UI

**New section in Connections page or separate page: "Content Linking"**

- Table of fetched Instagram content with: thumbnail, caption, linked product (or "Unlinked")
- Filter by: linked/unlinked, type (post/story/highlight), date
- Click to link: dropdown of products, or accept AI suggestion
- Bulk actions: confirm all AI suggestions above X confidence
- "Fetch new content" button triggers bulk import

### API endpoints

```
POST   /internal/instagram/fetch-content     — trigger bulk fetch (cron or manual)
GET    /instagram/media-mappings             — list mappings for tenant
PATCH  /instagram/media-mappings/:id         — update mapping (link product, confirm)
DELETE /instagram/media-mappings/:id         — remove mapping
POST   /instagram/media-mappings/bulk-confirm — confirm all AI suggestions above threshold
```

## Files to create/modify

### New files
- `apps/api/src/database/migrations/1715000000000-InstagramMediaMappings.ts`
- `apps/api/src/modules/channels/instagram/entities/instagram-media-mapping.entity.ts`
- `apps/api/src/modules/channels/instagram/instagram-content.service.ts`
- `apps/api/src/modules/channels/instagram/instagram-content.controller.ts`
- `apps/admin/src/pages/ContentLinkingPage.tsx` (or section in ConnectionsPage)

### Modified files
- `apps/api/src/modules/channels/instagram/instagram.service.ts` — extract media references from webhook, populate raw_payload
- `apps/api/src/modules/channels/channels.module.ts` — register new service/controller/entity
- `apps/api/src/modules/conversations/reply-engine.service.ts` — check media mapping before product search
- `apps/admin/src/App.tsx` — add route
- `apps/admin/src/components/Layout.tsx` — add nav item

## Implementation order

1. **Migration + entity** — create `instagram_media_mappings` table
2. **Webhook extraction** — parse media references, populate `raw_payload`
3. **Media mapping lookup** — lookup in reply engine, inject product context
4. **Content fetch service** — Graph API calls for posts/highlights/stories
5. **SKU matching** — caption parsing + product catalog matching
6. **Admin UI** — content linking page with confirm/link actions
7. **Cron job** — periodic story fetch (@nestjs/schedule)
8. **AI-assisted matching** — GPT caption-to-product suggestion

## Verification

1. Reply to a story in Instagram → bot should resolve product from mapping
2. Share a post → bot should resolve product
3. Unlinked media → silent handoff to manager (customer sees "Секунду, зараз перевірю 💛")
4. Customer sends a photo → silent handoff (not "I can't process images")
5. Admin UI shows fetched content with link/unlink actions
5. SKU in caption auto-links to correct product
6. E2E tests still pass (25/25)
