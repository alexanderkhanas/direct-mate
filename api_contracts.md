# API Contracts

## Purpose
This document defines the initial API contracts for the MVP backend.
The backend is the product brain. It owns business rules, availability logic,
conversation state, reservations, draft orders, and admin-facing data.

## Principles
- Keep the first version REST-based.
- Use JSON request/response bodies.
- All timestamps are ISO 8601 in UTC.
- Every write endpoint must be idempotent where possible.
- AI responses must never bypass availability checks.
- n8n may call these endpoints, but core product logic stays in the backend.

---

## Auth

### Admin Auth
Used by the admin panel.

#### POST /auth/login
Request:
```json
{
  "email": "owner@store.com",
  "password": "string"
}
```

Response:
```json
{
  "accessToken": "jwt_or_session_token",
  "user": {
    "id": "usr_123",
    "email": "owner@store.com",
    "role": "owner",
    "tenantId": "ten_123"
  }
}
```

#### POST /auth/logout
Response:
```json
{
  "success": true
}
```

#### GET /auth/me
Response:
```json
{
  "id": "usr_123",
  "email": "owner@store.com",
  "role": "owner",
  "tenantId": "ten_123"
}
```

---

## Channel Connections

### GET /connections
Returns all active integrations for a tenant.

Response:
```json
{
  "items": [
    {
      "id": "conn_1",
      "type": "instagram",
      "status": "connected",
      "lastSyncAt": "2026-03-20T11:00:00Z"
    },
    {
      "id": "conn_2",
      "type": "keycrm",
      "status": "connected",
      "lastSyncAt": "2026-03-20T10:58:00Z"
    }
  ]
}
```

### POST /connections/instagram/callback
Used during OAuth/business login callback.

Request:
```json
{
  "code": "oauth_code",
  "state": "tenant_state"
}
```

Response:
```json
{
  "success": true,
  "connectionId": "conn_1"
}
```

### POST /connections/:id/disconnect
Response:
```json
{
  "success": true
}
```

---

## Instagram Webhooks

### POST /channels/instagram/webhook
Receives inbound events from Meta.
This endpoint should acknowledge quickly and offload heavier work.

Request:
```json
{
  "object": "instagram",
  "entry": []
}
```

Response:
```json
{
  "received": true
}
```

### GET /channels/instagram/webhook
Webhook verification endpoint.

Query:
- hub.mode
- hub.verify_token
- hub.challenge

Response:
- raw challenge value if verification succeeds

---

## Conversations

### POST /conversation/reply
Main orchestration endpoint.
Called by the inbound workflow after receiving a message.
This endpoint decides whether to:
- answer automatically,
- request more information,
- create a reservation,
- start checkout,
- escalate to a human.

Request:
```json
{
  "tenantId": "ten_123",
  "channel": "instagram",
  "channelAccountId": "ig_acc_123",
  "externalUserId": "ig_user_789",
  "messageId": "mid_123",
  "messageText": "Do you have this dress in M?",
  "messageTimestamp": "2026-03-20T11:10:00Z"
}
```

Response:
```json
{
  "conversationId": "conv_123",
  "decision": "reply",
  "reply": {
    "text": "Yes, the black Luna dress in size M is currently available.",
    "sendNow": true
  },
  "handoff": {
    "required": false,
    "reason": null
  },
  "state": {
    "status": "stock_confirmed",
    "selectedProductId": "prod_1",
    "selectedVariantId": "var_1"
  }
}
```

Possible `decision` values:
- `reply`
- `ask_followup`
- `handoff`
- `create_draft_order`
- `noop`

### GET /conversations
Query params:
- status
- needsHandoff
- page
- limit

