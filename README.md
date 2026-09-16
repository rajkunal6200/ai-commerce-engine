# Autonomous Dynamic Commerce Orchestrator (Phase 7 Enterprise Staging Core)

> **Agentic commerce orchestrator with dynamic financial firewalls, multi-agent quorum consensus, and deterministic Razorpay-native checkout delegation.**

---

## 1. System Architecture Overview

The **Autonomous Dynamic Commerce Orchestrator** separates conversational understanding from financial execution authority. AI agents reason about buyer intent, guide product recommendations, and manage interactive negotiation, but the underlying system deterministically guards floor prices, enforces cryptographic token verification, evaluates multi-agent consensus, and generates immutable audit trails.

```text
[ Shopper Request / Inbound Agent Message ]
                    │
                    ▼
       ┌─────────────────────────┐
       │   JWT Session Parser    │ ➔ Extracts cryptographically validated `buyer_id`
       └────────────┬────────────┘
                    │
                    ▼
       ┌─────────────────────────┐
       │ Dynamic Enclave Config  │ ➔ Loads CURRENT_FLOOR (₹4,500 INR) & ACTIVE_MATRIX
       └────────────┬────────────┘
                    │
                    ├─────────────────────────────────────────────────┐
                    │                                                 │
          [ Price < Current Floor ]                        [ Price >= Current Floor ]
                    │                                                 │
                    ▼                                                 ▼
       ┌─────────────────────────┐                       ┌─────────────────────────┐
       │   Financial Firewall    │                       │   3-Agent Quorum Engine │
       │ KILL_TEXT_PROCESSING_   │                       │ (Valuation + Catalog +  │
       │          LOOP           │                       │    Security Signer)     │
       └────────────┬────────────┘                       └────────────┬────────────┘
                    │                                                 │
                    ▼                                                 ▼ [ Consensus >= 2/3 ]
       ┌─────────────────────────┐                       ┌─────────────────────────┐
       │  Strict JSON Broadcast  │                       │ Conversational Buffer   │
       │ (Cross-sell to Suites)  │                       │      Suppression        │
       └────────────┬────────────┘                       └────────────┬────────────┘
                    │                                                 │
                    │                                                 ▼
                    │                                    ┌─────────────────────────┐
                    │                                    │ Razorpay Live Checkout  │
                    │                                    │  generate_secure_       │
                    │                                    │       checkout          │
                    │                                    └────────────┬────────────┘
                    │                                                 │
                    ▼                                                 ▼
       ┌───────────────────────────────────────────────────────────────────────────┐
       │                    Cryptographic Persistence Telemetry                    │
       │               (persistence_logs.json / MUTATION_BLOCKED / AUDIT)          │
       └───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Operational Principles

1. **AI Decides, System Authorizes**: AI cannot execute transactions, alter catalog prices, or lower baseline margins below the corporate floor.
2. **Container-Isolated Dynamic Runtime**: System parameters (`CURRENT_FLOOR`, `CORPORATE_MINIMUM_PRICE_FLOOR_INR`, and `ACTIVE_MATRIX`) are dynamically evaluated on every execution cycle without requiring service restarts.
3. **Data Isolation & Sanitization**: Internal execution labels, benchmark files, and private keys (e.g. `SHA256`, `locustfile`, `Rule 1`, `Rule 2`) are replaced with `[PROTECTED]` across all outward-facing data streams.
4. **Conversational Buffer Suppression**: On verified purchase confirmation, conversational text streaming is terminated, emitting solely the pure structured checkout delegation payload.

---

## 3. Key Modules & Functional Capabilities

### A. Container Runtime & Identity Resolution
- **Header Parsing**: Extracts authenticated shopper metrics (`buyer_id`) directly from standard `Authorization: Bearer <JWT>` session headers.
- **Dynamic Configuration Enclave**:
  - `CURRENT_FLOOR`: Minimum corporate baseline (default `4500.00` INR).
  - `ACTIVE_MATRIX`: Synchronized bundle suites with verified margins.

### B. Financial Firewall & Stream Interception
- **Real-Time Threshold Evaluation**: Continuously validates user budget intents and demanded valuations against `current_floor`.
- **Stream Termination**: Immediately halts `KILL_TEXT_PROCESSING_LOOP` whenever sub-floor metrics are detected, bypassing catalog searches to sustain maximum concurrent throughput.
- **Strict JSON Broadcast Envelope**: Returns a structured rejection payload pivoting shoppers to authorized executive bundles:
  ```json
  {
    "status": "BLOCKED_BY_DYNAMIC_FIREWALL",
    "current_floor": 4500.00,
    "message": "Welcome to our executive suite showroom. We specialize exclusively in synchronized, high-performance workstation packages tailored for uninterrupted productivity. Standalone sub-tier items are unavailable; we invite you to explore our certified productivity suites:",
    "authorized_cross_sell_bundles": [
      { "name": "Work & Focus Audio Bundle", "sku": "BUNDLE_HP_MS", "valuation_inr": 6500.00 },
      { "name": "Developer Complete Suite", "sku": "BUNDLE_LAP_MS", "valuation_inr": 51500.00 }
    ]
  }
  ```

### C. 3-Agent Quorum Consensus Scanner
Before checkout compilation, an automated internal evaluation is performed by three independent validation agents:
- **`agent_valuation_auditor`**: Enforces strict adherence to corporate floor requirements and pricing bounds.
- **`agent_catalog_policy`**: Verifies item availability, SKU legitimacy, and bundled asset compatibility.
- **`agent_security_signer`**: Checks token signature validity, session state consistency, and identity integrity.

Only transactions securing a **$\ge 2/3$ majority consensus** proceed to checkout delegation.

### D. Razorpay-Native Checkout Delegation
When a compliant purchase confirmation is detected, the orchestrator suppresses conversational chatter and outputs the raw, deterministic execution tool invocation:

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

### E. Cryptographic Audit & Telemetry Logging
- **`persistence_logs.json`**: An append-only audit trail logging every interception (`MUTATION_BLOCKED`), quorum vote matrix, and checkout confirmation.
- Each event includes timestamps, evaluated prices, agent votes, consensus status, and shopper identity hashes.

---

## 4. API Endpoints Reference

| Route | Method | Description |
|---|---|---|
| `/orchestrate` | `POST` | Core orchestrator endpoint handling multi-turn negotiation, firewall enforcement, quorum scanning, and tool delegation. |
| `/conversational-shop` | `POST` | Conversational shopping endpoint with session memory and dynamic cross-sell pivoting. |
| `/api/checkout/generate` | `POST` | Direct tool compilation endpoint with quorum evaluation and Razorpay configuration. |
| `/api/buyer/profile` | `GET` | Authenticated shopper profile and identity details. |
| `/api/merchant/dashboard` | `GET` | Merchant metrics, active policy rules, and revenue performance. |
| `/api/merchant/inventory` | `GET` | Catalog inventory, stock allocations, and bundle definitions. |
| `/api/merchant/revenue-agent` | `GET` | Revenue intelligence recommendations and margin optimizations. |
| `/api/audit-logs` | `GET` | Historical cryptographic audit log entries. |
| `/health` | `GET` | Enclave health, active floor parameter, and subsystem status. |

---

## 5. Active Inventory Matrix

| Bundle Name | SKU | Included SKUs | Standard Valuation (INR) |
|---|---|---|---|
| **Work & Focus Audio Bundle** | `BUNDLE_HP_MS` | `HP001`, `MS001` | ₹6,500.00 |
| **Developer Complete Suite** | `BUNDLE_LAP_MS` | `LAP001`, `MS001` | ₹51,500.00 |

*Baseline Corporate Floor*: **₹4,500.00 INR** (Standalone sub-tier items under this threshold are blocked by the Financial Firewall).

---

## 6. Development & Deployment Guide

### Prerequisites
- Node.js (v20+ recommended)
- npm / npx

### Setup & Run
```bash
# Install dependencies
npm install

