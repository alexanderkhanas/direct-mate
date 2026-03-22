# Configurable Instagram AI Sales Agent

## Goal

Build an Instagram DM AI agent platform that can adapt to different types of stores through the admin panel.

The system should not be hardcoded for one niche such as beauty, fashion, or accessories.

Instead, it should provide a reusable engine where each store can configure:

* brand voice
* conversation flow
* reply templates
* checkout fields
* escalation policy
* FAQ behavior
* recommendation strategy
* manager handoff behavior

Core rule:

**The code defines the engine. The admin panel defines the store behavior.**

---

## Product Principle

The goal is not to build a “creative chatbot”.

The goal is to build a controlled AI sales assistant that:

* behaves like a real store manager
* sounds natural and brand-consistent
* automates repetitive and safe conversations
* avoids inventing facts
* escalates unclear or risky situations to a human manager

The customer should feel:

* the replies are natural
* the store responds quickly
* the conversation is comfortable
* they are being helped, not handled by a random bot

Core product principle:

**Automate routine interactions. Escalate uncertain or risky ones.**

---

## Platform Principle

This system must work for different stores, not just one specific use case.

Examples:

* cosmetics store
* fashion store
* accessories store
* home goods store
* electronics store
* gift shop
* niche local Instagram store

That means:

* business logic cannot be deeply hardcoded for one vertical
* store-specific behavior must be configuration-driven
* templates, flows, and rules must be editable in the admin panel

---

## Architecture Principle

Use a **generic conversation engine** with **store-level configuration**.

### Hardcoded in code

These parts belong in the engine and should not be freely edited by store owners:

* message pipeline
* AI understanding interface
* state machine engine
* policy evaluation engine
* template rendering engine
* variable interpolation
* anti-repetition logic
* escalation execution
* manager notification pipeline
* analytics and logging
* safety validation

### Configurable in admin panel

These parts define how a specific store behaves:

* brand tone of voice
* supported conversation scenarios
* stage configuration
* scenario transitions
* template library
* phrase blocks
* CTA style
* checkout / lead collection fields
* escalation rules
* FAQ answers
* catalog field mapping
* recommendation settings
* manager handoff settings
* fallback behavior level

Core rule:

**Hardcode the engine. Configure the behavior.**

---

## High-Level Runtime Flow

```text
incoming message
  -> AI understanding
  -> state update
  -> policy evaluation
  -> escalation check
  -> scenario selection
  -> template / block selection
  -> variable resolution
  -> anti-repetition check
  -> safety validation
  -> send reply
```

If no safe reply can be generated from configured logic:

```text
incoming message
  -> AI understanding
  -> state update
  -> policy evaluation
  -> no safe template path
  -> fallback AI generation OR escalate to manager
```

---

## What AI Should Do

AI should be used mainly for understanding, not for improvising replies.

### AI responsibilities

* detect intents
* extract entities
* detect conversation stage
* detect ambiguity
* detect negative sentiment or conflict
* recommend next action
* recommend escalation when needed

### AI should not be responsible for

* writing all replies from scratch
* inventing store policy
* inventing product details
* making risky business decisions
* improvising in sensitive cases

---

## What the Engine Should Do

The engine decides how to respond based on:

* current thread state
* AI understanding output
* store configuration
* available data from catalog / CRM / order system
* safety rules

The engine must:

* select the correct scenario
* choose the correct template or response blocks
* interpolate variables
* avoid repetition
* validate reply safety
* trigger escalation if needed

---

## Store Configuration Model

Every store should have its own config object.

Suggested top-level config structure:

```json
{
  "store_id": "store_123",
  "brand_config": {},
  "flow_config": {},
  "template_config": {},
  "checkout_config": {},
  "escalation_config": {},
  "catalog_mapping_config": {},
  "recommendation_config": {},
  "handoff_config": {},
  "faq_config": {},
  "fallback_config": {}
}
```

---

## 1. Brand Config

The store must control how the bot sounds.

Suggested fields:

```json
{
  "language": "uk",
  "address_style": "ви",
  "formality": "friendly_polite",
  "emoji_policy": {
    "enabled": true,
    "preferred": ["💛"],
    "max_per_message": 2
  },
  "message_length": "short_to_medium",
  "cta_style": "soft",
  "allowed_phrases": [
    "підкажу",
    "допоможу",
    "можу порадити"
  ],
  "disallowed_phrases": [
    "шановний клієнте",
    "ваш запит обробляється системою"
  ]
}
```

Examples:

