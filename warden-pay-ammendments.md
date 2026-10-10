# Warden Pay: plan amendments

Amends `Warden Pay: Colosseum Crypto World's Fair Build Plan` (Tempo track). Based on `@stlw/warden` 0.2.7 (MIT), read from its published type declarations and compiled source. Nothing here changes the protect-five list.

## 1. The plan does not mention `@stlw/warden`

The plan builds the policy engine, ledger and approvals from scratch (`packages/policy`, `packages/ledger`, Phases 1 and 4). `@stlw/warden` already ships working versions of all three. The plan should say so, use them, and list what is genuinely new.

| Plan component | Already in `@stlw/warden` 0.2.7 | Still yours to build |
|---|---|---|
| Deterministic deny-wins engine | `createWarden`, `definePolicy`. Effects `ALLOW`, `DENY`, `PENDING_APPROVAL`. Precedence DENY, then PENDING_APPROVAL, then ALLOW. No match returns DENY (`NO_MATCH`). Any thrown error returns DENY (`EVALUATION_ERROR`). Resolver timeout 1000 ms by default. Policies carry `id` and `version`. | Payment conditions (amount, set membership, budget) as an extension. Mapping to your reason codes. |
| Approvals | `createApprovalRequest`, `resolveApproval` (PENDING, APPROVED, REJECTED, with expiry and approver id). Pure functions, no storage. | Persistence, re-evaluation after approval, issuing the new permit. |
| Audit ledger and verifier | `AuditChain`, `createAuditEntry`, `verifyAuditChain(entries)`. Versioned format and canonicalization. Takes a plain array, no database. | Persisting entries (Postgres), the bundle export, the signed checkpoint (section 3). |
| Permit (EIP-712), MPP challenge binding | Nothing | All of it. This is the novelty. |
| Budget reservations, idempotency, replay protection | Nothing | All of it. |
| Tempo, mppx, SDK, dashboard, demo | Nothing | All of it. |

Effect on the schedule: Phase 1 and Phase 4 should shrink. Treat the saved time as buffer, not as new scope.

## 2. Decisions that follow

- **Adopt the existing audit shape; drop the plan's custom `AuditEvent`.** Existing fields: `eventId`, `eventType`, `occurredAt`, `payload`, optional `actor`, `correlationId`, `resourceId`. Map the plan's `aggregateId` to `correlationId` (the intent id). Replace the plan's hash formula in section 17 with the library's (`sha256` over the canonicalized entry, including `previousHash`).
- **One chain per payment intent.** `verifyAuditChain` checks one contiguous array, so per-intent chains make `GET /v1/audit/:intentId/verify` and the exported bundle trivial.
- **Express denials as DENY rules**, so each violation shows up in `matchedRules`. Demo B needs four reasons (merchant, purpose, limit, budget). Name each rule id after your reason code (`MERCHANT_NOT_ALLOWED`, and so on). The engine only reports matched rules, so the dashboard's rule checklist (the green ticks for passed rules) needs a small wrapper that evaluates each rule separately.
- **Keep ledger and verifier standalone.** The library already satisfies this. Do not wrap it in Warden-Pay or Tempo types. The verifier reads an exported JSON bundle, never Postgres. Anchoring stays an optional interface (`anchor(root)`), so it can be added later.
- **Persist entries as JSON rows in Postgres.** The library chain is in memory, and its SQLite and file stores are not what you want here.

## 3. Claims the plan makes that the ledger cannot support yet

The library's hash is unkeyed. Anyone who can write to the database can alter an entry and recompute every later hash, and the chain still verifies. Deleting trailing entries is also not detected, because the remaining prefix is consistent.

The plan's threat model (section 24, "Audit tampering: append-only hash chain and verification endpoint") and the final checklist ("no unsupported claims") overclaim as written. Fix:

- Sign a **checkpoint** (head hash plus entry count) with the Warden authorization key you already need for permits. Verification checks the chain, then the checkpoint signature and count. That catches rewrites and truncation.
- Say plainly in `SECURITY.md`: tamper-evident against edits and truncation of signed checkpoints, not against a compromised signing key.
- Later, anchoring the checkpoint on a chain gives independent evidence. That is the Monad idea, and it is a thin step on top of this.

Canonicalization gotchas in the library: `Date` and `Map` values silently serialize as `{}` and `bigint` throws. Keep amounts as strings (the plan already does) and timestamps as ISO strings.

## 4. Practical risks to test in the Phase 0 spike

Add a 30-minute check:

1. `pnpm add @stlw/warden` inside the monorepo and import it in `apps/api`.
2. It requires **Node 22 or later**. Use a `node:22` base image and confirm the hosted demo platform runs Node 22.
3. It depends on `better-sqlite3` (a native module). pnpm 10 skips dependency build scripts by default. Confirm the import works in Docker without it, or allow the build in `onlyBuiltDependencies`.

## 5. Naming

`@warden/pay` returned 404 on the npm registry, but that does not show you own the `@warden` scope. Your published family is `@stlw/warden*`, and `@stlw/warden-pay` is also unclaimed (404). Use `@stlw/warden-pay` unless you control `@warden`. Keep "Warden Pay" as the product name.

## 6. Rules and framing

- `@stlw/warden` is a published, MIT-licensed package with a history older than the hackathon. Colosseum's rules are unread (follow-up w1). Check what they say about prior code, then declare it in the README as a dependency and foundation.
- Keep the hackathon commits to the new work (permit, MPP binding, budgets, Tempo, dashboard). Pitch novelty on those, not on the policy engine or ledger.
- This is a strength for the open-source and composability criteria, and for the team narrative.