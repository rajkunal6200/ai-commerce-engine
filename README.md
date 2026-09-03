# AI Commerce Engine

> **Agentic commerce with deterministic payment safety, human authorization, and auditable AI decisions.**

## Overview

AI Commerce Engine is a secure, conversational commerce system that turns natural-language shopping requests into controlled, auditable purchase workflows.

Instead of treating AI as the payment authority, the system separates AI reasoning from transaction authorization.

The AI can understand buyer intent, recommend products, construct bounded offers, refine decisions through conversation, and provide merchant decision intelligence.

Payment execution remains protected by deterministic server-side validation, merchant policy, explicit user approval, Razorpay verification, webhook protection, idempotency, persistence, and audit logging.

## Core Principle

> **AI can make the commerce decision, but the system—not the AI—controls what is actually allowed to happen.**

## Core Flow

```text
Buyer Intent
     ↓
Commerce Contract
     ↓
Bounded Offer
     ↓
Merchant Policy
     ↓
Human Approval
     ↓
Secure Execution
     ↓
Razorpay
     ↓
Server-Side Verification
     ↓
Payment Capture
     ↓
Audit Trail
     ↓
Revenue + Decision Intelligence
```

Key Features

🤖 AI Commerce

- Buyer Intent Engine
- Natural-language shopping
- Conversational commerce
- Multi-turn buyer intent refinement
- Context-aware recommendations
- Product recommendations
- Complementary product recommendations
- Budget-aware shopping
- Structured purchase intent creation

📜 Commerce Contract

- Structured buyer constraints
- Merchant rules
- Currency enforcement
- Buyer budget enforcement
- Required and preferred tags
- Excluded tags
- Server-authoritative offer construction
- Merchant catalog price validation
- Stock validation
- Explicit product compatibility

💰 Offer Engine

- Budget-bounded offers
- Merchant-controlled discount limits
- Server-calculated discount amounts
- Server-authoritative final prices
- Contract-bound offer generation
- Explainable offer decisions
- Decision traces

📊 Merchant Intelligence

- Merchant Control Dashboard
- Commerce Profile
- Revenue Agent
- Revenue intelligence
- AI Decision Intelligence
- Structured decision traces
- Decision factors and impact
- Human-readable AI explanations
- Product catalog visibility

🔄 Autonomous Commerce Loop

The system exposes an explicit, observable commerce lifecycle:

intent_created
↓
awaiting_approval
↓
ready_for_execution
↓
payment_pending
↓
payment_authorized
↓
payment_verified

Important: autonomous commerce does not mean autonomous charging.

AI can reason and prepare a commerce transaction, but it cannot bypass:

- Merchant policy
- Server-side validation
- Buyer constraints
- Explicit user approval
- Payment verification

The commerce loop therefore provides autonomy in reasoning and orchestration, while keeping financial authorization deterministic and controlled.

⸻

Conversational Commerce

The conversational shopping endpoint maintains session-level buyer context.

POST /conversational-shop

The system can progressively refine:

- Product type
- Features
- Purpose
- Budget
- Preferences

Example
Buyer:
"I need wireless headphones under ₹6,000."

AI:
"SoundMax Headphones — ₹5,000"

Buyer:
"Actually, keep it under ₹5,500."

AI:
"SoundMax Headphones — ₹5,000"

A refinement creates a new purchase intent rather than mutating the previous intent.

This preserves historical integrity and keeps payment authorization tied to a specific immutable purchase decision.

AI Decision Intelligence

The merchant dashboard provides structured AI decision intelligence rather than opaque AI output.

Decision traces contain:

- Decision type
- Final decision
- Decision factors
- Factor values
- Factor impact
- Human-readable explanation

Example conceptual trace:

Decision:
Recommend SoundMax Headphones

Factors:

- Category match → Strong positive
- Budget fit → Strong positive
- Wireless requirement → Positive
- Work purpose → Positive
- Stock availability → Valid
  This makes AI decisions easier for merchants to understand, review, and audit.

