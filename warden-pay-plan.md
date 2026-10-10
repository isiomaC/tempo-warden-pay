# Warden Pay — Colosseum Crypto World’s Fair Build Plan

**Track:** Tempo  
**Product:** Authorization infrastructure for autonomous payments  
**Hackathon:** Colosseum Crypto World’s Fair 2026  
**Submission deadline:** October 12, 2026, 11:59 PM PT  
**Internal target:** Submit by October 12, 18:00 Ireland time and keep the remaining hours as emergency buffer.

> **One-line pitch:** Warden Pay is policy-as-code for autonomous payments: it decides whether an AI agent is allowed to spend, issues signed authorization evidence, and links that decision to the resulting MPP payment on Tempo.

> **Tagline:** **Let agents spend. Never let them spend blindly.**

## 1. Product Decision

Build **Warden Pay**, not a wallet and not a new payment protocol.

Tempo and MPP already provide excellent rails for machine payments. Tempo also provides wallet/account controls and access keys. Warden Pay should sit **one layer above those primitives** and answer the higher-level question:

> **Is this specific financial action authorized under the principal’s intent and organizational policy?**

```text
Agent wants to purchase a paid API/tool/service
                    │
                    ▼
          MPP 402 payment challenge
                    │
                    ▼
             Warden Pay SDK
                    │
         Normalize payment intent
                    │
                    ▼
             Policy evaluation
          ┌─────────┼──────────┐
          │         │          │
        allow     deny      approval
          │                    │
          │             human approves
          │                    │
          └──────────┬─────────┘
                     ▼
          Signed Authorization Permit
                     │
                     ▼
               MPP payment
                     │
                     ▼
               Tempo / TIP-20
                     │
                     ▼
                  Merchant
                     │
                     ▼
       Warden settlement + audit receipt
```

### Core positioning

**Tempo = payment rail.**  
**MPP = machine-payment protocol.**  
**Tempo Wallet / Access Keys = wallet-level cryptographic guardrails.**  
**Warden Pay = organizational authorization and policy layer.**

This prevents us from competing head-on with Tempo itself, Turnkey, wallet providers, or generic spending-limit products.

---

# 2. Why This Can Stand Out

## The problem

Giving an AI agent a wallet solves *how it can pay*. It does not fully solve *whether a payment should be allowed*.

An autonomous engineering/procurement/research agent may encounter dozens of paid services. Businesses need controls such as:

- which agents may spend;
- which merchants they may pay;
- what the payment is for;
- which assets/protocols are permitted;
- per-transaction and rolling budget limits;
- when a human must approve;
- whether a payment request has changed after authorization;
- whether the same authorization is being replayed;
- evidence explaining why a transaction was approved or denied.

Wallet-level controls are necessary but intentionally low-level. Warden adds business intent.

## The wedge

Warden Pay does **semantic authorization before financial execution**.

```yaml
agent: coding-agent
allow:
  purposes:
    - model-inference
    - browser-automation
    - gpu-compute
  merchants:
    - api.example-ai.com
    - browser.example.com
  assets:
    - pathUSD
  protocols:
    - mpp

limits:
  per_transaction: 25
  daily: 50

approval_required:
  above: 20
```

This is different from only saying:

```text
This key may transfer up to 50 tokens.
```

The second is a useful wallet guardrail. The first expresses the organization’s intent.

---

# 3. Hackathon Narrative

## Submission title

**Warden Pay**

## Suggested subtitle

**Authorization infrastructure for autonomous money movement**

## Primary tagline

**Let agents spend. Never let them spend blindly.**

## Alternative tagline

**Policy-as-code for autonomous payments.**

## 30-second pitch

> AI agents are beginning to pay for APIs, compute, data, and other services autonomously. Wallets and protocols such as MPP solve payment execution, but businesses still need to decide whether each financial action is actually authorized. Warden Pay sits between agent intent and payment execution. It evaluates deterministic policy, handles approval thresholds, issues signed authorization evidence, and binds that decision to the MPP challenge and resulting Tempo settlement. Tempo moves the money; Warden proves the agent was allowed to move it.

## 90-second narrative

1. **Agents are becoming economic actors.** They can already hold wallets and pay for services.
2. **The missing layer is authorization.** A wallet can sign a valid transaction that the business never intended to permit.
3. **Warden Pay evaluates the payment before money moves.** It considers agent identity, merchant, purpose, amount, asset, budget, policy version, and approval requirements.
4. **Approved requests receive cryptographically signed authorization evidence.** The authorization is bound to the exact MPP challenge so amount/recipient/request tampering invalidates the decision.
5. **MPP executes the payment over Tempo.** Warden records the settlement and links it back to the policy decision.
6. **Tempo Access Keys provide a second line of defense.** Even the agent’s payment key can be constrained with chain-native spending and call restrictions.
7. **The result is an auditable control plane for autonomous finance.**

