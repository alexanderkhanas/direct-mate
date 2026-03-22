# AI Instagram Assistant — Project Overview

## 1. Product Summary

AI Instagram Assistant is a product that helps Instagram-first businesses automatically handle inbound direct messages using real business availability.

The first MVP is focused on fashion stores, where the assistant can:
- read inbound Instagram DMs,
- understand customer intent,
- check real product availability,
- answer in a manager-like tone,
- collect order details,
- create a draft order or hand the conversation to a human.

The long-term product direction can later expand into service businesses such as barbershops, beauty salons, clinics, and other appointment-based businesses by replacing inventory availability with time-slot availability.

## 2. Core Product Idea

The product is not a classic chatbot.

It is an AI-assisted sales and support layer that sits on top of the client's existing systems:
- Instagram account,
- CRM / e-commerce platform / booking system,
- product or service availability,
- human team for escalations.

The key principle is:

> AI handles routine inbound conversations, but factual business data must come from deterministic system checks.

For fashion stores, that means stock, price, and variant data must come from the source of truth.
For service businesses, that means slot availability must come from the booking source of truth.

## 3. Initial Target Market

### Primary MVP vertical
Fashion / apparel stores that actively sell through Instagram DMs.

### Ideal pilot client profile
A good first pilot client should have:
- an active Instagram account,
- a meaningful volume of inbound DMs,
- at least some structured product/stock data,
- an owner or manager who is motivated to automate,
- a real pain point around slow replies, missed leads, or overloaded staff.

### Example systems a pilot client may already use
- KeyCRM
- KeepinCRM
- SalesDrive
- Shopify
- WooCommerce
- Horoshop / Cartum
- spreadsheets / CSV/XLSX exports in legacy cases

## 4. Problem Statement

Instagram-based businesses often rely on manual messaging for:
- stock questions,
- size and color questions,
- price questions,
- delivery questions,
- booking requests,
- order confirmation.

This creates several problems:
- delayed replies,
- missed sales,
- manager overload,
- inconsistent tone of voice,
- no 24/7 handling,
- poor lead follow-up,
- expensive scaling through additional staff.

## 5. Product Value Proposition

### For the business
- faster first response time,
- more DMs handled automatically,
- less routine work for managers,
- fewer missed leads,
- consistent brand tone,
- better scaling without immediately hiring additional staff.

### For the team
- managers focus only on non-standard, high-value, or risky cases,
- repetitive questions are handled automatically,
- conversations remain logged and structured,
- draft orders / escalations are cleaner.

## 6. What Makes the Product Different

This product should not behave like a generic chatbot.

Its differentiation comes from three things:
1. real business availability,
2. memory of prior conversation context,
3. replication of a real manager's communication style.

That means the assistant should not guess facts.
It should call tools or backend services to check:
- product availability,
- variant-level stock,
- price,
- booking availability,
- business rules.

## 7. MVP Scope

The first MVP should support:
- one pilot client,
- one Instagram account,
- one primary channel: inbound Instagram DMs,
- one main business vertical: fashion store,
- one source of truth for products and stock,
- human handoff for uncertain or high-risk cases.

### Included in MVP
- inbound Instagram DM processing,
- conversation state tracking,
- product search,
- stock check,
- manager-style response generation,
- order-intent detection,
- draft order flow,
- escalation / handoff,
- admin panel for visibility and control,
- sync of products and stock from the client system.

### Out of scope for initial MVP
- outbound cold messaging,
- advanced campaign automation,
- full CRM replacement,
- payments inside chat,
- automatic shipping label creation,
- heavy analytics,
- multi-tenant self-serve onboarding,
- multi-product complex cart logic,
- deep multilingual localization beyond basic support.

## 8. High-Level User Flows

### A. Product inquiry flow
1. Customer sends a DM.
2. System reads the message.
3. AI identifies product-related intent.
4. Backend checks availability.
5. AI responds in brand tone.
6. If needed, AI asks clarifying questions.
7. If uncertainty is too high, handoff is triggered.

### B. Order intent flow
1. Customer selects a specific product/variant.
2. System re-checks stock.
3. System creates a short reservation if supported.
4. AI collects delivery/order details.
5. System creates a draft order.
6. Manager confirms or continues manually if needed.

### C. Handoff flow
1. AI detects that the case is risky or ambiguous.
2. Conversation is marked for human attention.
3. Manager receives notification.
4. Manager continues from admin panel or external ops channel.

## 9. Product Principles

### Principle 1: AI is not the source of truth
AI generates language, not facts.

### Principle 2: Deterministic data first
Stock, variants, slots, and order state come from backend logic.

### Principle 3: Human only when necessary
The system should minimize team effort, but not remove human control where risk is high.

### Principle 4: Build around real client data
Do not force clients into a new CRM if their existing system already contains usable operational data.

### Principle 5: Service-led before pure SaaS
The first phase is an implementation-led product with reusable components.
Over time, repeated logic can be standardized into a true SaaS platform.

## 10. Business Model Direction

### Early phase
- setup / integration fee,
- monthly subscription,
- possible founder / pilot pricing.

### Suggested subscription framing
- Basic: small business / one account / low volume,
- Standard: more conversations / more customization,
- Pro: higher volume / more complexity / priority support.

### Why setup fee matters
The product requires real integration work:
- Instagram connection,
- CRM / stock source connection,
- business rule setup,
- tone calibration,
- testing.

## 11. Expansion Path

After proving the product in fashion, the same product architecture can support service businesses.

### Fashion availability model
Availability = inventory / variants / stock.

### Service business availability model
Availability = time slots / staff calendars / booking windows.

This suggests a future platform architecture around:
- conversation engine,
- business availability adapter,
- brand tone layer,
- escalation engine,
- admin interface.

## 12. Success Metrics for MVP

The MVP should be judged by real operational value, not only by technical completion.

Suggested early metrics:
- average first response time,
- percentage of conversations handled automatically,
- handoff rate,
- false answer incidents,
- number of draft orders created,
- manager time saved,
- conversion from conversation to order.

## 13. Recommended Positioning

A strong simple positioning statement:

> AI Instagram sales assistant for fashion stores that replies using real stock data and hands off only when needed.

A broader future positioning statement:

> AI assistant for Instagram-first businesses that responds using real business availability.
