# Direct Mate — Onboarding and AI Training Flow

## Purpose

This document defines the onboarding and AI training flow for new client stores before and after the Instagram AI assistant is connected to their account.

The goal is to make Direct Mate useful from day one, even before live Instagram conversations are available.

The flow is split into two phases:

1. **Pre-launch training**
2. **Post-launch live training**

The system should support both.

---

## Core Principles

- Clients should be able to prepare the assistant **before launch**
- Live conversations should become the **best source of future improvement**
- The UI should be simple for non-technical store owners and managers
- Structured examples are more valuable than raw screenshots
- Screenshots are allowed as a fallback input method, not as the final storage format
- Every training example should be reviewable, editable, taggable, and approvable
- The system should support different verticals later, but MVP should optimize for fashion and beauty

---

## High-Level Flow

### Phase 1 — Pre-launch onboarding
The client configures:
- brand voice
- business rules
- sales preferences
- handoff rules
- initial training examples

### Phase 2 — Launch
The assistant is connected to the client's Instagram account and starts responding to real conversations.

### Phase 3 — Post-launch learning
The client improves the assistant by:
- approving good AI replies
- saving good manager replies
- saving manager corrections to weak AI replies
- adding new examples from real conversation history

---

## MVP Scope

### Must-have onboarding features
1. Brand voice setup
2. Business rules setup
3. Manual training example creation
4. Scenario-based example templates
5. Paste old conversation flow
6. Basic screenshot import as fallback
7. Preview / test reply screen before launch

### Must-have post-launch training features
1. Save manager reply as AI example
2. Approve AI reply
3. Save manager correction to AI reply
4. Training examples list with edit / approve / delete

---

## User Roles

### Store Owner
- completes initial onboarding
- defines rules and brand style
- approves examples
- launches assistant

### Manager
- adds and edits examples
- saves useful replies from conversations
- corrects AI replies
- flags weak replies

### Admin / Internal Team
- helps with setup
- reviews edge cases
- monitors quality
- supports launch

---

# Phase 1 — Pre-Launch Onboarding

## Step 1 — Basic Store Profile

### Purpose
Collect minimal information about the store.

### Fields
- Store name
- Industry / vertical
- Country / timezone
- Main language
- Secondary language(s)
- Instagram handle
- Internal notes

### MVP notes
Keep this step very short.

---

## Step 2 — Brand Voice Setup

### Purpose
Teach the assistant how the brand should sound.

### Fields
- Tone of voice
  - friendly
  - warm
  - premium
  - expert
  - playful
- Formality
  - use formal address
  - use informal address
- Emoji usage
  - none
  - light
  - moderate
- Reply length
  - short
  - balanced
  - consultative
- Sales style
  - soft
  - balanced
  - proactive
- Phrases to use
- Phrases to avoid
- Sample good replies
- Sample bad replies

### UI recommendation
Use a mix of:
- dropdowns
- toggles
- multi-line text inputs
- optional sample reply cards

### Future enhancement
Allow AI to rewrite sample replies into a cleaner brand voice draft for approval.

---

## Step 3 — Business Rules Setup

### Purpose
Define what the AI is allowed to say and do.

### Fields
- Business hours
- Manager online hours
- Delivery methods
- Payment methods
- Return/exchange policy
- Reservation allowed: yes/no
- Reservation duration
- Draft order creation allowed: yes/no
- Can AI state exact stock quantity: yes/no
- Allowed languages
- Escalation required for:
  - complaints
  - discount requests
  - manager request
  - low confidence
  - unclear product selection
  - custom orders

### UI recommendation
Show grouped cards:
- Operations
- Delivery & payment
- Escalation rules
- AI permissions

---

## Step 4 — Sales Preferences

### Purpose
Adjust how the assistant sells.