## Why now

- MPP provides a standard HTTP 402 flow for agents paying APIs and tools.
- Tempo explicitly supports agentic payments and agent wallets.
- Agents can transact without a human typing card details into each service.
- Authorization, auditability, limits, and organizational control become the next infrastructure layer.

---

# 4. Why Tempo

The MVP should deliberately use four Tempo-native capabilities.

### 4.1 MPP

Use **mppx**, the TypeScript SDK for Machine Payments Protocol, to perform a genuine paid HTTP request.

```text
GET /paid-resource
        ↓
402 Payment Required
        ↓
Warden evaluates the exact MPP challenge
        ↓
authorization permit
        ↓
mppx produces payment credential
        ↓
Tempo settlement
        ↓
200 OK + Payment-Receipt
```

### 4.2 TIP-20 settlement

Use **pathUSD on Tempo Moderato testnet** for the demo.

Tempo’s TIP-20 implementation provides payment-specific behavior including reconciliation memos. Current MPP tooling uses challenge-bound attribution memos, which lets Warden connect the on-chain payment to the same MPP challenge it authorized.

### 4.3 Tempo Access Keys

Use a Tempo account/access key for the demo agent rather than an unrestricted owner key.

Where feasible, configure:

- expiry;
- periodic spending limit;
- token limit;
- destination/function scoping.

Defense in depth:

```text
Layer 1: Warden semantic policy
"What is this agent trying to purchase, for whom, and is it allowed?"

Layer 2: Tempo key permissions
"What can this cryptographic key physically execute?"
```

### 4.4 Tempo Explorer

Every successful payment shown in the Warden dashboard should link to its Tempo transaction.

---

# 5. Scope Freeze

## P0 — Must exist for submission

- [ ] Agent identity
- [ ] Merchant registry
- [ ] Payment-intent normalization
- [ ] Deterministic deny-wins policy engine
- [ ] Fail-closed behavior
- [ ] Per-transaction amount limit
- [ ] Daily budget
- [ ] Merchant allowlist
- [ ] Purpose/category allowlist
- [ ] Asset/protocol allowlist
- [ ] Approval threshold
- [ ] Durable idempotency / replay protection
- [ ] Signed Warden Authorization Permit
- [ ] Permit bound to exact MPP challenge
- [ ] Tempo testnet account
- [ ] Tempo restricted access key if integration time permits
- [ ] Real MPP 402 payment using `mppx`
- [ ] Real Tempo pathUSD settlement
- [ ] Settlement receipt
- [ ] Hash-chained Warden audit ledger
- [ ] Dashboard showing intent → decision → permit → settlement
- [ ] Explicit DENIED example that produces no payment
- [ ] Human approval example
- [ ] Open-source `@stlw/warden-pay` package
- [ ] README, architecture diagram, demo instructions
- [ ] Hosted demo
- [ ] 2–3 minute pitch/demo video
- [ ] Clean Colosseum submission

## P1 — Add only after P0 is stable

- [ ] Tempo Access Key visualizer in dashboard
- [ ] Multiple policy templates
- [ ] MCP wrapper/helper
- [ ] MPP session payment example
- [ ] Policy simulator / dry run
- [ ] CLI
- [ ] Webhook event stream
- [ ] Policy decision metrics
- [ ] Merchant/category discovery
- [ ] Exportable audit bundle

## Explicitly do NOT build

- multi-chain support;
- custom blockchain;
- custom wallet;
- custom payment protocol;
- full AML/KYC system;
- AI fraud-scoring model;
- token;
- marketplace;
- generalized agent framework;
- custom smart contract unless a hard requirement appears;
- production custody;
- complex organization/RBAC administration;
- x402 support;
- mobile app;
- chain-of-thought logging.

---

# 6. Demo Scenario

Use one story everywhere: **an autonomous engineering agent buying infrastructure**.

Policy:

```text
Daily budget                     50 pathUSD
Maximum automatic transaction    20 pathUSD
Human approval required          >20 pathUSD
Allowed categories               inference, search, browser, compute
Allowed payment protocol         MPP
Allowed currency                 pathUSD
Unknown merchants                deny
Trading / wallet transfers       deny
```

### Demo A — allowed

```text
Agent: coding-agent
Merchant: sandbox.demo.wardenpay.dev
Amount: 3.20 pathUSD
Purpose: browser-automation
Decision: APPROVED
```

Warden signs permit → MPP pays → API returns resource → dashboard links Tempo transaction.

### Demo B — denied

```text
Agent: coding-agent
Recipient: unknown address
Amount: 420 pathUSD
Purpose: crypto-transfer
Decision: DENIED

Reasons:
- merchant not approved
- purpose not permitted
- per-transaction limit exceeded
- daily budget exceeded
```

