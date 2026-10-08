# Domain model and terminology

Status: agreed Phase 0 contract, 2026-10-07. Persisted identifiers below match current source; session states are a required future implementation contract.

## Entities

| Term | Definition / boundary |
| --- | --- |
| Account | Authenticated owner of products, identities, sessions and data. Current source is personal account scope, not a shared team workspace |
| Product | Owned venture with stage, goals, metrics and separate building budget |
| Stage | `IDEA`, `PROBLEM_VALIDATION`, `SOLUTION_VALIDATION`, `PRE_LAUNCH`, `LAUNCHED_ZERO_USERS`, `EARLY_USERS`, `FIRST_REVENUE`, `PRODUCT_MARKET_SIGNAL`, `GROWTH` |
| Device/session | Registered client and revocable authentication credential; one does not authorize another owner's product |
| Tool/classification | Application/domain metadata labelled `BUILD`, `GROWTH`, `NEUTRAL`, `CONTEXTUAL`, `BLOCKED`, `ALLOWED`; labels alone do not enforce access |
| Rule/guard | Versioned deterministic policy. A guard is a policy condition/enforcement constraint, not an additional independently authoritative engine |
| Override | Scoped, expiring ALLOW/BLOCK exception with reason, revocation and audit |
| Build Credit | Integer unit of one minute; product-scoped ledger with grant lots, expiry and reservations; not money or a subscription entitlement |
| Build session | Required authoritative reservation and metered usage lifecycle shared across devices; integration is currently missing |
| Growth task | Stage-specific or custom market action with an occurrence, reward and completion record |
| Evidence | Private submission supporting a completion; provenance, review outcome and source trust are separate fields |
| Market signal | Measured growth outcome with identified source/trust; a user claim is not provider-authenticated truth |
| Integration | Scoped vendor or owner-controlled source with revocable credentials and normalized events |
| Billing entitlement | Allowed paid feature derived from recognized configured prices/subscription state; separate from growth rewards |

## Ownership and relationships

Account -> products, devices, sessions, privacy preferences and consents. Product -> stage history, goals, metrics, tasks, rules, wallet and integrations. Task -> completion -> evidence and at most one reward effect per accepted completion. Wallet -> immutable-style transaction history plus mutable allocation/reservation reconciliation. Event -> owned product/device or scoped integration, with stable deduplication identity.

No cross-account foreign-key association, lookup or update may succeed. Multi-device operations share authoritative account/wallet locks and idempotency keys. Privacy erasure may remove owned history; append-oriented ledger does not mean personal data is kept forever.

## Shared product state machine (target)

| State | Entry / transition |
| --- | --- |
| AVAILABLE | Fresh usable policy and available product budget; successful reservation enters BUILDING |
| BUILDING | Account authorized, reservation valid, usage metered; warning threshold enters WARNING |
| WARNING | Near policy/budget limit; continued exhaustion enters BUILD_LIMIT_REACHED |
| BUILD_LIMIT_REACHED | Settle permitted usage and deny further configured building; enter GROWTH_REQUIRED |
| GROWTH_REQUIRED | Explain restriction and offer tasks; starting action enters GROWTH_ACTION_STARTED |
| GROWTH_ACTION_STARTED | Completing the task creates a claim; evidence submission enters EVIDENCE_SUBMITTED |
| EVIDENCE_SUBMITTED | Pending review; rejection requires new evidence, accepted review enters EVIDENCE_VERIFIED |
| EVIDENCE_VERIFIED | Transactional idempotent reward creates BUILD_CREDIT_GRANTED |
| BUILD_CREDIT_GRANTED | Reevaluate budget/policy; enter AVAILABLE only if both permit access |

These are derived product journey states, not replacements for every existing SQL status. Actual goal/task status is `ACTIVE`, `COMPLETED`, `CANCELLED`; completion status includes `SELF_REPORTED`, `AWAITING_EVIDENCE`, `AWAITING_REVIEW`, `VERIFIED`, `AUTOMATICALLY_VERIFIED`, `REJECTED`. Automatic verification is schema capacity, not an implemented provider capability. Evidence status is `PENDING`, `VERIFIED`, `REJECTED`; deleting evidence erases content and preserves only necessary review/reward metadata until account deletion.

Additional dimensions: `PAUSED`, `EMERGENCY_BYPASS`, `OFFLINE_ENFORCEMENT`, `INTEGRATION_ERROR`, `POLICY_DISABLED`. Connectivity, evidence progress and enforcement are separate dimensions; a provider error must not imply that an existing task is verified. Emergency bypass is locally available and bounded. Invalid/expired policy yields visibly paused enforcement, not a fabricated ALLOW decision from a trusted engine.

The server/session contract and shared reducer must define legal transitions, reservation recovery, rounding, repeated/out-of-order events and audit output. Current code implements rules and task/ledger pieces, not this complete state machine. Add parity tests before clients adopt it.