Revenue Intelligence

The Revenue Agent provides merchant-oriented intelligence around commerce decisions.

The system can expose:

- Revenue opportunities
- Product opportunities
- Offer opportunities
- Cross-sell opportunities
- Decision context
- Merchant constraints

Revenue optimization remains bounded by merchant-defined controls.

The system does not allow an AI-generated revenue recommendation to silently override merchant policy.

⸻

Security Architecture

AI Commerce Engine follows a defense-in-depth model:
AI proposes
↓
Server validates
↓
Merchant policy validates
↓
User authorizes
↓
Razorpay processes
↓
Server verifies
↓
Webhook confirms
↓
Audit records

Critical protections

- Server-authoritative purchase amount
- Merchant catalog price validation
- Buyer budget enforcement
- Merchant policy enforcement
- Explicit user approval
- Razorpay signature verification
- Order validation
- Amount validation
- Currency validation
- Capture-status validation
- Webhook signature verification
- Webhook event-id idempotency
- Payment idempotency
- Stale webhook protection
- Payment failure downgrade protection
- Persistent audit trail
- Request correlation IDs
- Structured request logging

The AI layer is never the payment authority.

⸻

API Reference

System

GET /
GET /catalog
GET /commerce-profile

AI Shopping

POST /understand
POST /recommend
POST /cross-sell
POST /shop
POST /conversational-shop

Commerce Contracts and Offers

POST /commerce-contract
POST /offer
POST /offer-from-contract

Intent and Approval

POST /intent
POST /approval
GET /intent/{intent_id}
GET /audit/{intent_id}

Autonomous Commerce
GET /commerce-loop/{intent_id}

The commerce-loop endpoint exposes the current transaction state and the next safe action.

Example states include:

awaiting_approval
ready_for_execution
payment_pending
payment_authorized
payment_verified
blocked

The endpoint also reports whether policy and user authorization requirements have been satisfied.

Payment

POST /execute/{intent_id}
POST /payment/verify
POST /webhooks/razorpay

Secure Payment Flow

Razorpay Checkout
↓
Payment Success
↓
Server-Side Verification
↓
Signature Check
↓
Order Validation
↓
Amount Validation
↓
Currency Validation
↓
Capture Validation
↓
Payment Verified
↓
Audit Trail Updated

The frontend never acts as the final authority for payment success.

Payment verification happens on the server.

⸻

Commerce Contract

The Commerce Contract acts as the boundary between buyer intent and transaction execution.

A contract contains:

Buyer Constraints +
Merchant Rules +
Commerce Offer +
Policy Approval +
User Authorization

Buyer constraints can include:

- Query
- Category
- Minimum budget
- Maximum budget
- Required tags
- Preferred tags
- Excluded tags

Merchant rules can include:

- Currency
- User approval requirement
- Maximum discount percentage

The final offer is rebuilt and validated server-side.

Client-provided financial values are never blindly trusted.

⸻

Bounded Offer Engine

The Offer Engine is designed around explicit constraints.

An offer is bounded by:

Commerce Contract
Merchant Catalog Prices
Stock Availability
Explicit Product Compatibility
Buyer Constraints
Required Tags
Excluded Tags
Merchant Maximum Discount
Buyer Maximum Budget

The server determines:

- Eligible products
- Complementary products
- Subtotal
- Discount
- Final amount
- Currency
- Decision explanation

This prevents an AI or client-side request from silently changing the actual transaction amount.

⸻

Request Correlation and Observability

Every HTTP request can receive a correlation ID through:
X-Request-ID

f the client does not provide one, the backend generates a UUID.

The response returns the same ID:
X-Request-ID: <request-id>

Structured request logging records:

- Request ID
- HTTP method
- Request path
- Response status
- Request duration

This makes debugging and transaction tracing easier.

⸻

Project Structure