There must be **no blockchain transaction**.

### Demo C — approval

```text
Agent: coding-agent
Merchant: gpu.demo.wardenpay.dev
Amount: 32 pathUSD
Purpose: gpu-compute
Decision: APPROVAL REQUIRED
```

Human approves in dashboard → policy is re-evaluated → new signed permit is issued → payment completes.

---

# 7. Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│                      DEMO AGENT                               │
│                  Node / TypeScript                            │
└──────────────────────────────┬────────────────────────────────┘
                               │ HTTP request
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    MPP-ENABLED MERCHANT                       │
│                     Hono + mppx/server                        │
└──────────────────────────────┬────────────────────────────────┘
                               │ 402 challenge
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    @stlw/warden-pay SDK                       │
│ parse challenge → normalize intent → authorize → execute      │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    WARDEN API                                 │
│ identity • policy • budget • approvals • permit • replay      │
└───────────────┬───────────────────────────┬───────────────────┘
                │                           │
                ▼                           ▼
┌──────────────────────────┐   ┌───────────────────────────────┐
│ PostgreSQL               │   │ Hash-chained audit ledger     │
└──────────────────────────┘   └───────────────────────────────┘
                │ allow
                ▼
┌───────────────────────────────────────────────────────────────┐
│                    WARDEN PERMIT                              │
│ signed typed authorization bound to MPP challenge digest      │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                      mppx/client                              │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    TEMPO ACCOUNT                              │
│ restricted access key • pathUSD                               │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                         TEMPO                                 │
│ TIP-20 settlement + challenge attribution                     │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
                       MPP payment receipt
```

---

# 8. Repository Structure

Use `@stlw/warden` 0.2.7 (MIT) for deterministic deny-wins policy evaluation, approval primitives, and the versioned audit-entry/hash verifier. Do not rebuild those foundations. Warden Pay adds payment-specific conditions and reason mapping, Postgres persistence, signed permits bound to MPP challenges, budget reservations/idempotency, Tempo integration, and the application. The dependency requires Node 22+ and includes an optional SQLite native dependency; verify package import in the deployment image.

Use `@stlw/warden-pay` as the package name unless the team confirms ownership of `@warden`. Keep “Warden Pay” as the product name. Disclose `@stlw/warden` as a foundation/dependency in the README and describe hackathon novelty only in the new payment work.

```text
warden-pay/
├── apps/
│   ├── api/                  # Hono API
│   ├── web/                  # React/Next dashboard
│   ├── demo-agent/           # reproducible demo runner
│   └── demo-merchant/        # MPP-paid Hono API
├── packages/
│   ├── sdk/                  # @stlw/warden-pay
│   ├── policy/               # payment conditions + reason-code mapping for @stlw/warden
│   ├── permits/              # signing + verification
│   ├── tempo/                # mppx / Tempo integration
│   ├── ledger/               # Postgres persistence adapter; use @stlw/warden verifier
│   ├── db/                   # schema + repositories
│   └── shared/               # types / schemas
├── examples/
│   └── engineering-agent/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── THREAT_MODEL.md
│   └── DEMO.md
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```

The public artifact judges should remember is:

```text
@stlw/warden-pay
```

---

# 9. Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Workspace | pnpm |
| API | Hono + Node |
| Validation | Zod |
| Database | PostgreSQL |
| DB access | Drizzle or lightweight repository layer |
| Web | React / Next.js |
| Tempo/EVM | viem |
| Machine payments | mppx |
| Tempo account tooling | `accounts` SDK where useful |
| Crypto | viem typed-data signing / Node crypto |
| Tests | Vitest |
| E2E | Playwright |
| Local runtime | Docker Compose |
| Demo network | Tempo Moderato testnet |
| Demo currency | pathUSD |

**Do not begin new work on archived `tempo.ts`.** Prefer current maintained Tempo integrations such as `viem`, `wagmi`, `accounts`, and `mppx`.

---

# 10. Domain Model

```ts
type Agent = {
  id: string
  principalId: string
  name: string
  status: 'active' | 'revoked'
  walletAddress: `0x${string}`
}
```

```ts
type PaymentIntent = {
  id: string
  agentId: string
  merchant: {
    id?: string
    realm: string
    recipient: `0x${string}`
  }
  amount: string
  asset: string
  purpose: string
  protocol: 'mpp'
  mpp: {
    challengeId: string
    realm: string
    method: string
    intent: string
    challengeDigest: `0x${string}`
    expiresAt?: string
  }
  idempotencyKey: string
  createdAt: string
}
```

```ts
type PaymentPolicy = {
  id: string
  version: number
  allowedAgents?: string[]
  allowedMerchants?: string[]
  deniedMerchants?: string[]
  allowedPurposes?: string[]
  allowedAssets?: string[]
  allowedProtocols?: Array<'mpp'>
  maxPerTransaction?: string
  budget?: {
    period: 'day'
    amount: string
  }
  approval?: {
    above: string
  }
  expiresAt?: string
}
```

```ts
type PolicyDecision = {
  id: string
  intentId: string
  outcome: 'allow' | 'deny' | 'approval_required'
  policyId: string
  policyVersion: number
  evaluatedRules: RuleResult[]
  reasonCodes: string[]
  createdAt: string
}
```

---

# 11. Authorization Permit

The permit is **authorization evidence**, not a replacement for the blockchain transaction.

```ts
type WardenAuthorizationPermit = {
  version: 1
  authorizationId: string
  principalId: string
  agentId: string
  chainId: number
  protocol: 'mpp'
  challengeDigest: `0x${string}`
  challengeId: string
  realm: string
  recipient: `0x${string}`
  asset: `0x${string}` | string
  amount: string
  purpose: string
  policyId: string
  policyVersion: number
  decisionId: string
  issuedAt: number
  expiresAt: number
  nonce: `0x${string}`
}
```

Use EIP-712 typed structured signing with a Warden authorization key.

Suggested domain:

```ts
{
  name: 'Warden Pay',
  version: '1',
  chainId: 42431
}
```

Document the trust model accurately:

- Warden evaluates policy and signs the permit.
- The SDK verifies the permit before execution.
- The MPP credential independently proves payment.
- The ledger records permit-to-settlement provenance.
- Tempo access-key restrictions provide an independent low-level spending boundary.

Do **not** claim the Warden permit is itself enforced onchain unless a verifying contract is added later.

---

# 12. Bind Warden to MPP

The permit must be generated **after receiving the MPP 402 challenge**.

```text
challengeDigest =
  keccak256(
    canonical({
      id,
      realm,
      method,
      intent,
      request,
      expires
    })
  )
