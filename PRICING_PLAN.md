# DirectMate — Pricing Plans

## Context
AI costs are ~$2-12/month per store (negligible). Pricing should be based on **value delivered** (conversations automated, time saved), not token consumption.

## Proposed Plans

### Free Trial — 14 days
- Full access to all features
- No credit card required
- Includes learning mode (AI observes manager conversations)
- Up to 1 Instagram account
- All templates and training features available
- Goal: store sees the value before paying

### Starter — $99/month
**For:** Small Instagram stores, 1 manager, moderate DM volume

| Feature | Limit |
|---------|-------|
| Instagram accounts | 1 |
| Automated conversations/month | 500 |
| Product catalog size | Up to 200 products |
| Store connections | 1 (Shopify OR OpenCart) |
| Screenshot training uploads | 50/month |
| Template library | Full access |
| Conversation history | 30 days |
| Manager handoff notifications | Telegram |
| Support | Email |

### Professional — $199/month
**For:** Active stores, multiple managers, high DM volume

| Feature | Limit |
|---------|-------|
| Instagram accounts | 3 |
| Automated conversations/month | 2,000 |
| Product catalog size | Up to 1,000 products |
| Store connections | 2 (Shopify + OpenCart) |
| Screenshot training uploads | 200/month |
| Template library | Full access + custom scenarios |
| Conversation history | 90 days |
| Manager handoff notifications | Telegram + in-app |
| Analytics dashboard | Full |
| Priority support | Chat |

### Business — $399/month
**For:** Large stores, agencies, multiple brands

| Feature | Limit |
|---------|-------|
| Instagram accounts | 10 |
| Automated conversations/month | Unlimited |
| Product catalog size | Unlimited |
| Store connections | Unlimited |
| Screenshot training uploads | Unlimited |
| Template library | Full + AI-generated templates |
| Conversation history | 1 year |
| Multi-user access | Up to 5 team members |
| Custom onboarding | Included |
| API access | For custom integrations |
| Dedicated support | Slack channel |

## What plans depend on (differentiation axes)

1. **Conversation volume** — main differentiator. Small stores = 100-500/month, active = 1000-2000, large = 5000+
2. **Instagram accounts** — multi-brand stores need several
3. **Store connections** — some stores use both Shopify and OpenCart
4. **Conversation history retention** — how far back they can view/analyze
5. **Training capacity** — screenshot uploads, custom scenarios
6. **Team access** — managers who can review conversations
7. **Analytics depth** — basic metrics vs full funnel analysis

## What should NOT be limited by plan

- **AI quality** — same model for all plans (no "dumber AI" on cheaper plan)
- **Template count** — all plans get full template library
- **Handoff notifications** — all plans get Telegram notifications
- **Response speed** — no artificial delays on cheaper plans

## Cost structure for us

| Plan | Revenue | AI cost | Infra cost | Margin |
|------|---------|---------|------------|--------|
| Starter ($99) | $99 | ~$3-5 | ~$5 | ~$89 (90%) |
| Professional ($199) | $199 | ~$8-15 | ~$10 | ~$174 (87%) |
| Business ($399) | $399 | ~$15-30 | ~$20 | ~$349 (87%) |

Margins are excellent because AI costs are low and infrastructure is shared (VPS with Docker).

## Overage handling

When a store exceeds their plan's conversation limit:
- **Soft limit** — bot continues working, store gets a notification
- **At 120%** — email warning, upgrade suggestion
- **At 150%** — conversations still work but analytics limited
- **Never hard-block** — don't lose sales for the store

## Implementation notes

- Billing: LiqPay (Ukrainian market) or Stripe (international)
- Plan tracking: `tenant_plans` table with `plan_type`, `conversation_limit`, `expires_at`
- Usage tracking: count conversations per month per tenant
- Trial: auto-created on registration, 14 days, full Professional features