# Start development server with live compilation
npm run dev

# Build for production (compiled to dist/server.cjs)
npm run build

# Start production server
npm start
```

### Environment Variables (`.env`)
```env
PORT=3000
CURRENT_FLOOR=4500
CORPORATE_MINIMUM_PRICE_FLOOR_INR=4500
RAZORPAY_KEY_ID=rzp_test_placeholder
RAZORPAY_KEY_SECRET=placeholder_secret
ACTIVE_MATRIX=[{"name":"Work & Focus Audio Bundle","sku":"BUNDLE_HP_MS","valuation_inr":6500},{"name":"Developer Complete Suite","sku":"BUNDLE_LAP_MS","valuation_inr":51500}]
```

### Verification & Testing Commands
```bash
# Test sub-floor firewall interception (Returns strict JSON rejection envelope)
curl -s -X POST http://localhost:3000/orchestrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"message":"Can I buy mouse for 1200 INR?"}'

# Test compliant bundle checkout delegation (Returns Razorpay tool call)
curl -s -X POST http://localhost:3000/orchestrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"message":"I confirm order for Work & Focus Audio Bundle BUNDLE_HP_MS at 6500"}'
```

---

## 7. Security & Compliance Safeguards

- **No Financial Hallucination**: AI model outputs cannot bypass minimum floors or generate unapproved discount codes.
- **Zero Raw PII Exposure**: Header authorization tokens are parsed safely, with internal runtime descriptors sanitized as `[PROTECTED]`.
- **Deterministic Quorum Gates**: No single agent or user prompt can trigger transaction execution without multi-agent validation.
- **Idempotent Audit Persistence**: State transitions and blocked mutations are committed to disk synchronously to preserve full forensic tracebility.