```

Flow:

```text
1. SDK receives MPP challenge.
2. SDK computes challenge digest.
3. Warden evaluates that exact challenge.
4. Warden returns signed permit.
5. SDK verifies:
      permit.challengeDigest === current challenge digest
      permit not expired
      amount unchanged
      recipient unchanged
      policy outcome == allow
6. Only then may mppx fulfill the challenge.
```

The evidence chain becomes:

```text
Policy Decision
      ↓
Warden Permit
      ↓
MPP Challenge
      ↓
MPP Credential
      ↓
Tempo Transaction
      ↓
MPP Receipt
```

---

# 13. Policy Engine

No LLM decides whether money moves.

Evaluation order:

```text
1. validate intent
2. validate agent
3. validate active policy/version
4. explicit deny rules
5. merchant rules
6. purpose rules
7. protocol/asset rules
8. transaction limit
9. rolling budget
10. approval threshold
11. final decision
```

Reason codes:

```text
AGENT_REVOKED
POLICY_EXPIRED
MERCHANT_NOT_ALLOWED
MERCHANT_DENIED
PURPOSE_NOT_ALLOWED
ASSET_NOT_ALLOWED
PROTOCOL_NOT_ALLOWED
TRANSACTION_LIMIT_EXCEEDED
DAILY_BUDGET_EXCEEDED
APPROVAL_REQUIRED
DUPLICATE_INTENT
CHALLENGE_EXPIRED
CHALLENGE_CHANGED
```

---

# 14. Budget Correctness

Budget tracking must be transaction-safe.

```text
BEGIN
lock relevant budget row
reserved = successful_spend + pending_reservations
if reserved + requested > limit:
    deny
create authorization reservation
COMMIT
```

On settlement:

```text
reservation -> settled
```

On expiry/failure:

```text
reservation -> released
```

This prevents concurrent requests from overspending.

---

# 15. Approval Flow

```text
Payment intent
      ↓
approval_required
      ↓
PendingApproval created
      ↓
Human approves
      ↓
approval identity + timestamp recorded
      ↓
policy re-evaluated
      ↓
NEW signed permit issued
      ↓
