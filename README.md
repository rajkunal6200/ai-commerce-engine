# AI Commerce Engine

## Overview

AI Commerce Engine is a secure, conversational commerce system that turns natural-language shopping requests into controlled purchase workflows.

The system combines AI-powered shopping assistance with policy enforcement, explicit user approval, secure Razorpay payments, server-side payment verification, webhook protection, idempotency, persistence, and auditability.

### Core Flow

User Request → AI Understanding → Recommendation → Purchase Intent → Policy Check → User Approval → Secure Execution → Razorpay Checkout → Server-Side Payment Verification → Audit Trail

## Features

- Natural-language shopping
- AI-powered product recommendations
- Structured purchase intent creation
- Policy-based purchase control
- Explicit user approval before payment
- Razorpay payment integration
- Server-side payment verification
- Razorpay webhook signature verification
- Payment and webhook idempotency
- Persistent intent and audit state
- Secure execution flow
- Complete purchase audit trail
- FastAPI backend
- Interactive frontend
- Automated test suite

## Project Structure

```text
ai-commerce-engine/
├── main.py
├── payment.py
├── policy.py
├── requirements.txt
├── .env.example
├── .gitignore
│
├── models/
│   └── audit.py
│
├── tests/
│   ├── test_api.py
│   ├── test_payment.py
│   ├── test_persistence.py
│   └── test_webhook.py
│
└── frontend/
    ├── index.html
    ├── app.js
    └── style.css
```

## Project Structure

```text
ai-commerce-engine/
├── main.py
├── payment.py
├── policy.py
├── requirements.txt
├── .env.example
├── .gitignore
│
├── models/
│   └── audit.py
│
├── tests/
│   ├── test_api.py
│   ├── test_payment.py
│   ├── test_persistence.py
│   └── test_webhook.py
│
└── frontend/
    ├── index.html
    ├── app.js
    └── style.css

```

## Tech Stack

### Backend

- Python
- FastAPI
- Pydantic
- Uvicorn

### Payments

- Razorpay

### Frontend

- HTML
- CSS
- JavaScript

### Testing

- Pytest
- HTTPX

### Persistence

- JSON-based application state

## Core Commerce Flow

The application follows a controlled purchase lifecycle:

```text
1. User Request
       ↓
2. Natural-Language Understanding
       ↓
3. Product Recommendation
       ↓
4. Purchase Intent Creation
       ↓
5. Policy Check
       ↓
6. User Approval
       ↓
7. Secure Execution
       ↓
8. Razorpay Order Creation
       ↓
9. Razorpay Checkout
       ↓
10. Server-Side Payment Verification
       ↓
11. Payment State Update
       ↓
12. Audit Trail
```

## API Reference

### System

- `GET /` — Health check
- `GET /catalog` — Retrieve the product catalog

### AI Shopping

- `POST /understand` — Understand a natural-language shopping request
- `POST /recommend` — Generate product recommendations
- `POST /cross-sell` — Suggest complementary products
- `POST /shop` — Process a shopping request
- `POST /conversational-shop` — Continue a conversational shopping session

### Intent & Approval

- `POST /intent` — Create a purchase intent
- `POST /approval` — Approve or reject a purchase intent
- `GET /intent/{intent_id}` — Retrieve intent details
- `GET /audit/{intent_id}` — Retrieve the complete audit trail

### Payment

- `POST /execute/{intent_id}` — Execute an approved purchase
- `POST /payment/verify` — Verify a Razorpay payment on the server
- `POST /webhooks/razorpay` — Process Razorpay webhook events

### Secure Payment Flow

Razorpay Checkout
→ Payment Success
→ Server-Side Verification
→ Signature Check
→ Order Validation
→ Amount & Currency Validation
→ Capture Validation
→ Payment Verified
→ Audit Trail Updated

The frontend never acts as the final authority for payment success.

## Product Catalog

The current catalog contains:

- ProBook Laptop (LAP001) — ₹50,000
- SoundMax Headphones (HP001) — ₹5,000
- ProMouse (MS001) — ₹1,500

The catalog is used by the shopping flow for product understanding, recommendations, and purchase intent creation.

## Local Setup

Clone the repository:

git clone https://github.com/rajkunal6200/ai-commerce-engine.git

Move into the project directory:

cd ai-commerce-engine

Create and activate a virtual environment:

python3 -m venv .venv
source .venv/bin/activate

Install the dependencies:

pip install -r requirements.txt

Create the environment file:

cp .env.example .env

Add your Razorpay test credentials to the .env file.

## Running the Application

Start the backend:

source .venv/bin/activate
uvicorn main:app --reload

The backend will run at:

http://127.0.0.1:8000

Start the frontend in a separate terminal:

cd frontend
python3 -m http.server 5500

Open the application at:

http://127.0.0.1:5500

## Testing

Run the complete test suite from the project root:

pytest -q

Current test result:

59 passed

## Payment Security

Payments are verified on the backend before they are marked as successful.

The payment verification flow validates the Razorpay signature, order ID, payment amount, currency, and capture status.

Razorpay webhook requests are also verified using the webhook signature.

The application protects against duplicate payment verification, duplicate webhook events, stale webhook replays, and late payment failure events.

Razorpay secret credentials are never exposed to the frontend.

## Audit Trail

The application maintains an audit trail for important purchase lifecycle events.

A successful purchase records events such as:

Purchase intent created
Policy verified
User approval received
Secure execution started
Razorpay order created
Payment signature verified
Secure execution completed
Payment captured

The audit trail can be retrieved using:

GET /audit/{intent_id}

## Razorpay Test Mode

The project uses Razorpay Test Mode during development.

Test transactions are simulated and do not charge real money.

The complete Razorpay checkout flow has been tested successfully, including server-side payment verification and audit logging.

## Security Principles

The application follows these principles:

- Never trust frontend payment success alone
- Keep payment secrets on the backend
- Verify Razorpay signatures server-side
- Validate payment amount and currency
- Validate Razorpay order and payment relationships
- Verify webhook signatures
- Protect against duplicate and replayed events
- Require explicit user approval before execution
- Maintain an auditable purchase lifecycle

## Project Status

AI shopping flow: Complete

Purchase intent and policy system: Complete

User approval flow: Complete

Razorpay integration: Complete

Server-side payment verification: Complete

Webhook security: Complete

Payment idempotency: Complete

Persistent state: Complete

Audit trail: Complete

Frontend: Complete

Real Razorpay Test Mode E2E: Complete

Automated regression: 59 tests passed

## Production Considerations

Before production deployment:

- Use production Razorpay credentials
- Store secrets using secure environment configuration
- Enable HTTPS
- Use durable shared storage for multiple application instances
- Configure production CORS and allowed origins
- Configure monitoring and logging
- Complete Razorpay production account activation



