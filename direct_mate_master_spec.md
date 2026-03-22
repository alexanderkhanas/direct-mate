# Direct Mate — Master Product Specification


---

# Project: Onboarding and Screenshot-First AI Training Flow

# Direct Mate — Onboarding and Screenshot-First AI Training Flow

## Purpose

This document defines the onboarding and AI training flow for new client stores, with a mandatory focus on **Instagram conversation screenshots**.

The product must support onboarding **before the bot is connected** to the client's Instagram account.

The primary idea is:

- the client uploads screenshots of real Instagram conversations
- AI extracts structured knowledge from those screenshots
- Direct Mate turns that knowledge into reusable training assets:
  - brand voice profile
  - good phrases
  - phrases to avoid
  - scenario examples
  - example conversation fragments
  - escalation signals
  - selling style patterns

This screenshot-based learning flow is **mandatory** in the onboarding experience.

---

## Core Principle

Before launch, the best available source of truth about how a business talks to customers is often:

**real Instagram DM screenshots**

Direct Mate should treat screenshots as a structured onboarding input, not just a file upload.

The system should use AI to transform screenshots into reviewable, editable data.

---

## High-Level Flow

### Phase 1 — Screenshot-first onboarding
The client uploads screenshots of real Instagram conversations.

AI extracts:
- conversation turns
- customer questions
- manager replies
- recurring sales patterns
- business voice characteristics
- useful phrases
- common conversation scenarios
- escalation cases

The client reviews and approves the extracted knowledge.

### Phase 2 — Structured profile generation
Based on extracted screenshot data, the system builds:
- brand voice settings
- approved phrases
- scenario examples
- initial training library

### Phase 3 — Launch
The assistant is connected to Instagram and starts handling live messages.

### Phase 4 — Post-launch learning
The client continues improving the assistant using live conversations.

---

## What AI Should Extract from Screenshots

The system should extract and propose the following fields.

### 1. Brand voice signals
- tone of voice
- warmth level
- formality level
- emoji usage
- response length style
- consultative vs direct style
- upsell tendency
- reassurance style
- apology style

### 2. Good phrases
Examples:
- greeting phrases
- recommendation phrases
- soft close phrases
- out-of-stock phrases
- checkout-start phrases
- handoff phrases

### 3. Phrases to avoid
Examples:
- robotic phrasing
- harsh replies
- overly formal wording
- weak or confusing phrases

### 4. Scenario examples
Examples:
- greeting
- product recommendation
- showing available options
- clarifying preference
- out of stock
- offering alternatives
- delivery/payment explanation
- start checkout
- handoff to manager
- complaint handling
- ambiguous short user reply

### 5. Conversation fragments
Short multi-turn examples that show:
- customer message(s)
- manager response
- optional context

### 6. Business behavior signals
- whether the store pushes recommendations
- whether it asks follow-up questions
- whether it tries to narrow the choice
- whether it moves quickly to order capture
- when it escalates to a human

### 7. Escalation signals
Examples:
- discount request
- complaint
- unclear customer intent
- custom order
- manager request
- emotionally difficult message

---

## Onboarding UX

## Step 1 — Screenshot Upload

### Goal
Collect real examples of how the store communicates.

### Requirements
- support multiple screenshot uploads
- allow batch upload
- show upload progress
- support drag and drop
- mark uploads as pending extraction

### Recommended UI copy
- Upload Instagram conversation screenshots
- We will extract brand voice and training examples from them
- You will be able to review everything before launch

### MVP recommendation
Require at least:
- 5 screenshots minimum
- recommended: 15–30 screenshots

---

## Step 2 — AI Extraction Pipeline

### Goal
Turn screenshots into structured draft knowledge.

### Pipeline
1. upload screenshot
2. OCR / visual text extraction
3. identify speaker turns
4. normalize conversation text
5. cluster by scenario
6. extract phrases
7. infer voice characteristics
8. generate structured draft outputs
9. send to review queue

### Outputs
- extracted conversation transcript
- proposed scenario
- candidate good reply
- candidate good phrase(s)
- candidate bad phrase(s)
- voice observations
- approval status = draft

### Important rule
No extracted data should become active training data without user review.

---

## Step 3 — Review Extracted Conversations

### Goal
Allow the client to validate and clean extracted content.

### UI
A review table or queue with:
- screenshot preview
- extracted text
- detected speaker turns
- scenario suggestion
- proposed useful example
- approve / edit / reject actions