payment executes
```

Re-evaluate after approval because the policy, remaining budget, challenge, or agent status may have changed.

---

# 16. Idempotency + Replay Protection

Statuses:

```text
received
evaluating
denied
approval_required
authorized
executing
settled
failed
expired
```

Rules:

- one active authorization per intent/challenge;
- nonce may only be consumed once;
- settled intent cannot execute again;
- duplicate client call returns previous decision/receipt;
- expired authorization fails closed;
- changed challenge requires a new authorization.

---

# 17. Audit Ledger

Use `@stlw/warden`'s `AuditChain`, `createAuditEntry`, and `verifyAuditChain`; do not define a second event format or hash formula. Store JSON entries in Postgres, one contiguous chain per payment intent. Map `aggregateId` to `correlationId` (the intent id). The exported bundle verifier must be standalone and must not query Postgres.

Events:

```text
INTENT_RECEIVED
POLICY_EVALUATED
PAYMENT_DENIED
APPROVAL_REQUESTED
APPROVAL_GRANTED
PERMIT_ISSUED
PAYMENT_STARTED
PAYMENT_SETTLED
PAYMENT_FAILED
```

```ts
type AuditEvent = {
  eventId: string
  eventType: string
  occurredAt: string // ISO string
  actor?: string
  correlationId?: string // intent id
  resourceId?: string
  payload: Record<string, unknown>
}
```

The library hashes its versioned canonical entry with SHA-256, including `previousHash`. Add a signed checkpoint containing the head hash and entry count, signed by the Warden authorization key. Keep an exported copy outside Postgres if it must detect database deletion of both trailing entries and their checkpoint. Verification checks the chain and checkpoint signature/count. Do not put `Date`, `Map`, or `bigint` values in payloads.

The claim is tamper-evident relative to a retained signed checkpoint, not resilient to compromise of the Warden signing key. On-chain anchoring is optional future work.

Provide:

```text
GET /v1/audit/:intentId/verify
```

Do not store hidden model chain-of-thought. Record explicit payment intent, policy inputs, and decisions.

---

# 18. Database Schema

Minimum tables:

```text
principals
agents
merchants
policies
policy_versions
budgets
budget_reservations
payment_intents
policy_decisions
approvals
authorization_permits
settlements
audit_events
idempotency_keys
```

Important uniqueness:

```text
payment_intents.idempotency_key UNIQUE
authorization_permits.nonce UNIQUE
settlements.intent_id UNIQUE
settlements.tx_hash UNIQUE
```

Where possible, decision + reservation + permit metadata + audit event should commit atomically.

---

# 19. API

```http
POST /v1/payment-intents
Idempotency-Key: ...
```

Allowed response:

```json
{
  "status": "authorized",
  "decision": {
    "outcome": "allow",
    "reasonCodes": []
  },
  "permit": {
    "authorizationId": "auth_...",
    "payload": {},
    "signature": "0x..."
  }
}
```

Denied:

```json
{
  "status": "denied",
  "decision": {
    "outcome": "deny",
    "reasonCodes": [
      "MERCHANT_NOT_ALLOWED",
      "TRANSACTION_LIMIT_EXCEEDED"
    ]
  }
}
```

Approval:

```http
POST /v1/approvals/:approvalId/approve
POST /v1/approvals/:approvalId/reject
```

Settlement:

```http
POST /v1/payment-intents/:id/settlement
```

Read APIs:

```text
GET /v1/payment-intents/:id
GET /v1/payment-intents
GET /v1/agents
GET /v1/policies
GET /v1/audit/:intentId
GET /v1/audit/:intentId/verify
```

---

# 20. Public SDK

Desired developer UX:

```ts
import { WardenPay } from '@stlw/warden-pay'

const warden = new WardenPay({
  agentId: 'coding-agent',
  apiKey: process.env.WARDEN_API_KEY!,
})

const response = await warden.fetch(
  'https://merchant.example/paid-resource',
  {
    purpose: 'model-inference',
  }
)
```

Internally:

```text
request
  → 402
  → inspect challenge
  → Warden authorize
  → verify signed permit
  → mppx fulfills payment
  → record settlement
  → return merchant response
```

Also expose:

```ts
const authorization = await warden.authorize({
  challenge,
  purpose: 'gpu-compute',
})

if (authorization.status === 'authorized') {
  await warden.pay(authorization)
}
```

---

# 21. Demo Merchant

Create your own deterministic MPP merchant with Hono + `mppx/server`.

```text
GET /free
GET /browser-session        3.20 pathUSD
GET /gpu-minute            32.00 pathUSD
GET /large-transfer       420.00 pathUSD
```

Example successful resource:

```json
{
  "resource": "browser-session",
  "sessionId": "sandbox_123",
  "expiresIn": 900
}
```

Do not depend entirely on a third-party API for the demo.

---

# 22. Tempo Access-Key Layer

Ideal structure:

```text
Owner Tempo account
        │
        └── restricted agent access key
                 │
                 ├── expiry
                 ├── token limit
                 ├── periodic spending limit
                 └── target/function/recipient restrictions
```

Pitch:

> Warden prevents semantically unauthorized payments. Tempo prevents the agent key from escaping its cryptographic boundary. Neither layer replaces the other.

If integration time becomes risky, make this P1. Do not sacrifice the real MPP flow.

---

# 23. Dashboard

Build only four screens.

## Activity

Show:

```text
agent
merchant
purpose
amount
decision
policy
Tempo tx
time
```

## Payment detail — hero screen

Show:

```text
Agent
Intent
Merchant
Amount
Policy
Decision
Authorization
MPP challenge
Tempo tx
Audit verification
```

Rule display:

```text
✓ agent active
✓ purpose allowed
✓ merchant approved
✓ asset allowed
✓ daily budget available
⚠ amount requires human approval
✓ approval granted
```

## Policy

Human-readable and raw policy.

## Pending approvals

```text
GPU Compute
32 pathUSD