* beauty store: warm, soft, friendly
* electronics store: concise, factual, expert
* fashion store: light, stylish, casual

---

## 2. Flow Config

The engine can support a standard set of stages, but each store should be able to configure how the flow works.

### Core engine stages

```text
greeting
need_discovery
product_discovery
showing_options
selection_help
product_selected
checkout_started
collecting_customer_info
order_confirmation
post_order_support
handoff_to_manager
```

### Store-level flow config should allow

* enabling or disabling stages
* defining allowed transitions
* customizing preferred progression
* adding optional custom stages
* controlling whether some steps are skipped

Example:

```json
{
  "enabled_stages": [
    "greeting",
    "need_discovery",
    "product_discovery",
    "showing_options",
    "selection_help",
    "checkout_started",
    "collecting_customer_info",
    "order_confirmation",
    "handoff_to_manager"
  ],
  "transitions": {
    "greeting": ["need_discovery", "handoff_to_manager"],
    "need_discovery": ["product_discovery", "handoff_to_manager"],
    "product_discovery": ["showing_options", "selection_help", "handoff_to_manager"],
    "showing_options": ["selection_help", "checkout_started", "handoff_to_manager"]
  }
}
```

Important:

* the engine owns the state machine mechanics
* the store config controls visible behavior and allowed paths

---

## 3. Scenario Config

Scenarios define how the system responds to specific conversational situations.

Suggested scenario types:

* greeting
* clarify_need
* show_products
* show_price
* show_availability
* recommend_product
* compare_products
* collect_checkout_info
* confirm_order
* answer_delivery_question
* answer_payment_question
* answer_return_policy
* out_of_stock
* complaint_handoff
* manager_handoff

Each store should be able to:

* enable or disable scenarios
* map intents to scenarios
* define preferred next actions
* attach template groups to scenarios

Example:

```json
{
  "intent_to_scenario": {
    "greeting": "greeting",
    "product_inquiry": "show_products",
    "ask_price": "show_price",
    "ask_recommendation": "recommend_product",
    "ready_to_order": "collect_checkout_info",
    "complaint": "complaint_handoff",
    "request_human": "manager_handoff"
  }
}
```

---

## 4. Template Config

Templates must be editable from the admin panel.

Each store should be able to:

* create templates
* edit templates
* disable templates
* group templates by scenario
* set priorities
* define required variables
* preview responses
* create multiple variants per scenario

Suggested template schema:

```json
{
  "id": "show_price_01",
  "scenario": "show_price",
  "stage": "product_selected",
  "goal": "move_to_checkout",
  "tone_tags": ["warm", "short"],
  "blocks": [
    "Ціна на {product_name} — {price} грн 💛",
    "Якщо хочете, можу одразу допомогти з оформленням"
  ],
  "required_variables": ["product_name", "price"],
  "optional_variables": [],
  "priority": 90,
  "active": true
}
```

### Important rules

* do not use only one template per scenario
* support multiple approved variants
* support block-based composition
* keep business logic outside the template text

---

## 5. Phrase Blocks Config

Instead of storing only full message templates, support reusable phrase blocks.

Examples:

* opener block
* recommendation block
* CTA block
* reassurance block
* escalation block

Example:

```json
{
  "id": "cta_soft_01",
  "type": "cta",
  "text": "Якщо хочете, можу одразу допомогти з оформленням 💛",
  "scenario_tags": ["show_price", "product_selected", "recommend_product"],
  "active": true
}
```

This allows more natural response variety.

---

## 6. Checkout Config

Different stores collect different information.

This must be fully configurable in the admin panel.

Examples:

* full name
* phone number
* city
* Nova Poshta branch
* size
* color
* Instagram handle
* payment method
* custom note

Suggested schema:

```json
{
  "fields": [
    {
      "key": "full_name",
      "label": "ПІБ",
      "required": true,
      "validation": "text"
    },
    {
      "key": "phone",
      "label": "Телефон",
      "required": true,
      "validation": "phone"
    },
    {
      "key": "city",
      "label": "Місто",
      "required": true,
      "validation": "text"
    },
    {
      "key": "branch",
      "label": "Відділення Нової Пошти",
      "required": true,
      "validation": "text"
    }
  ],
  "collection_style": "single_message",
  "confirmation_enabled": true
}
```

Stores should also configure:

* order of fields
* required vs optional
* whether to ask all at once or step-by-step
* confirmation message format

---

## 7. Escalation Config

Escalation policy must be configurable.

Each store should define:

* what always triggers handoff
* what triggers handoff only at low confidence
* what topics are bot-safe
* what topics are manager-only
* alert priority rules
* whether the bot sends a handoff reply before stopping

Suggested config:

```json
{
  "always_escalate_intents": [
    "complaint",
    "support_issue",
    "request_human"
  ],
  "low_confidence_threshold": 0.7,
  "escalate_on_negative_sentiment": true,
  "escalate_on_missing_critical_data": true,
  "customer_reply_template_id": "handoff_support_01",
  "manager_alert_priority": "high"
}
```

Examples of always-escalate topics:

* complaint
* return request
* exchange request
* damaged item
* payment issue
* angry customer
* explicit request for a human

---

## 8. Catalog Mapping Config

The engine should not assume all stores use the same product schema.

Each store should map its own catalog source.

Possible sources:

* Shopify
* WooCommerce
* Airtable
* Google Sheets
* CRM
* custom API
* internal DB

Suggested config:

```json
{
  "source_type": "shopify",
  "fields": {
    "product_title": "title",
    "product_price": "price",
    "product_variants": "variants",
    "inventory_status": "available",
    "product_description": "body_html"
  },
  "availability_rule": "inventory_status == true",
  "price_format": "{price} грн"
}
```

This keeps the engine generic.

---

## 9. Recommendation Config

Recommendation behavior should also be configurable.

Some stores want:

* one clear recommendation
* top 3 options
* bestsellers only
* category-first guidance
* attribute-based matching

Suggested config:

```json
{
  "mode": "single_best_match",
  "max_recommendations": 1,
  "include_reason": true,
  "use_bestsellers_boost": true,
  "attribute_priority": [
    "category",
    "skin_type",
    "size",
    "color",
    "budget"
  ]
}
```

Examples:

* beauty store: match by skin type / concern
* fashion store: match by size / color / category
* electronics store: match by budget / use case / brand

---

## 10. Handoff Config

Human handoff behavior must be configurable.

Suggested fields:

* manager notification channel
* priority mapping
* stop bot replies after handoff or not
* allow manager approval mode
* send internal summary to manager

Example:

```json
{
  "enabled": true,
  "notification_channel": "telegram",
  "pause_bot_after_handoff": true,
  "send_internal_summary": true,
  "summary_fields": [
    "last_user_message",
    "detected_intents",
    "known_entities",
    "reason_for_handoff"
  ]
}
```

---

## 11. FAQ Config

Stores should be able to maintain a FAQ / policy answer base in admin panel.

Examples:

* delivery
* payment
* return policy
* exchange policy
* business hours
* availability rules

Suggested schema:

```json
{
  "faq_items": [
    {
      "id": "delivery_01",
      "question_tags": ["delivery", "shipping"],
      "answer_template": "Відправка здійснюється {shipping_schedule} 💛",
      "active": true
    }
  ]
}
```

---

## 12. Fallback Config

Stores may want different levels of AI autonomy.

Suggested modes:

* strict_templates_only
* template_first_with_safe_fallback
* template_first_with_broad_fallback

Recommended default:

* `template_first_with_safe_fallback`

Example:

```json
{
  "mode": "template_first_with_safe_fallback",
  "max_fallback_attempts_per_thread": 2,
  "fallback_requires_high_confidence": false,
  "fallback_disallowed_intents": [
    "complaint",
    "support_issue",
    "payment_issue"
  ]
}
```

---

## Message Understanding Contract

AI should return structured data in a generic format that works across all stores.

Example:

```json
{
  "detected_intents": ["product_inquiry", "ask_price"],
  "primary_intent": "product_inquiry",
  "secondary_intents": ["ask_price"],
  "entities": {
    "product_name": null,
    "category": "сукня",
    "color": "чорна",
    "size": null,
    "skin_type": null,
    "budget": null,
    "quantity": null
  },
  "conversation_stage": "product_discovery",
  "sentiment": "neutral",
  "confidence": 0.88,
  "ambiguity_flags": [],
  "recommended_next_action": "show_matching_products"
}
```

Important:

* the schema should be generic
* store-specific behavior comes later via config
* this contract should remain stable

---

## Policy Layer

The policy layer combines:

* state
* AI output
* store config
* product / order data

And decides:

* scenario
* reply strategy
* escalation
* next step

Example policy questions:

* Is this question safe for the bot to answer?
* Do we have required product data?
* Should we ask clarification first?
* Should we recommend products or show options?
* Should we collect checkout info now?
* Should this go to a manager?

---

## Template Selection Logic