### Actions
- approve transcript
- edit transcript
- mark customer and manager turns
- split long conversation into smaller examples
- reject noisy extraction

### Why this matters
Screenshot extraction will never be perfect, so review is mandatory.

---

## Step 4 — Generate Structured Training Assets

After review, AI should propose structured assets.

### Asset A — Brand Voice Draft
Proposed fields:
- tone = warm / friendly / premium / expert / playful
- formality = formal / informal
- emoji usage = none / light / moderate
- answer length = short / balanced / consultative
- sales style = soft / balanced / proactive

### Asset B — Good Phrases Library
Grouped by:
- greeting
- recommendation
- clarification
- alternative offer
- checkout start
- reassurance
- handoff

### Asset C — Phrases to Avoid
Grouped by:
- robotic
- too formal
- too vague
- too pushy
- not brand-aligned

### Asset D — Scenario Examples
Each example should include:
- scenario
- customer context message(s)
- final manager reply
- tags
- source = screenshot_import
- approved flag

### Asset E — Escalation Rules Suggestions
Examples:
- handoff when customer asks for manager
- handoff when customer complains
- handoff when product is unclear
- handoff when discount negotiation starts

---

## Step 5 — Client Review and Approval

### Goal
Convert draft extracted assets into approved onboarding knowledge.

### Review sections
- Brand Voice
- Good Phrases
- Avoid Phrases
- Scenario Examples
- Escalation Suggestions

### Actions
- approve
- edit
- reject
- merge duplicates
- save to profile

### Result
The reviewed outputs become the initial training base for the assistant.

---

## Step 6 — Preview Replies Before Launch

### Goal
Show the client how the assistant responds using screenshot-derived training.

### Inputs
- sample customer messages
- optional product context
- approved brand voice
- approved phrases
- approved scenario examples

### Actions
- generate preview reply
- compare 2–3 variations
- approve best style
- save improved reply as training example

### Why this matters
It helps the client trust the assistant before launch.

---

# Post-Launch Learning

After the bot is connected, live conversations become the best ongoing source of improvement.

But screenshot onboarding remains important because it gives the assistant a better starting point.

## Live training actions
- approve AI reply
- save manager reply as example
- save manager correction
- tag live conversations by scenario

---

# Recommended UI Structure

## Onboarding
1. General
2. Screenshot Upload
3. Extraction Review
4. Brand Voice Draft
5. Good Phrases
6. Scenario Examples
7. Escalation Suggestions
8. Preview Replies
9. Launch Checklist

## AI Training
1. Screenshot Imports
2. Extraction Review Queue
3. Training Examples Library
4. Approved Phrases
5. Avoid Phrases
6. Live Conversation Teaching

---

# Data Model Overview

## screenshot_import_jobs
- id
- store_id
- status
- uploaded_by_user_id
- created_at

## screenshot_import_files
- id
- import_job_id
- file_url
- ocr_status
- extraction_status
- extracted_text_raw
- created_at

## extracted_conversation_fragments
- id
- screenshot_file_id
- store_id
- transcript_json
- scenario_suggestion
- confidence_score
- is_reviewed
- is_approved
- created_at

## extracted_voice_signals
- id
- store_id
- signal_type
- signal_value
- evidence_fragment_id
- confidence_score
- is_approved

## extracted_phrases
- id
- store_id
- phrase
- phrase_type
- scenario
- source_fragment_id
- is_approved

## training_examples
- id
- store_id
- source_type
- scenario
- customer_context_messages
- ai_reply_original
- manager_reply_final
- tags
- approved_for_ai
- created_at

---

# Product Rules

- Screenshot upload is mandatory in onboarding
- Screenshot content must be reviewed before becoming active training data
- Store structured outputs, not only raw screenshots
- Keep source traceability from every extracted asset back to the screenshot/file
- Support manual editing at every stage
- Do not rely on screenshots alone after launch; combine with live training later

---

# MVP Priorities

## Must-have
1. screenshot upload
2. OCR/extraction pipeline
3. transcript review UI
4. voice signal extraction
5. phrase extraction
6. scenario example extraction
7. approval workflow
8. preview replies using approved assets

## Later
- clustering duplicate phrases
- automatic quality scoring
- retrieval analytics
- suggested scenario tags
- screenshot batch quality scoring
- auto-detect best manager replies

---

# Success Criteria