[DENY]   [APPROVE]
```

---

# 24. Threat Model

## Prompt injection causes malicious purchase

Mitigation: deterministic merchant/purpose allowlists, amount limits, approval thresholds.

## Amount/recipient changed after approval

Mitigation: signed permit binds exact MPP challenge digest.

## Replay

Mitigation: nonce + expiry + unique settlement + challenge binding.

## Compromised agent access key

Mitigation: Tempo periodic spend, token, target/function/recipient restrictions.

## Warden unavailable

Mitigation: **fail closed**.

## Audit tampering

Mitigation: append-only hash chain and verification endpoint.

## Duplicate network request

Mitigation: durable idempotency state and transactional budget reservations.

---

# 25. Tests

## Policy

- [ ] allowed merchant succeeds
- [ ] unknown merchant denied
- [ ] denied merchant denied
- [ ] disallowed purpose denied
- [ ] invalid asset denied
- [ ] per-transaction limit enforced
- [ ] daily budget enforced
- [ ] approval threshold works
- [ ] deny wins
- [ ] expired policy denied
- [ ] revoked agent denied

## Permit

- [ ] signature verifies
- [ ] modified amount fails
- [ ] modified recipient fails
- [ ] modified challenge fails
- [ ] expired permit fails
- [ ] wrong chain fails
- [ ] duplicate nonce rejected

## Budget

- [ ] concurrent requests cannot exceed budget
- [ ] failed payment releases reservation
- [ ] successful payment consumes reservation
- [ ] retry does not double-reserve

## MPP

- [ ] merchant returns 402
- [ ] Warden parses challenge
- [ ] approved payment settles
- [ ] denied payment never reaches signer
- [ ] MPP receipt captured
- [ ] Tempo tx stored

## Audit

- [ ] valid ledger verifies
- [ ] altered event invalidates ledger
- [ ] missing event invalidates ledger

## E2E

- [ ] allow flow
- [ ] deny flow
- [ ] approval flow
- [ ] settlement explorer link
- [ ] audit verification

---

# 26. 2–3 Minute Demo Script

## 0:00–0:15 — problem

> Agents can already hold wallets and pay for services. But a valid wallet signature does not mean the business intended that purchase.

## 0:15–0:30 — policy

Show:

```text
Engineering Agent
Budget: 50 pathUSD/day
Auto: ≤20
Approval: >20
Allowed: AI + compute
```

> Warden turns organizational intent into deterministic payment policy.

## 0:30–0:55 — successful payment

```text
402 Payment Required

Warden:
ALLOW
auth_8f4...

MPP:
PAID

