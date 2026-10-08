# Threat model

Status: agreed Phase 0 threat baseline, 2026-10-07. Source review is not a penetration test or runtime acceptance.

## Assets, actors and boundaries

Protect account/session credentials, provider tokens, evidence bytes, private activity, wallet integrity, subscription entitlements, policy signing/updater keys, deployment secrets and recovery copies. Actors include another account, malicious website/extension renderer, forged webhook source, replaying client, compromised provider, privileged operator and account owner manipulating their own device.

Boundaries: browser/API; owner/product/device data; web cookies/CSRF; bearer clients; desktop renderer/main/native host; provider ingress; database/Redis; operator/deploy path; signed policy/update channel; off-host backup. Local administrator control is outside guaranteed enforcement: consent, emergency exit and client removal remain available. Do not promise tamper-proof blocking.

## Risks and required acceptance

| Severity | Threat | Control and evidence |
| --- | --- | --- |
| Critical | Account takeover/session replay | One-use token expiry, password protections, OAuth state/PKCE, CSRF, rotation/revocation and rate-limit runtime tests |
| Critical | Cross-account evidence/export/admin access | Ownership checks on every path, constrained joins, roles, audited mutations and negative two-account API tests |
| Critical | Concurrent reward/spend forgery | Row locks, stable idempotency, one reward per completion and concurrent PostgreSQL tests |
| Critical | Forged/rolled-back policy or offline double-spend | Signed scoped snapshots, expiry/version checks and bounded server reservations; currently missing complete mechanism |
| Critical | Updater/deployment/backup compromise | Signed artifacts, approved immutable release, least privilege, secret isolation, encrypted remote backup and restore verification |
| Critical | Billing entitlement or webhook forgery | Vendor signature validation, replay/idempotency, recognized configured prices and test-mode transitions |
| High | Desktop navigation/IPC/native-host injection | Exact trusted sender/navigation validation, bounded native messages and hostile renderer tests |
| High | Secrets through attributes/logs/uploads | Semantic event allowlists, log redaction, private retrieval, upload limits/type validation and malware-risk assessment |
| High | Provider payload prompt injection/SSRF | Treat all evidence/provider content as untrusted data; constrained schemas and outbound requests; AI never executes tools or changes policy/rewards |
| High | Retention/consent/delete failure | Transaction/race tests, scheduler retries, external cleanup handling and restore re-erasure |
| High | Disable/rename client to avoid restrictions | Visible health and truthful limits; platform identity tests; owner decision on acceptable voluntary enforcement |
| Medium | Clock changes, downtime and resource exhaustion | Monotonic timing where feasible, signed expiry, queue/rate/size bounds, timeout/load and degraded-state tests |

Current known limits: unsigned desktop cache, unencrypted extension-local bearer token, executable name-based identity, owner evidence review, absent vendor adapters, no public update/production acceptance and no external alert delivery. None is cleared by creating this model.

## Review and residual risk

Attach each finding to a reproduction, affected release, severity, fix and retest. Fix confirmed critical/high security vulnerabilities before rollout. Document product safety decisions separately from vulnerability closure. Revisit the model when adding provider scopes, new event types, shared teams, storage, admin permissions or updater/deployment paths.