The onboarding flow is successful if:

- a new client can prepare the assistant before connection
- the assistant learns from Instagram screenshots
- the client can review everything in a simple UI
- the assistant starts with better brand alignment on day one
- the system creates reusable structured training data from screenshots


---

# Technical Specification

# Direct Mate — Technical Specification (Screenshot-First Training Update)

## Product Direction Update

This version of the technical specification adds a mandatory onboarding capability:

**Instagram conversation screenshots must be supported as a first-class onboarding input.**

The system must use AI to convert screenshots into structured training data before the client connects the bot to their Instagram account.

This affects:
- onboarding
- data model
- admin UI
- AI pipeline
- review workflow
- retrieval inputs for reply generation

---

## New Mandatory Capability

### Screenshot-based training ingestion
The platform must support:
- upload of Instagram conversation screenshots
- OCR or multimodal extraction
- speaker turn reconstruction
- structured transcript review
- extraction of voice signals and reusable phrases
- extraction of scenario examples
- approval workflow before use by the assistant

This is not optional in MVP.

---

## AI Extraction Objectives

From screenshots, the system should extract:

### Brand voice profile
- tone
- formality
- emoji use
- average response style
- consultative vs direct style
- soft-sell vs proactive-sell behavior

### Good phrases
Examples that are useful in future responses.

### Phrases to avoid
Examples of wording that should not be copied.

### Scenario examples
Short structured examples that can be used as retrieval / few-shot guidance.

### Escalation patterns
Signals that suggest when a human should take over.

### Conversation behavior patterns
Examples:
- asks narrowing questions
- recommends top 1–2 options
- starts checkout quickly
- uses reassurance
- handles ambiguity softly

---

## System Architecture Impact

## New Components

### 1. Screenshot Import Module
Responsibilities:
- store uploaded files
- create import jobs
- manage extraction states
- expose review APIs

### 2. Extraction Pipeline Module
Responsibilities:
- OCR or multimodal parsing
- detect speaker turns
- normalize text
- split long conversations into fragments
- extract candidate training assets

### 3. Review Queue Module
Responsibilities:
- show extracted data to users
- support approve/edit/reject actions
- convert approved outputs into persistent training assets

### 4. Voice Profile Builder
Responsibilities:
- aggregate extracted voice signals
- generate draft brand voice profile
- merge approved voice signals into client profile

### 5. Phrase Library Builder
Responsibilities:
- group phrases by scenario/type
- deduplicate similar phrases
- expose approved phrases for reply generation

---

## Updated Admin UI Areas

### Onboarding
Must include:
- screenshot upload step
- extraction review step
- phrase review
- voice profile review
- scenario example review

### AI Training
Must include:
- screenshot imports list
- extraction review queue
- approved phrases
- avoid phrases
- training examples library

---

## Data Model Additions

## screenshot_import_jobs
Purpose:
Represents a batch upload during onboarding or later training.

Fields:
- id
- store_id
- status
- source_type
- created_by_user_id
- created_at
- completed_at

## screenshot_import_files
Purpose:
Represents each uploaded screenshot.

Fields:
- id
- import_job_id
- file_url
- file_name
- mime_type
- ocr_status
- extraction_status
- extracted_text_raw
- extraction_metadata
- created_at

## extracted_conversation_fragments
Purpose:
Normalized conversation pieces extracted from screenshot files.

Fields:
- id
- screenshot_file_id
- store_id
- transcript_json
- scenario_suggestion
- confidence_score
- reviewed_by_user_id
- is_reviewed
- is_approved
- created_at

## extracted_voice_signals
Purpose:
Stores AI-generated observations about brand voice.

Fields:
- id
- store_id
- source_fragment_id
- signal_type
- signal_value
- confidence_score
- is_approved
- created_at

## extracted_phrases
Purpose:
Stores candidate reusable phrases.

Fields:
- id
- store_id
- source_fragment_id
- phrase
- phrase_type
- scenario
- confidence_score
- is_approved
- created_at

## approved_phrases
Purpose:
Stores approved phrases available to the reply engine.

Fields:
- id
- store_id
- phrase
- phrase_type
- scenario
- tags
- created_from_source_id
- created_at

---

## AI Workflow Changes

## Current reply engine
Current flow:
- classify intent
- extract product keywords
- generate reply
- decide handoff