Tempo:
0x...
```

Open Tempo Explorer.

## 0:55–1:15 — denial

Attempt 420 pathUSD to unknown recipient.

```text
DENIED
merchant not allowed
transaction limit exceeded
purpose not allowed
```

> No payment credential is issued and nothing reaches the chain.

## 1:15–1:45 — human approval

32 pathUSD GPU request:

```text
APPROVAL REQUIRED
```

Approve in dashboard; transaction settles.

## 1:45–2:10 — evidence

Show:

```text
Intent
Policy
Approval
Signed authorization
MPP challenge
Tempo transaction
Audit verified
```

## 2:10–2:35 — why Tempo

> MPP gives agents a standard way to pay. Tempo gives us payment-native settlement and restricted access keys. Warden adds the organizational authorization layer above both.

## 2:35–2:55 — company

> Today this protects one agent. Tomorrow the same control plane governs fleets of autonomous workers across every financial action.

End:

> **Warden Pay — let agents spend, never let them spend blindly.**

---

# 27. Judging Strategy

Colosseum judges:

1. Functionality
2. Potential impact
3. Novelty
4. UX
5. Open-source / composability
6. Business plan / team execution

## Functionality

Prove:

- real MPP 402;
- real pathUSD;
- real Tempo transaction;
- real deny;
- real approval;
- real audit verification.

## Potential Impact

Frame the category as authorization infrastructure for:

- coding agents;
- procurement agents;
- commerce agents;
- travel agents;
- financial agents;
- enterprise workflow agents;
- machine-to-machine services.

## Novelty

Lead with:

> **Wallet permissions answer what a key can technically sign. Warden answers whether the underlying business action is authorized.**

Technical proof:

- semantic policy;
- signed authorization;
- MPP-challenge binding;
- policy-to-settlement provenance;
- Tempo Access Key defense in depth.

## UX

Developer:

```ts
await warden.fetch(url, {
  purpose: 'model-inference'
})
```

Operator:

```text
intent → rules → decision → payment → receipt
```

## Open source / composability

Open-source:

- `@stlw/warden-pay`
- policy schema
- permit schema
- MPP adapter
- demo merchant
- example agent
- threat model

## Business plan / team

Founder-market-fit narrative:

> Warden is being built by a lead software engineer experienced in shipping full-stack SaaS products, APIs, cloud infrastructure, CI/CD, and open-source AI-agent tooling. The product is part of a broader focus on making autonomous agents safe enough to operate in real systems rather than a one-off hackathon demo.

---

# 28. Competitive Positioning

| Layer | Primary job | Warden relationship |
|---|---|---|
| Tempo | payment blockchain | settlement rail |
| MPP | machine-payment protocol | payment transport |
| Tempo Accounts / Wallet | account + wallet operations | execution |
| Tempo Access Keys | key-level restrictions | cryptographic backstop |
| Generic wallet limits | restrict key spend | low-level controls |
| **Warden Pay** | authorize business intent | policy/control plane |

Memorable line:

> **Wallets secure keys. Warden secures intent.**

Alternative:

> **A wallet can prove an agent signed a payment. Warden proves the agent was allowed to make it.**

---

# 29. Business Model

## Developer

Free/open-source SDK.

## Team

Possible managed SaaS:

```text
$99–$499/month
managed policies
hosted ledger
approval workflows
analytics
webhooks
team controls
```

## Enterprise

```text
SSO/SAML
custom controls
audit exports
retention
compliance integrations
SLA
self-host/private deployment
advanced approvals
```

Potential usage pricing later:

```text
per authorization
or
per managed agent
```

Do not make token economics part of the pitch.

---

# 30. Go-to-Market

First users:

```text
developers building agents that autonomously buy APIs/tools
```

Initial distribution:

- TypeScript SDK;
- MCP wrapper;
- agent frameworks;
- MPP integrations;
- API gateway middleware.

Expansion:

```text
developer agents
      ↓
agent startups
      ↓
enterprise agent fleets
      ↓
financial/procurement automation
      ↓
general machine authorization infrastructure
```

---

# 31. README

```text
# Warden Pay

One sentence
GIF / screenshot