### Fields
- Recommend bestseller first
- Recommend budget option first
- Recommend premium option first
- Offer alternatives when out of stock: yes/no
- Upsell allowed: yes/no
- Cross-sell allowed: yes/no
- Maximum number of products to show at once
- Should AI guide customer to choice after listing products: yes/no
- Should AI proactively ask follow-up questions: yes/no

### Notes
This directly affects conversation quality and sales behavior.

---

## Step 5 — Initial AI Training Examples

### Purpose
Give the assistant useful examples before launch.

This step should support multiple input methods.

---

## Method A — Manual Example Builder

### Purpose
Allow the client to manually create high-quality examples.

### Fields
- Scenario
- Customer message
- Optional prior customer context
- Manager reply
- Tags
- Notes
- Approve for AI: yes/no

### Suggested scenarios
- Greeting
- Product recommendation
- Showing available options
- Clarifying customer preference
- Out of stock
- Alternative offer
- Price question
- Delivery question
- Payment question
- Start checkout
- Soft close
- Handoff to manager
- Complaint handling
- Ambiguous short reply

### UI recommendation
A simple form with:
- scenario dropdown
- text fields
- tags input
- approve checkbox

---

## Method B — Scenario Templates

### Purpose
Help clients who do not know how to write examples from scratch.

### UX
The client selects a scenario template and fills in example content.

### Example template structure
- Scenario title
- Explanation of when to use it
- Example customer message
- Placeholder for recommended manager reply
- Tips for a good reply

### Why this matters
It reduces blank-page friction during onboarding.

---

## Method C — Paste Old Conversation

### Purpose
Use old real chats before the bot is connected.

### UX flow
1. Client pastes a conversation transcript
2. System parses turns into customer / manager messages
3. Client selects which part is useful
4. Client chooses scenario and tags
5. Client edits if needed
6. Save as approved example

### Notes
This is one of the best pre-launch input methods.

### Important
The system should store the final result as structured text, not raw pasted transcript only.

---

## Method D — Screenshot Upload (Fallback)

### Purpose
Allow import of old chat screenshots when text is not available.

### Important principle
Screenshots are an **input method only**, not the final training format.

### UX flow
1. Client uploads screenshot(s)
2. System extracts text
3. System displays extracted text preview
4. Client reviews and edits
5. Client marks customer / manager turns
6. Client selects useful fragment
7. Client chooses scenario and tags
8. Save structured example

### Warnings
- OCR errors are possible
- Manual review is required
- Do not use screenshot data directly without confirmation

### MVP note
This can be basic in V1.

---

## Step 6 — Preview Assistant Replies

### Purpose
Let the client see how the assistant might respond before launch.

### UX
The client enters sample customer messages and sees generated draft replies based on:
- brand voice
- business rules
- training examples

### Actions
- approve reply style
- edit settings
- add more examples
- save improved reply as an example

### Sample test cases
- What lip glosses do you have?
- Which one would you recommend?
- Is this product available?
- How much is delivery?
- I want to place an order

### Why this matters
It increases trust before launch.

---

## Step 7 — Launch Readiness Check

### Purpose
Ensure the assistant is ready for activation.

### Checklist
- Brand voice completed
- Business rules completed
- At least 5 approved examples added
- Preview replies reviewed
- Escalation rules configured
- Data source connected or prepared

### UI
Show a readiness score or checklist.

---

# Phase 2 — Launch

## Purpose
Connect the assistant to the client's real Instagram account and begin live operation.

### Launch steps
1. Connect Instagram account
2. Verify connection status
3. Verify product/availability sync
4. Enable AI assistant
5. Start with monitored mode if needed

### Optional launch modes
- Draft mode
- Monitored mode
- Full live mode

---

# Phase 3 — Post-Launch Live Training

## Purpose
Improve the assistant using real conversations.

This should become the main long-term improvement loop.

---

## Conversation View Actions

Inside a live conversation thread, the UI should support these actions.

### For AI replies
- Approve reply
- Mark weak reply
- Save as approved AI example
- Save correction