Response:
```json
{
  "items": [
    {
      "id": "conv_123",
      "customerName": "Anna",
      "channel": "instagram",
      "status": "active",
      "needsHandoff": false,
      "lastMessageAt": "2026-03-20T11:12:00Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

### GET /conversations/:id
Response:
```json
{
  "id": "conv_123",
  "status": "active",
  "customer": {
    "id": "cust_1",
    "externalUserId": "ig_user_789",
    "username": "anna_style"
  },
  "messages": [
    {
      "id": "msg_1",
      "direction": "inbound",
      "role": "user",
      "text": "Do you have this dress in M?",
      "createdAt": "2026-03-20T11:10:00Z"
    },
    {
      "id": "msg_2",
      "direction": "outbound",
      "role": "assistant",
      "text": "Yes, the black Luna dress in size M is currently available.",
      "createdAt": "2026-03-20T11:10:02Z"
    }
  ],
  "state": {
    "status": "stock_confirmed",
    "selectedProductId": "prod_1",
    "selectedVariantId": "var_1"
  }
}
```

### POST /conversations/:id/takeover
Marks the conversation as manually handled.

Request:
```json
{
  "managerUserId": "usr_manager_1"
}
```

Response:
```json
{
  "success": true,
  "status": "human_in_control"
}
```

---

## Availability

### POST /availability/check
Deterministic availability lookup.
This endpoint must never rely on AI memory.

Request:
```json
{
  "tenantId": "ten_123",
  "query": "Luna dress",
  "size": "M",
  "color": "black"
}
```

Response:
```json
{
  "matchType": "exact",
  "product": {
    "id": "prod_1",
    "title": "Luna Dress"
  },
  "variant": {
    "id": "var_1",
    "sku": "LUNA-BLK-M",
    "size": "M",
    "color": "black",
    "price": 1890,
    "currency": "UAH"
  },
  "stock": {
    "availableQty": 2,
    "reservedQty": 0,
    "pendingCheckoutQty": 1,
    "effectiveAvailable": 1,
    "lastSyncedAt": "2026-03-20T11:08:00Z",
    "isFresh": true
  }
}
```

### GET /products/search
Query params:
- q
- size
- color
- limit

Response:
```json
{
  "items": [
    {
      "productId": "prod_1",
      "variantId": "var_1",
      "title": "Luna Dress",
      "size": "M",
      "color": "black",
      "price": 1890,
      "effectiveAvailable": 1
    }
  ]
}
```

---

## Reservations

### POST /reservations
Creates a short-lived soft reservation.

Request:
```json
{
  "tenantId": "ten_123",
  "conversationId": "conv_123",
  "customerId": "cust_1",
  "variantId": "var_1",
  "qty": 1,
  "ttlMinutes": 20
}
```

Response:
```json
{
  "id": "res_123",
  "status": "active",
  "expiresAt": "2026-03-20T11:35:00Z"
}
```

### POST /reservations/:id/cancel
Response:
```json
{
  "success": true,
  "status": "cancelled"
}
```

---

## Checkout and Orders

### POST /checkout/start
Starts the checkout flow for a selected variant.

Request:
```json
{
  "conversationId": "conv_123",
  "customerId": "cust_1",
  "variantId": "var_1",
  "qty": 1
}
```

Response:
```json
{
  "checkoutSessionId": "chk_123",
  "status": "collecting_customer_info"
}
```

### PATCH /checkout/:id/customer-info
Request:
```json
{
  "fullName": "Anna Ivanenko",
  "phone": "+380991112233",
  "city": "Lviv",
  "deliveryProvider": "nova_poshta",
  "branch": "Branch 12",
  "paymentMethod": "cod"
}
```

Response:
```json
{
  "checkoutSessionId": "chk_123",
  "status": "ready_for_draft_order"
}
```

### POST /orders/draft
Creates a draft order after validation.

Request:
```json
{
  "checkoutSessionId": "chk_123"
}
```

Response:
```json
{
  "draftOrderId": "ord_123",
  "status": "awaiting_manager_confirmation"
}
```

### GET /orders
Response:
```json
{
  "items": [
    {
      "id": "ord_123",
      "status": "awaiting_manager_confirmation",
      "customerName": "Anna Ivanenko",
      "totalAmount": 1890,
      "createdAt": "2026-03-20T11:20:00Z"
    }
  ]
}
```

---

## Admin Settings

### GET /settings
Response:
```json
{
  "brandTone": "Warm, concise, manager-like",
  "supportedLanguages": ["uk", "en", "ru"],
  "businessHours": {
    "timezone": "Europe/Kyiv",
    "days": [1,2,3,4,5,6],
    "start": "09:00",
    "end": "20:00"
  },
  "handoffRules": {
    "maxFailedTurns": 2,
    "stockFreshnessMinutes": 10,
    "negativeSentimentEscalation": true
  }
}
```

### PATCH /settings
Request:
```json
{
  "brandTone": "Friendly, premium, concise",
  "handoffRules": {
    "maxFailedTurns": 2,
    "stockFreshnessMinutes": 10,
    "negativeSentimentEscalation": true
  }
}
```

Response:
```json
{
  "success": true
}
```

---

## Audit and Logs

### GET /logs/conversation/:id
Response:
```json
{
  "items": [
    {
      "id": "log_1",
      "type": "availability_check",
      "status": "success",
      "details": {
        "variantId": "var_1",
        "effectiveAvailable": 1
      },
      "createdAt": "2026-03-20T11:10:01Z"
    },
    {
      "id": "log_2",
      "type": "ai_decision",
      "status": "success",
      "details": {
        "decision": "reply"
      },
      "createdAt": "2026-03-20T11:10:02Z"
    }
  ]
}
```

---

## Integration Sync Endpoints

These are internal endpoints for n8n or scheduled workers.

### POST /internal/sync/catalog
Request:
```json
{
  "tenantId": "ten_123",
  "source": "keycrm",
  "mode": "full"
}
```

Response:
```json
{
  "jobId": "job_123",
  "accepted": true
}
```

### POST /internal/sync/stock
Request:
```json
{
  "tenantId": "ten_123",
  "source": "keycrm",
  "mode": "incremental"
}
```

Response:
```json
{
  "jobId": "job_124",
  "accepted": true
}
```

---

## Error Shape

All non-2xx responses should follow one shape.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Phone number is required",
    "details": {
      "field": "phone"
    }
  }
}
```

Suggested error codes:
- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `STALE_STOCK_DATA`
- `OUT_OF_STOCK`
- `HANDOFF_REQUIRED`
- `INTEGRATION_ERROR`
- `RATE_LIMITED`

---

## Notes for Implementation
- Start with REST + Swagger in NestJS.
- Keep DTOs explicit and versionable.
- Avoid leaking raw CRM payloads to the admin UI.
- Normalize all channel events before core processing.
- Add webhook signature verification where supported.
- Use idempotency keys for webhook and order-related flows.