## Why
## Demo
## How it works
## 60-second quick start
## Architecture
## Warden Authorization Permit
## Tempo + MPP integration
## Security model
## Policy examples
## API
## Packages
## Local development
## Tests
## Hackathon build
## Roadmap
## License
```

Put a Tempo testnet transaction near the top.

---

# 32. Submission Copy

## Short description

> Warden Pay is an authorization layer for autonomous payments. It evaluates deterministic policy before an AI agent can spend, supports budgets and human approval thresholds, issues signed authorization evidence bound to the exact MPP payment challenge, and links that decision to the resulting Tempo settlement. Tempo handles machine payment execution; Warden proves the agent was allowed to make the payment.

## Problem

> Agent wallets and machine-payment protocols make autonomous spending possible, but businesses need more than valid signatures. They need to know which agent made a payment, what it was trying to purchase, whether the merchant and purpose were permitted, which policy authorized the action, whether limits were exceeded, and when a human approved the exception.

## Solution

> Warden sits between agent intent and financial execution. Every MPP challenge is normalized into a payment intent and evaluated against deterministic organizational policy. Approved actions receive signed authorization evidence; denied actions never reach the payment signer; higher-risk actions pause for human approval. Successful payments are reconciled with their Tempo settlement and preserved in a verifiable audit trail.

## Why Tempo

> Tempo is purpose-built for stablecoin payments and provides the primitives agents need to pay autonomously: MPP support, payment-specific TIP-20 behavior, account tooling, and programmable access-key controls. Warden composes with those primitives instead of replacing them. Tempo constrains what an agent key can execute; Warden expresses why a business allows the action in the first place.

## What makes it different

> Warden is not another wallet or spending-limit UI. Wallet restrictions operate at the key/transaction layer. Warden operates at the intent layer and understands the agent, merchant, purpose, policy, budget, approval state, and exact MPP challenge. That creates an authorization record that can be traced from business intent to final settlement.

---

# 33. Standout Claims

Use consistently:

1. **Wallets secure keys. Warden secures intent.**
2. **Warden is above the payment rail, not another payment rail.**
3. **Every payment has an explainable authorization path.**
4. **Warden semantic policy + Tempo cryptographic access-key limits = defense in depth.**
5. **Policy decisions are bound to the exact machine-payment challenge.**
6. **Fail closed: no valid authorization means no payment.**
7. **No LLM is in the authorization decision path. Agents can be probabilistic; money movement should not be.**

---

# 34. Build Schedule

## Phase 0 — immediate spike

Do this first.

- [ ] Tempo testnet account
- [ ] fund with pathUSD
- [ ] minimal Hono MPP-paid endpoint
- [ ] successful paid request using `mppx`
- [ ] capture receipt + tx hash
- [ ] verify in Tempo Explorer

**Do not build UI until this works.**

## Phase 1 — core policy

- [ ] monorepo
- [ ] Postgres
- [ ] agent/merchant/policy schema
- [ ] payment intent normalization
- [ ] use `@stlw/warden` deterministic engine and approval primitives
- [ ] payment-specific amount/merchant/purpose/budget conditions
- [ ] reason codes
- [ ] reservations
- [ ] idempotency

Exit:

```text
allow / deny / approval_required
```

works deterministically.

## Phase 2 — permit

- [ ] canonical challenge
- [ ] challenge hash
- [ ] EIP-712 schema
- [ ] signer
- [ ] verification
- [ ] expiry
- [ ] nonces
- [ ] tamper/replay tests

## Phase 3 — payment integration

- [ ] `@stlw/warden-pay`
- [ ] intercept 402
- [ ] authorize challenge
- [ ] verify permit
- [ ] invoke mppx
- [ ] capture receipt
- [ ] store Tempo tx
- [ ] reservation → settled

Exit:

```ts
await warden.fetch(...)
```

works end-to-end.

## Phase 4 — audit + approvals

- [ ] persist `@stlw/warden` audit entries as JSON rows, one chain per intent
- [ ] signed head-hash + entry-count checkpoint; exportable standalone bundle verifier
- [ ] approvals table
- [ ] approval endpoints
- [ ] re-evaluate after approval
- [ ] issue new permit
- [ ] audit verification

## Phase 5 — dashboard

Only:

- [ ] activity
- [ ] payment detail
- [ ] policy
- [ ] approvals

## Phase 6 — Tempo-native hardening

- [ ] restricted access key
- [ ] periodic limit
- [ ] target/function/recipient restriction if viable
- [ ] display restrictions in dashboard

## Phase 7 — submission polish

- [ ] hosted URL
- [ ] public repo
- [ ] README
- [ ] architecture diagram
- [ ] security docs
- [ ] one-command demo
- [ ] screenshots
- [ ] Tempo tx links
- [ ] video
- [ ] submission copy
- [ ] submit with several hours of buffer

---

# 35. Final Acceptance Checklist

## Core

- [ ] `pnpm install`
- [ ] `.env.example`
- [ ] DB starts and migrates
- [ ] tests pass
- [ ] merchant starts
- [ ] API starts
- [ ] dashboard starts
- [ ] demo agent starts

## Tempo

- [ ] actual testnet account
- [ ] actual pathUSD
- [ ] actual 402
- [ ] actual payment
- [ ] actual receipt
- [ ] actual Explorer transaction

## Warden

- [ ] policy changes outcome
- [ ] denial causes zero payment
- [ ] signed permit verifies
- [ ] tampering fails
- [ ] duplicate execution prevented
- [ ] budget durable
- [ ] approval flow works
- [ ] audit chain verifies

## Submission

- [ ] Tempo integration obvious in first 30 seconds
- [ ] wallet-vs-Warden distinction explicit
- [ ] credible business path
- [ ] open-source code
- [ ] excellent README
- [ ] consistent vocabulary
- [ ] no unsupported claims
- [ ] reproducible demo
- [ ] submitted before deadline

---

# 36. Protect These Five Things

If time becomes tight, protect these in order:

1. **Real MPP payment on Tempo**
2. **Policy engine that blocks a bad payment**
3. **Signed authorization bound to the MPP challenge**
4. **Great allow / deny / approve demo**
5. **Clear positioning: Warden is the authorization layer, not another wallet**

Everything else is optional.

---

# 37. Official References

- Colosseum Crypto World’s Fair: https://colosseum.com/worldsfair
- Official rules: https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf
- Tempo: https://tempo.xyz/
- Tempo agentic payments: https://tempo.xyz/solutions/agentic-payments/
- Tempo GitHub: https://github.com/tempoxyz
- Tempo core: https://github.com/tempoxyz/tempo
- Tempo Accounts SDK: https://github.com/tempoxyz/accounts
- MPP: https://mpp.dev/
- MPP repo: https://github.com/tempoxyz/mpp
- MPP TypeScript SDK: https://github.com/wevm/mppx
- MPP specs: https://github.com/tempoxyz/mpp-specs
- Tempo enhanced Access Key permissions (TIP-1011): https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md

---

# Final Product Statement

> **Warden Pay is the authorization layer for autonomous money movement.**
>
> Agents can already pay. Warden gives businesses deterministic control over **who may spend, where, how much, for what purpose, under which policy, and when a human must intervene**. Every approved action produces signed authorization evidence bound to the exact MPP challenge and linked to the eventual Tempo settlement.
>
> **Tempo moves the money. Warden proves it was allowed to move.**