## New onboarding extraction flow
New separate pipeline:
1. screenshot upload
2. OCR / multimodal text extraction
3. transcript reconstruction
4. scenario classification
5. phrase extraction
6. voice signal extraction
7. review
8. approval
9. save approved assets

This pipeline is separate from live reply generation.

---

## How Approved Screenshot Data Should Be Used Later

Approved assets should feed into the reply engine in these ways:

### 1. Brand voice settings
Used in system prompt or policy layer.

### 2. Approved phrases
Used as optional stylistic guidance.

### 3. Scenario examples
Used as retrieval/few-shot examples.

### 4. Escalation suggestions
Used to help define initial handoff rules.

---

## Review Workflow Requirements

No extracted screenshot data should be used automatically without approval.

### Required actions
- approve
- edit
- reject
- merge duplicates
- convert fragment into training example

### Required metadata
- source screenshot
- source fragment
- confidence score
- reviewer id
- approval timestamp

---

## MVP Implementation Order

1. screenshot upload backend + storage
2. screenshot import job tracking
3. text extraction pipeline
4. transcript review UI
5. phrase extraction pipeline
6. voice signal extraction pipeline
7. scenario example extraction
8. approval and save flow
9. reply preview screen using approved assets

---

## Constraints

- final training data must be structured text, not only image files
- every approved asset must retain source traceability
- extraction must support imperfect OCR and manual cleanup
- UI must stay simple for non-technical users
- this flow is mandatory in onboarding


---

# Roadmap

# Direct Mate — Roadmap (Updated for Screenshot-First Onboarding)

## Product Strategy Update

The roadmap now prioritizes a mandatory onboarding feature:

**Instagram conversation screenshots -> AI extraction -> structured client profile + training assets**

This becomes the fastest way to make the assistant useful before live Instagram connection.

---

## Phase 0 — Foundation

### Goal
Prepare the base platform.

### Deliverables
- NestJS backend foundation
- React admin foundation
- Postgres / Supabase schema base
- authentication and tenant/store model
- conversation domain base
- training examples domain base

---

## Phase 1 — Screenshot Import MVP

### Goal
Allow clients to upload Instagram conversation screenshots during onboarding.

### Deliverables
- screenshot upload UI
- screenshot import jobs
- file storage integration
- import status tracking
- basic import history page

### Acceptance criteria
- client can upload multiple screenshots
- system stores jobs and files correctly
- onboarding can continue after upload

---

## Phase 2 — AI Extraction Pipeline

### Goal
Turn uploaded screenshots into structured draft data.

### Deliverables
- OCR or multimodal extraction pipeline
- extracted raw text storage
- speaker turn reconstruction
- transcript fragment generation
- scenario suggestion
- phrase extraction
- voice signal extraction

### Acceptance criteria
- system produces draft structured outputs from screenshots
- each extracted fragment is linked to source file
- confidence metadata is stored

---

## Phase 3 — Review and Approval UX

### Goal
Make extracted data usable and trustworthy.

### Deliverables
- extraction review queue
- transcript editor
- approve / edit / reject actions
- phrase review UI
- voice signal review UI
- scenario example approval flow

### Acceptance criteria
- user can review screenshot-derived data easily
- approved data becomes structured training assets
- rejected data is excluded from training use

---

## Phase 4 — Screenshot-Derived Onboarding Profile

### Goal
Use approved screenshot data to generate a useful assistant profile before launch.

### Deliverables
- draft brand voice profile
- approved phrases library
- phrases to avoid
- approved scenario examples
- suggested handoff rules
- reply preview screen

### Acceptance criteria
- client can approve initial AI behavior before Instagram connection
- preview replies reflect screenshot-derived knowledge

---

## Phase 5 — Live Instagram Launch

### Goal
Connect the bot and start handling real conversations.

### Deliverables
- Instagram connection
- conversation ingestion
- reply generation
- product sync / scheduled sync
- handoff flow

### Acceptance criteria
- assistant replies using approved onboarding assets
- client can launch after onboarding checklist passes

---

## Phase 6 — Post-Launch Learning

### Goal
Continue improving the assistant from live usage.

### Deliverables
- approve AI reply
- save manager reply as example
- save correction to AI reply
- link live examples with scenario tags
- training examples library expansion

### Acceptance criteria
- live conversations improve the assistant over time
- screenshot-derived onboarding and live learning work together

---

## Immediate Build Priority

### Priority 1
- screenshot upload
- screenshot import data model
- basic review workflow

