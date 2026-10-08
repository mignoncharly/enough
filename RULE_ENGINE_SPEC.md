# Rule engine contract

Status: agreed Phase 0 contract, 2026-10-07. Current deterministic rules behavior is grounded in `packages/shared/src/policy-rules.ts`; credit-session integration remains required.

## Evaluation

Input: normalized tool kind/key, resolved classification, owned product/device scope, bounded context and one evaluation timestamp. Snapshot: enabled, unarchived rules and non-revoked overrides belonging to the account. Same snapshot, input and instant must produce identical decision fields regardless of source array order.

Match supplied condition fields with AND; values within classification/tool arrays use OR. Scope must match. Schedule uses IANA timezone and selected weekdays; starts are inclusive and ends exclusive. Same start/end covers the whole selected day. An overnight interval carries into the next day from the selected start weekday. Repeated DST wall times follow the stored timezone mapping; include boundary tests.

Overrides precede rules. Override rank: scope/exact-key specificity descending, newest creation first, BLOCK before ALLOW for a tie, then ID ascending. Rule rank: priority descending, specificity descending, restrictiveness BLOCK > REQUIRE_OVERRIDE > WARN > ALLOW, then ID ascending. Specificity follows the shared implementation's field weights; changing weights is a versioned behavior change.

No matching rule defaults to ALLOW. WARN allows with warning; BLOCK and REQUIRE_OVERRIDE deny unless an applicable higher-ranked override allows. Result identifies source, matching rule/version or override, normalized time and reason. Product stage guidance never silently becomes a rule.

## Budget and safety (required target)

The final session access decision composes deterministic policy with server-authoritative product budget/reservation and client health. A rule ALLOW does not itself mint credit. Session spend/expiry/release must be atomic and retry-safe across devices. Emergency access is a distinct bounded state with reason and audit, not a reward or subscription upgrade.

Offline metering requires bounded prepaid reservation, signed expiring snapshot, verified device/product scope and replay/clock defenses. No local duplicate grant or overspend is allowed. Existing queues are bounded to 1,000 events and seven days; policy cache is usable for at most 24 hours subject to clock checks. These limits do not define reserved credit duration or rounding, which must be specified with the session implementation.

## Snapshot target

Define a canonical serialized payload with schema version, issuer/key ID, subject/product/device, monotonically versioned policy, issued/expiry time, rules/overrides and approved offline reservation references. Verify signature before use. Reject wrong scope, malformed, expired, rollback/replayed or unsupported payloads. Rotate keys with a tested verification overlap and revocation plan. Algorithm and key storage are implementation decisions for the signed-policy remediation task.

## Acceptance

Test deterministic ordering, invalid inputs, unknown tools, exact/wildcard matching, timezone/DST and overnight boundaries, override expiry/revocation, rule version conflicts, same-input parity across API/desktop/extension, budget exhaustion, double-spend, offline replay and emergency recovery. Source tests alone cannot demonstrate actual browser/native blocking.