ai-commerce-engine/
├── main.py
├── payment.py
├── policy.py
├── requirements.txt
├── README.md
├── .env.example
├── .gitignore
│
├── models/
│ ├── audit.py
│ ├── decision.py
│ ├── intent.py
│ ├── commerce_contract.py
│ ├── offer.py
│ └── recommendation.py
│
├── tests/
│ ├── test_api.py
│ ├── test_payment.py
│ ├── test_persistence.py
│ └── test_webhook.py
│
└── frontend/
├── index.html
├── app.js
└── style.css

    ⸻

Tech Stack

Backend

- Python
- FastAPI
- Pydantic
- Uvicorn

Payments

- Razorpay

Frontend

- HTML
- CSS
- JavaScript

Testing

- Pytest
- HTTPX

Persistence

- JSON-based application state

⸻

Local Setup

git clone https://github.com/rajkunal6200/ai-commerce-engine.git
cd ai-commerce-engine

python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env

Add Razorpay test credentials to .env.

⸻

Running the Application

Backend

source .venv/bin/activate
uvicorn main:app --reload

http://127.0.0.1:8000

Frontend

In a separate terminal:

cd frontend
python3 -m http.server 5500

Open:
http://127.0.0.1:5500

Testing

Run the complete test suite:
pytest -q

Current V4 stable result:
67 passed

Additional validation:
python -m py_compile main.py models/\*.py
node --check frontend/app.js

The stable build has been validated with:

- Backend tests
- Payment tests
- Persistence tests
- Webhook tests
- Python compilation
- Frontend JavaScript syntax validation
- End-to-end Razorpay test-mode payment flow

⸻

Demo Scenario

Use the following natural-language request:

“I need wireless headphones for work under ₹6,000.”

The engine:

1. Understands the buyer request.
2. Extracts product and budget constraints.
3. Recommends SoundMax Headphones — ₹5,000.
4. Creates a bounded purchase intent.
5. Creates a Commerce Contract.
6. Validates merchant policy.
7. Presents the purchase review.
8. Requests explicit user approval.
9. Creates a Razorpay test order.
10. Verifies payment server-side.
11. Records the transaction in the audit trail.
12. Exposes merchant decision intelligence.

The frontend communicates the transaction pipeline as:

Intent → Contract
↓
AI Policy
↓
Human Approval
↓
Payment → Verify

Hackathon Positioning

AI Commerce Engine is not simply a shopping chatbot.

It is an agentic commerce architecture where AI reasoning is separated from transaction authority.

The central idea:

AI can make the commerce decision, but the system—not the AI—controls what is actually allowed to happen.

This combines:
AI Reasoning +
Buyer Intent +
Commerce Contracts +
Merchant Controls +
Human Authorization +
Secure Payments +
Auditability +
Merchant Intelligence

Why This Architecture Matters

Traditional commerce assistants often focus on:
Search → Recommend → Buy

AI Commerce Engine adds explicit transaction boundaries
Understand
↓
Constrain
↓
Reason
↓
Validate
↓
Authorize
↓
Execute
↓
Verify
↓
Audit

This makes agentic commerce more:

- Controllable
- Explainable
- Auditable
- Policy-aware
- Payment-safe
- Merchant-aware

The architecture is designed so that increasing AI autonomy does not require giving the AI unrestricted financial authority.

⸻

Future Roadmap

Potential extensions include:

- Persistent conversational memory
- Multi-merchant commerce
- Advanced product compatibility graphs
- Real-time inventory integrations
- Merchant-specific AI policies
- Advanced revenue optimization
- Richer decision analytics
- Production database persistence
- Distributed event processing
- Additional payment providers
- Advanced fraud and risk intelligence

⸻

Stable Build

The current stable V4 checkpoint is:
v4-stable

Validated with:
67 passing tests
Python compilation checks
JavaScript syntax checks
End-to-end Razorpay test-mode flow
Server-side payment verification
Security and audit verification
Autonomous commerce loop
Merchant AI decision intelligence
Conversational commerce refinement

License

This project is built as an AI commerce engineering and hackathon project.