### Priority 2
- phrase extraction
- voice extraction
- training example extraction

### Priority 3
- onboarding review UI
- preview replies

### Priority 4
- live conversation teaching actions

---

## Not in Immediate Scope
- advanced analytics
- bulk CRM import
- auto-quality scoring
- deep clustering / semantic deduplication
- fine-tuning
- sophisticated OCR optimization

---

## MVP Success Definition

The MVP is successful when:

- a client can upload Instagram screenshots before launch
- AI extracts useful onboarding knowledge from them
- the client can review and approve the extracted data
- the assistant launches with better brand alignment
- live conversations later build on top of that foundation


---

# Training Examples Schema

# Direct Mate — Training and Screenshot Extraction Schema

## Purpose

This document defines the core schema concepts for screenshot-based onboarding and AI training.

It focuses on:
- screenshot imports
- extracted transcripts
- extracted voice signals
- extracted phrases
- approved training examples

---

## Source Types

Every training asset should track its source.

### Allowed source types
- screenshot_import
- manual_entry
- template
- pasted_chat
- ai_reply_approved
- manager_reply_saved
- ai_reply_corrected

---

## Scenario Types

Suggested enum values:
- greeting
- product_recommendation
- showing_available_options
- clarifying_preference
- out_of_stock
- alternative_offer
- price_question
- delivery_question
- payment_question
- checkout_start
- soft_close
- handoff_to_manager
- complaint_handling
- ambiguous_short_reply

---

## screenshot_import_jobs

Purpose:
Represents a batch screenshot upload session.

Fields:
- id
- store_id
- status
- created_by_user_id
- total_files_count
- processed_files_count
- approved_fragments_count
- rejected_fragments_count
- created_at
- updated_at
- completed_at

---

## screenshot_import_files

Purpose:
Represents each uploaded screenshot file.

Fields:
- id
- import_job_id
- store_id
- file_url
- file_name
- mime_type
- width
- height
- ocr_status
- extraction_status
- extracted_text_raw
- extraction_metadata_json
- created_at
- updated_at

---

## extracted_conversation_fragments

Purpose:
Represents structured transcript fragments derived from screenshots.

Fields:
- id
- screenshot_file_id
- store_id
- transcript_json
- transcript_text
- scenario_suggestion
- confidence_score
- review_status
- reviewed_by_user_id
- reviewed_at
- created_at

### transcript_json structure
- ordered turns
- speaker role per turn
- text per turn

Example:
[
  { "role": "customer", "text": "Які є блиски?" },
  { "role": "manager", "text": "Зараз є 3 варіанти..." }
]

---

## extracted_voice_signals

Purpose:
Stores AI-detected voice characteristics.

Fields:
- id
- store_id
- source_fragment_id
- signal_type
- signal_value
- evidence_text
- confidence_score
- approval_status
- approved_by_user_id
- approved_at
- created_at

### signal_type examples
- tone
- formality
- emoji_usage
- reply_length
- sales_style
- reassurance_style
- apology_style

---

## extracted_phrases

Purpose:
Stores candidate reusable phrases extracted from screenshots.

Fields:
- id
- store_id
- source_fragment_id
- phrase
- phrase_type
- scenario
- tags_json
- confidence_score
- approval_status
- approved_by_user_id
- approved_at
- created_at

### phrase_type examples
- good_phrase
- avoid_phrase
- greeting
- recommendation
- handoff
- checkout_start
- reassurance

---

## training_examples

Purpose:
Structured examples used by the assistant for retrieval/few-shot guidance.

Fields:
- id
- store_id
- source_type
- source_fragment_id
- scenario
- customer_context_messages_json
- ai_reply_original
- manager_reply_final
- tags_json
- notes
- approved_for_ai
- created_by_user_id
- created_at
- updated_at

---

## approved_brand_voice_profile

Purpose:
Stores the approved voice settings for the store.

Fields:
- id
- store_id
- tone
- formality
- emoji_usage
- reply_length
- sales_style
- phrases_to_use_json
- phrases_to_avoid_json
- last_generated_from_import_job_id
- updated_by_user_id
- updated_at

---

## Review Status Enums

### Generic review status
- draft
- needs_review
- approved
- rejected

---

## Product Rules

- every extracted asset must retain source traceability
- only approved assets may be used by the assistant
- screenshot files are source evidence, not final training format
- training examples should be small and scenario-focused
- duplicates should be mergeable later