Suggested runtime logic:

```text
1. Load store config
2. Read current thread state
3. Run AI understanding
4. Update state
5. Apply escalation rules from store config
6. If escalation triggered:
   - send handoff reply
   - notify manager
   - pause bot if configured
7. Else determine scenario from:
   - stage
   - intents
   - next action
   - store flow config
8. Fetch matching templates / phrase blocks
9. Filter by:
   - active status
   - stage
   - scenario
   - available variables
   - recent usage
10. Render candidate reply
11. Run safety validation
12. Send reply
```

---

## Anti-Repetition Logic

This must be part of the engine, but stores can optionally tune it.

Minimum engine behavior:

* avoid same template twice in a row
* avoid same CTA in adjacent messages
* rotate variants
* avoid repeated greeting style in same thread

Optional store-level config:

```json
{
  "max_same_template_repeat_window": 5,
  "avoid_same_cta_in_last_messages": 2,
  "rotate_template_variants": true
}
```

---

## Safety Validation

Before sending any message:

* check all required variables are present
* check no unsupported claims are made
* check tone matches store config
* check no repetition violation
* check response length
* check escalation was not required
* check the reply matches available store data

If validation fails:

* try a simpler template
* or escalate
* or use safe fallback if allowed

---

## Screenshot Training and Admin Workflow

The onboarding system should extract store-specific communication patterns from screenshots.

But the output should not remain only as raw examples.

It should be converted into admin-editable assets:

* phrase candidates
* template candidates
* FAQ candidates
* escalation examples
* tone suggestions
* objection-handling patterns

Example extracted record:

```json
{
  "raw_phrase": "Вітаю, із задоволенням допоможу 💛",
  "normalized_template": "Вітаю, із задоволенням допоможу {optional_topic} 💛",
  "scenario": "greeting",
  "tone_tags": ["warm", "short"],
  "usage_count": 12,
  "approved": false
}
```

Admin should be able to:

* review extracted candidates
* approve or reject them
* convert them into templates
* add them into brand phrase bank

---

## Admin Panel Sections

Suggested admin panel structure:

### 1. Brand Voice

* language
* address style
* emoji settings
* tone rules
* allowed / banned phrases

### 2. Conversation Flow

* enabled stages
* scenario mapping
* flow transitions
* automation level

### 3. Templates

* template list
* create / edit / disable
* priority
* preview
* variable requirements

### 4. Phrase Blocks

* openers
* CTAs
* reassurance phrases
* escalation phrases

### 5. Checkout Settings

* fields
* validation
* order of questions
* confirmation messages

### 6. Escalation Rules

* always escalate topics
* low confidence policy
* sentiment triggers
* manager alert settings

### 7. FAQ / Policies

* delivery
* payment
* returns
* exchange
* custom answers

### 8. Catalog Mapping

* source
* field mapping
* availability rules
* price formatting

### 9. Recommendations

* strategy
* max results
* show reasons or not

### 10. Training Review

* screenshot uploads
* extracted phrases
* candidate templates
* approval workflow

### 11. Handoff Settings

* manager notifications
* pause behavior
* summary behavior

---

## Presets Strategy

Do not force stores to configure everything from scratch.

Recommended approach:

* start with a vertical preset
* then allow store-specific customization

Possible presets:

* beauty store
* fashion store
* accessories store
* home goods store
* electronics store

Preset gives:

* default stages
* default templates
* default escalation rules
* default FAQ categories
* default recommendation logic

Then admin customizes from there.

This is much better UX than giving a blank configuration panel.

---

## What Must Not Be Hardcoded Per Store

Do not hardcode in application code:

* exact checkout fields
* exact sales steps
* exact FAQs
* exact escalation topics
* exact template texts
* exact product field names
* exact recommendation rules
* exact tone of voice

These must come from configuration.

---

## What Should Stay Engine-Level

Do keep these in code:

* state machine mechanics
* AI contract
* policy evaluation order
* rendering pipeline
* safety checks
* escalation execution flow
* logging and analytics
* anti-repetition algorithm
* schema validation

These are system concerns, not store concerns.

---

## North Star

The platform should let any store launch an AI sales assistant that:

* sounds like their manager
* follows their business flow
* uses their templates
* collects their required data
* escalates according to their rules

Core target:

**Reusable engine. Store-specific behavior through configuration.**

---

## Final Principle

The system is not a single bot.

It is a configurable platform for store-specific AI sales agents.

The right mental model is:

**One engine. Many stores. Each store defines its own behavior through admin configuration.**


