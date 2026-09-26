# Autonomous Dynamic Commerce Orchestrator & Multi-Agent Negotiation Engine

[![Build & Tests](https://github.com/your-org/autonomous-commerce-orchestrator/actions/workflows/tests.yml/badge.svg)](https://github.com/your-org/autonomous-commerce-orchestrator/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg?logo=node.js)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.12-yellow.svg?logo=python)](https://python.org/)
[![Payment](https://img.shields.io/badge/Gateway-Razorpay%20Live%20Ready-blueviolet.svg)](https://razorpay.com/)
[![Governance](https://img.shields.io/badge/Quorum-3--Agent%20Consensus-emerald.svg)](#3-agent-quorum-consensus)
[![Security](https://img.shields.io/badge/Security-Financial%20Firewall%20Enforced-red.svg)](#security--governance-architecture)

> **Enterprise-grade autonomous commerce orchestrator featuring dynamic margin protection firewalls, 3-agent multi-model quorum consensus, deterministic Razorpay checkout delegation, and multi-channel conversational shopping (Web + WhatsApp).**

---

## 1. Executive Summary & Core Value Proposition

Modern conversational AI systems frequently suffer from **financial hallucinations**—spontaneously offering unviable discounts, accepting sub-cost offers, or committing to arbitrary warranty terms. 

The **Autonomous Dynamic Commerce Orchestrator** decouples natural language comprehension from financial execution authority:

1. **AI Decides, Deterministic Enclave Authorizes**: LLMs reason about buyer intent, catalog specifications, and persuasive negotiation. However, no discount, bundle composition, or checkout link can be generated without strict runtime validation by the financial firewall and multi-agent quorum.
2. **Dynamic Margin Protection Firewall**: Hard-enforces a corporate price floor (default: `₹4,500.00 INR`). Requests for individual sub-floor items immediately halt text generation and pivot customers to approved executive bundle suites.
3. **3-Agent Quorum Consensus**: Before checkout delegation, three independent validation agents evaluate valuation, catalog legitimacy, and cryptographic security. A 2/3 majority consensus is strictly mandatory.
4. **Razorpay-Native Live Checkout**: Generates compliant Razorpay payment links and UPI QR codes, with real-time webhook HMAC signature verification.
5. **Multi-Channel Handshake**: Seamless transition between WhatsApp pre-negotiations and web checkout sessions with pre-authorized cryptographic parameters.

---

## 2. System Architecture Flow

```text
               ┌──────────────────────────────────────────────┐
               │    Inbound Shopper Request / WhatsApp Hook   │
               └──────────────────────┬───────────────────────┘
                                      │
                                      ▼
               ┌──────────────────────────────────────────────┐
               │         JWT & Identity Enclave Parser        │
               │    Extracts authenticated buyer credentials  │
               └──────────────────────┬───────────────────────┘
                                      │
                                      ▼
               ┌──────────────────────────────────────────────┐
               │          Dynamic Enclave Evaluation          │
               │   Loads CURRENT_FLOOR (₹4,500) & BUNDLE MATRIX│
               └──────────────────────┬───────────────────────┘
                                      │
                ┌─────────────────────┴─────────────────────┐
                │                                           │
      [ Valuation < Floor ]                       [ Valuation >= Floor ]
                │                                           │
                ▼                                           ▼
┌───────────────────────────────┐           ┌───────────────────────────────┐
│      Financial Firewall       │           │     3-Agent Quorum Engine     │
│   KILL_TEXT_PROCESSING_LOOP   │           │ 1. Valuation Auditor Agent    │
│  Instant Stream Interception  │           │ 2. Catalog Policy Agent       │
└───────────────┬───────────────┘           │ 3. Security Signer Agent      │
                │                           └───────────────┬───────────────┘
                ▼                                           │
┌───────────────────────────────┐                           ▼ [ Quorum >= 2/3 ]
│    Strict JSON Cross-Sell     │           ┌───────────────────────────────┐
│ Rejection Envelope pivoting   │           │  Conversational Suppression   │
│ to verified Executive Suites  │           │ Drops chat text, locks final  │
└───────────────┬───────────────┘           │ terms into structured payload │
                │                           └───────────────┬───────────────┘
                │                                           │
                │                                           ▼
                │                           ┌───────────────────────────────┐
                │                           │    Razorpay Checkout Engine   │
                │                           │ Payment Links / UPI / QR Core │
                │                           └───────────────┬───────────────┘
                │                                           │
                ▼                                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                      Cryptographic Audit & Telemetry                      │
│        (Non-repudiation ledger, blocked mutations, and order states)       │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Key Capabilities & Functional Modules

### A. Autonomous Margin Protection Firewall
- **Real-Time Threshold Gate**: Evaluates requested valuations against `CURRENT_FLOOR` (`₹4,500 INR`).
- **Stream Termination**: Bypasses catalog lookups to abort processing immediately when sub-floor prices are detected.
- **Strict JSON Rejection Envelope**:
  ```json
  {
    "status": "BLOCKED_BY_DYNAMIC_FIREWALL",
    "current_floor": 4500.00,
    "message": "Welcome to our executive suite showroom. Standalone sub-tier items are unavailable; we invite you to explore our certified productivity suites:",
    "authorized_cross_sell_bundles": [
      { "name": "Work & Focus Audio Bundle", "sku": "BUNDLE_HP_MS", "valuation_inr": 6500.00 },
      { "name": "Developer Complete Suite", "sku": "BUNDLE_LAP_MS", "valuation_inr": 51500.00 }
    ]
  }
  ```

### B. 3-Agent Quorum Consensus
Every authorized transaction must be evaluated and signed off by:
1. **`agent_valuation_auditor`**: Verifies minimum gross margins and mathematical price integrity.
2. **`agent_catalog_policy`**: Verifies product SKUs, stock allocations, and bundle pairing legality.
3. **`agent_security_signer`**: Validates session integrity, token nonce, and buyer authentication.

### C. Razorpay Live Checkout Delegation
Upon reaching consensus, the orchestrator suppresses conversational banter and emits a deterministic execution schema:
```json
{
  "tool": "generate_secure_checkout",
  "gateway_config": {
    "provider": "RAZORPAY_LIVE",
    "currency": "INR",
    "success_url": "https://yourstartup.com"
  },
  "parameters": {
    "buyer_id": "staging_buyer_10",
    "item_id": "BUNDLE_HP_MS",
    "final_price_inr": 6500.00
  }
}
```

### D. Full Order Lifecycle & Invoicing
- **Verified Order Ledger**: Live tracking of paid, pending, and completed transactions.
- **Official Tax Invoices**: Downloadable PDF and printable tax receipts with GST calculations.
- **Order Management & Deletion**: Safe order deletion with a dedicated in-app confirmation modal and multi-identifier backend resolution.
- **Dual-Theme Support**: Dark and Light themes with WCAG AA compliance and instant local preference persistence.

---

## 4. Repository Directory Structure

```text
├── .github/
│   └── workflows/
│       └── tests.yml            # CI pipeline executing automated Python test suites
├── frontend/
│   ├── app.js                   # Client logic, theme manager, telemetry, order ledger
│   ├── index.html               # Responsive single-page interface with dual-theme styling
│   ├── modal.js                 # Approval and transaction modal controllers
│   └── razorpay-checkout.js     # Client Razorpay checkout integration
├── models/
│   ├── bundle.py                # Bundle data models and catalog schemas
│   ├── intent.py                # Buyer intent structure & state machines
│   └── order.py                 # Order representations and database schemas
├── src/
│   ├── db/
│   │   ├── index.ts             # Resilient Cloud SQL PostgreSQL connection pool (scale-to-zero safe)
│   │   ├── schema.ts            # Drizzle ORM schemas (merchants, orders, audits, products)
│   │   ├── queries.ts           # Type-safe database queries and merchant synchronization
│   │   └── drizzle.config.ts    # Drizzle schema migrations and pool definitions
│   ├── middleware/
│   │   └── auth.ts              # Firebase auth token verification and merchant RBAC
│   └── services/
│       ├── cartService.ts       # Multi-merchant session shopping cart logic
│       └── shippingService.ts   # India Post / BlueDart pincode lookup and ETA tracking
├── tests/
│   ├── test_api.py              # API endpoint validation and mock transactions
│   ├── test_payment.py          # Razorpay signature and checkout unit tests
│   ├── test_persistence.py      # Ledger persistence and mutation block testing
│   └── test_webhook.py          # Razorpay webhook HMAC validation tests
├── .env.example                 # Template for required environment variables
├── .gitignore                   # Rigorous exclusion of secrets, logs, and artifacts
├── main.py                      # FastAPI core engine and quorum validation routes
├── package.json                 # Node.js dependencies and compilation scripts
├── payment.py                   # Razorpay API client and webhook signature verifier
├── policy.py                    # Financial firewall rules and corporate floor checks
├── requirements.txt             # Python runtime dependencies
├── server.ts                    # Production TypeScript/Express orchestrator server
└── tsconfig.json                # TypeScript compiler configuration
```

---

## 5. Security & Governance Architecture

### Strict GitHub Push Protection (Safe by Design)
This repository includes a strict security policy configured in `.gitignore`:
- **Zero Secret Exposure**: `.env`, credentials, private keys (`.pem`, `.key`), and certificates are strictly ignored.
- **No Runtime State in Git**: Transaction logs (`intents.json`, `audit_logs.json`, `persistence_logs.json`) are blocked from commits.
- **No Build Artifacts**: `node_modules/`, `dist/`, and virtual environments (`.venv/`) are excluded.

### Threat Model & Safeguards
- **HMAC-SHA256 Signature Verification**: All Razorpay webhooks require cryptographic signature verification using `RAZORPAY_WEBHOOK_SECRET`.
- **Data Sanitization**: Internal execution labels and sensitive descriptors are masked as `[PROTECTED]` across all outward-facing API streams.
- **Deterministic Enclave**: Critical financial bounds (`CURRENT_FLOOR`) are evaluated dynamically in isolated runtime contexts.

---

## 6. Environment Configuration

Copy the template file to configure your local or deployment environment:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | Optional | `3000` | Application HTTP server port |
| `CURRENT_FLOOR` | Yes | `4500` | Corporate baseline price floor in INR |
| `CORPORATE_MINIMUM_PRICE_FLOOR_INR` | Yes | `4500` | Fallback parameter for policy validation |
| `ACTIVE_MATRIX` | Yes | `[...]` | JSON array of approved product bundles |
| `RAZORPAY_KEY_ID` | Yes | `rzp_test_...` | Razorpay API Key ID |
| `RAZORPAY_KEY_SECRET` | Yes | - | Razorpay API Key Secret |
| `RAZORPAY_WEBHOOK_SECRET`| Optional | - | Webhook HMAC verification secret |
| `WHATSAPP_VERIFY_TOKEN` | Optional | - | Meta/WhatsApp Webhook token |
| `SQL_HOST` | Required for DB | `127.0.0.1` | Cloud SQL PostgreSQL host address |
| `SQL_USER` | Required for DB | `postgres` | PostgreSQL database username |
| `SQL_PASSWORD` | Required for DB | - | PostgreSQL database user password |
| `SQL_DB_NAME` | Required for DB | `commerce_db` | PostgreSQL database instance name |

---

### Cloud SQL Resilient Connection Pooling

In serverless and scale-to-zero environments (such as Google Cloud SQL Developer tier), the database server automatically reaps idle connections with PostgreSQL termination code `57P01` (`terminating connection due to administrator command`).

The engine is engineered with resilient pooling in `src/db/index.ts`:
- **Dynamic Connection Scale (`min: 0`)**: Connections scale to zero during inactivity so the database can hibernate or rotate cleanly.
- **Client-Side Idle Eviction (`idleTimeoutMillis: 10000`)**: Idle connections are retired client-side before server administrator timeouts trigger.
- **Graceful Lifecycle Interception**: Benign administrator reap events (`57P01`, `ECONNRESET`) are handled gracefully without application crashes or fatal error logs.
- **Automatic On-Demand Reconnection**: Fresh connections are provisioned automatically whenever subsequent queries arrive.

---

## 7. Installation & Quickstart

### Prerequisites
- **Node.js**: v20 or newer
- **Python**: v3.10 or v3.12+
- **npm** or **bun**

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/your-username/autonomous-commerce-orchestrator.git
cd autonomous-commerce-orchestrator

# Install Node.js dependencies
npm install

# (Optional) Install Python dependencies for core validation tests
python3 -m pip install -r requirements.txt
```

### 2. Run the Development Server
```bash
npm run dev
```
The server starts at `http://localhost:3000` with hot-reloading and live compilation.

### 3. Build for Production
```bash
npm run build
npm start
```

---

## 8. API Reference Guide

### Core Orchestration
- **`POST /orchestrate`**  
  Primary endpoint handling conversational shopping, financial firewall gating, quorum validation, and checkout delegation.
  - *Header*: `Authorization: Bearer <JWT_TOKEN>`
  - *Body*: `{"message": "I want to purchase the Work & Focus Audio Bundle"}`

### Direct Checkout Generation
- **`POST /api/checkout/generate`**  
  Compiles verified items into signed Razorpay checkout orders.
  - *Body*: `{"item_id": "BUNDLE_HP_MS", "final_price_inr": 6500, "buyer_id": "buyer_01"}`

### Order Ledger Management
- **`GET /api/orders`**  
  Retrieves all historical verified orders, invoice statuses, and transaction receipts.
- **`DELETE /api/orders/:orderId`**  
  Deletes an order record from the ledger with multi-format ID matching.

### Telemetry & Audit Logs
- **`GET /api/audit-logs`**  
  Retrieves cryptographic logs of firewall blocks, quorum decisions, and transaction state mutations.
- **`GET /health`**  
  Reports system health, active price floor, and quorum status.

---

## 9. Automated Testing & Verification

Run the test suite to verify firewall logic, Razorpay signatures, and persistence security:

```bash
# Run all unit tests
pytest -q

# Run specific payment & webhook verification tests
pytest tests/test_payment.py tests/test_webhook.py -v
```

GitHub Actions automatically runs these tests on every push and pull request to the `main` branch.

---

## 10. Contributing & License

Contributions are welcome! Please ensure that:
1. No sensitive credentials or log files are tracked in commits.
2. All pull requests pass CI tests in `.github/workflows/tests.yml`.
3. Code formatting adheres to TypeScript and PEP 8 standards.

Distributed under the **MIT License**. See `LICENSE` for more details.