### For manager replies
- Save as AI example
- Tag scenario
- Add notes

---

## Live Training Action A — Approve AI Reply

### Purpose
Keep good AI behavior as reusable examples.

### Stored data
- conversation context
- customer message(s)
- AI reply
- scenario
- tags
- approved status

### Benefit
Builds a high-quality library of successful AI outputs.

---

## Live Training Action B — Save Manager Reply as Example

### Purpose
Store strong human replies for future retrieval and style guidance.

### Stored data
- recent customer context
- manager reply
- scenario
- tags
- approval

### Benefit
Captures real brand behavior.

---

## Live Training Action C — Save Manager Correction to AI Reply

### Purpose
Create a gold-standard correction pair.

### Stored data
- customer message(s)
- AI reply
- manager corrected reply
- scenario
- tags
- optional note about what was wrong

### Benefit
This is one of the most valuable datasets for improvement.

---

# Training Examples Library

## Purpose
Provide a central place where the client can manage all examples.

### Table columns
- Scenario
- Source
- Customer message preview
- Reply preview
- Tags
- Approved
- Created at
- Last used
- Quality score (future)
- Edit / delete actions

### Filters
- Scenario
- Source type
- Approved only
- Recently added
- Used by AI
- Needs review

### Source types
- manual
- template
- pasted_chat
- screenshot_import
- live_manager_reply
- ai_reply_approved
- ai_reply_corrected

---

# Recommended Data Model

## Training Example
- id
- store_id
- source_type
- scenario
- customer_context_messages
- ai_reply_original (optional)
- manager_reply_final
- tags
- notes
- approved_for_ai
- created_by_user_id
- created_at
- updated_at

## Screenshot Import Job
- id
- store_id
- file_url
- extraction_status
- extracted_text
- reviewed_text
- created_at

## Preview Session
- id
- store_id
- input_message
- generated_reply
- approved
- created_at

---

# UX Recommendations

## Keep onboarding short
Do not overload the client with too many fields at once.

## Use progressive disclosure
Start simple, then allow advanced settings.

## Use templates and examples
Never show an empty page if possible.

## Make training feel practical
Use wording like:
- Teach the assistant
- Save this reply
- Add a good example
- Improve reply style

Avoid overly technical wording.

---

# Suggested Screen Structure

## Onboarding
1. General
2. Brand Voice
3. Business Rules
4. Sales Preferences
5. Training Examples
6. Preview Replies
7. Launch Checklist

## AI Training Section
1. Examples Library
2. Add Example
3. Import Conversations
4. Screenshot Import
5. Approved AI Replies
6. Corrections

---

# MVP vs Later

## MVP
- brand voice setup
- business rules
- manual example creation
- scenario templates
- paste old conversation
- basic screenshot import
- preview replies
- live save-as-example actions
- examples library

## Later
- auto-tagging
- quality scoring
- suggested examples
- retrieval analytics
- bulk import from CRM exports
- better OCR pipeline
- conversation outcome scoring
- automatic recommendation of strong manager replies

---

# Implementation Notes for Claude Code

## Priority order
1. Build data model for training examples
2. Build onboarding screens
3. Build manual example creation flow
4. Build examples library
5. Build paste-old-chat flow
6. Add screenshot import fallback
7. Add preview replies screen
8. Add live conversation save/correct/approve actions

## Important constraints
- Store structured examples, not raw screenshots as final knowledge
- Make scenario tagging mandatory
- Allow approval workflow
- Keep source_type on every example
- Support small context windows, not only single messages
- Design for future retrieval by scenario and tags

---

# Success Criteria

The onboarding/training flow is successful if:

- A new client can prepare the assistant before Instagram connection
- The client can add examples without technical help
- The client can improve the assistant after launch using live chats
- The AI becomes more brand-consistent over time
- The flow feels simple enough for small business owners and managers
