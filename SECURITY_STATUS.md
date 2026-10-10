# Security Status

Last updated: 2026-10-10

## Current status

**Final Phase 2 review: PASS.** This update supersedes the historical Phase 2
pending-provider/client statements below. Real Google/GitHub and installed
Desktop D1–D3, Chrome E1–E3 and Firefox E1–E3 are accepted from user reports.
49 isolated integration checks and 68 default tests pass, as do typecheck,
format and lint. The working tree includes the OAuth preregistration-password
takeover fix and Drizzle 0.45.2; evidence is in `PHASE_2_ACCEPTANCE.md` and
`PHASE_2_ENGINEERING_VERIFICATION.md`. No remaining Phase 2 blocker was found.

The dependency audit is **not clean**: 18 open entries (3 critical / 8 high /
7 moderate), explicitly assigned to native installer, test-runner, schema-tool
and packaging remediation gates in `PHASE_2_DEPENDENCY_SECURITY.md`. Reviewed
reachability does not expose a Phase 2 auth path; this is no release waiver.
Phase 2 is formally accepted at `fd9bc2467bf4daeca9e80e1287029310d4ee2f7c`.
Phase 3 is COMPLETE: 18 isolated onboarding integration checks and 68 default
tests pass, including ownership, forged IDs, CSRF/origins, invalid inputs and
concurrent saves. The optimized web build and quality checks pass; P3-1–P3-6
browser acceptance is PASS by explicit user report, 2026-10-09, in
`PHASE_3_ACCEPTANCE.md`; checkpoint `e07f502a90aaa85a22ad2f70647b8ca9bd234a4d` is accepted. No dependencies,
lockfile, existing credentials or protected runtime files changed. The 18 audit
entries above remain open; no new audit or release waiver is claimed. The overall
product remains **NO-GO**; later security/distribution/production work is required.

**Phase 4 formally COMPLETE, 2026-10-10.** P4-1–P4-5 all PASS by explicit user
report, with no browser acceptance failures. Twenty-six
product integration checks plus all 18 onboarding regressions pass on disposable
Windows PostgreSQL/WSL Redis with the live API/web proxy. They cover ownership,
CSRF, validation/rollback, concurrent primary goals/traction, stale stage/goal/metric
writes, export and deletion/cascades. Product changes now synchronize the linked
onboarding profile in the same transaction. Optional expected-value fields preserve
existing API callers; the dashboard sends expectations for stale-write rejection.
These are value/status checks, not a new global versioning architecture.
Guidance and ratios remain advisory. No policy-enforcement claim is added.
Automated evidence and accepted browser results are in `PHASE_4_ACCEPTANCE.md`.
All 11 source/manifest/lockfile fingerprints match at documentation-only closure;
no manual checks were repeated. Checkpoint approval remains pending.
All 18 findings remain OPEN at the existing Phase 20/23/24 gates; no fresh audit,
dependency upgrade, suppression, waiver or production operation is claimed.
Existing protected configuration/runtime/credentials and browser profiles were
untouched. Phase 1–3 accepted records remain unchanged.

**Phase 5 Activity Event Platform COMPLETE (engineering acceptance), 2026-10-10.**
Fresh PostgreSQL 18 migration verification applied all 15 migrations in order,
including `0002`–`0005`, and validated checksums and activity tables. The isolated
PostgreSQL/Redis/live API suite passed 28 activity checks plus 26 product and 18
onboarding regressions. Session/device revocation and expiry, consent, ownership,
idempotency, atomic conflicts, export, deletion, and bounded payload handling are
covered. Evidence: `PHASE_5_ACCEPTANCE.md`. The dependency audit remains 18 open
findings (3 critical / 8 high / 7 moderate); no dependency changed and production
launch remains **NO-GO**. A full secret-scanner executable is unavailable; the
limited high-confidence pattern scan is documented in the acceptance record.

**Phase 6 Tool Classification Engine COMPLETE, 2026-10-10.** On a disposable
PostgreSQL 18/Redis/API fixture, migrations `0001`–`0015` and precheck passed;
5 classification integration tests plus 72 Phase 3–5 regressions passed, along
with 68 default tests, workspace typecheck, format, and lint (124 warnings, 1
informational diagnostic). The user reported P6-1–P6-5 PASS in the consolidated
tools-page review; the fixture stopped and no failures were observed.
`BLOCKED` and `ALLOWED` remain labels only, not access enforcement. Evidence is
in `PHASE_6_ACCEPTANCE.md`. All 18 dependency findings remain open release
obligations; production launch remains NO-GO.

### Historical Phase 2 source-verification record

Phase 1 is COMPLETE at verified revision `7e78c9d87ea993c7e95530b56dc5db9da1f8d4e7`; launch remains NO-GO. Phase 2 local verification demonstrated and fixed concurrent rotation, rotation/derived-session deletion reauthentication bypasses, stale-password login/change races, duplicated cookie headers and derived-session issuance after parent revocation/rotation. Parent-session issuance now revalidates the credential under a database lock and inherits the original authentication time. Final 68 default tests and 34 separate PostgreSQL/Redis/live-HTTP integration checks passed, along with formatting, lint, typecheck and both client builds. Production cookie/configuration contracts are tested without deployment. Both real Google/GitHub end-to-end logins remain mandatory blockers pending real credentials only in ignored `.env`; provider implementation remains intact. Interactive browser/installed-client acceptance also remains pending. Phase 2 is PARTIAL and Phase 3 on hold. Current evidence and exact OAuth setup/read locations are in `PHASE_2_ACCEPTANCE.md`; historical statements below do not supersede it.

Phase 14 adds hashed API keys, encrypted signing secrets/tokens, exact-raw-body HMAC verification, five-minute timestamp checks, stable event-ID idempotency, rate limits, soft revocation, normalized event storage, and exportable event records. A valid signature authenticates the workspace-controlled source only. Linked task evidence is pending owner review and does not issue credits at receipt. The Phase 13 manually submitted integration-reference type remains user-submitted; provider-specific OAuth and vendor signature adapters are still planned.

Phase 2 authentication through Phase 21 edge-case handling is implemented in source; runtime acceptance is pending. The auth package adds password hashing, one-use hashed tokens, opaque hashed session credentials, HTTP-only production cookies, CSRF validation, Redis-backed rate limits, session rotation/revocation, OAuth state and PKCE, verified provider email checks, and account export/deletion. Onboarding, product, activity, classification, rules, credits, growth-task, billing, and privacy APIs are scoped to the authenticated user and owned products/devices; state-changing requests require CSRF validation for cookie sessions, and responses are marked no-store. Activity payloads have bounded scalar attributes, per-user Redis rate limits, idempotent event IDs, and audit metadata that stores only batch counts. Activity timestamps more than five minutes in the future or seven days old use server time for effective ordering while preserving the submitted time. The Phase 10 extension requests permission for its configured API origin, authenticates with a bearer session, and caches policy locally for browser-side domain decisions; it pauses enforcement when policy is over 24 hours old or a material clock change is detected. Visited-domain uploads are opt-in and contain hostnames and policy metadata only. Phase 11 adds an encrypted desktop cache, opt-in app-time events, a native messaging host with recurring heartbeat checks, and local shared-policy evaluation. The desktop cache does not verify a server signature because signed policy snapshots are not yet implemented. Rule updates use optimistic versions and retain snapshots; schedules are evaluated in explicit time zones using a server timestamp. Credit writes require wallet-scoped idempotency keys and serialize on the shared account row across devices. New task rewards require a pending evidence item to be manually verified and use the credit ledger inside the same database transaction. Manual review records the product owner identity, time, decision, and audit event, but the owner can review their own evidence, so this is auditable self-verification rather than independent verification. Phase 14 generic integration references authenticate control of a configured source, not provider identity; provider-specific adapters remain incomplete. The API trusts forwarded IP headers only from loopback, matching the API's loopback binding and Nginx proxy. Phase 20 adds exact local renderer navigation checks, trusted-frame IPC validation, and a reduced preload bridge for the desktop lock screen. Phase 21 bounds offline queues, exposes dropped-event counts, detects material clock changes while clients are running, uses monotonic desktop timing for usage and grace periods, and keeps integration revocation and ingestion serialized under an account-row lock. These changes have not been packaged or runtime-accepted.

Phase 22 adds a distinct admin-role check to every Admin API route. Bootstrap access is limited to verified emails explicitly listed in `ADMIN_EMAILS`; additional roles are stored in `admin_roles`. Cookie-session writes require CSRF validation, and admin reads/writes use per-admin rate limits. Session/device and integration revocation run transactionally; integration revocation clears stored credentials. Admin actions are logged separately, and the privacy-retention worker prunes admin audit and AI-usage metadata using the actor's audit-retention preference (730 days after the actor is deleted). The console does not expose passwords, session tokens, API keys, integration secrets, or evidence content. Migration and runtime acceptance remain pending.

Production configuration rejects the development auth secret, non-HTTPS base URLs, missing email delivery credentials, and development email-link previews. The API and worker still bind to loopback behind the Nginx template.

## Remaining security acceptance

- Phase 20 source review for the current code snapshot is complete. The desktop main and lock windows block navigation away from their renderer files, reject webview attachment, validate main-frame IPC senders, and use separate preload bridges. Desktop/extension API requests and server-side OAuth-provider, Stripe, OpenAI, and Resend requests reject redirects; the extension revalidates its stored API origin. OAuth callbacks have an IP rate limit, and the Nginx template disables access logging for callback URLs that carry one-use code/state values. Stripe paid access maps only from explicitly configured monthly/annual Price IDs. Notification links are constrained to same-site paths, and native-host message/heartbeat parsing is bounded. Source review confirmed authenticated sessions, cookie-session CSRF checks, and ownership checks, and added missing per-user limits to onboarding, product, activity reads, classification, rules, task, evidence, wallet reads, AI status, integration reads, auth-session, credential-change, export, and deletion routes; Stripe webhook work is also IP-limited. Runtime security acceptance remains pending.

- Phase 21 source review covers offline policy expiry, clock handling, duplicate activity, multi-device ordering, extension disablement, killed desktop-agent detection, process-name changes, stale policy, integration revocation, and self-reported task completion. Local policy enforcement pauses when the cached policy is stale or a material wall-clock adjustment is detected; that behavior is fail-open and should be accepted explicitly. Forward clock changes while clients are stopped cannot always be distinguished from real offline time. A disabled extension cannot enforce policy. Application identity does not verify executable signatures. Owner-reviewed evidence is not independent proof. Runtime acceptance remains pending.

- Apply migrations `0002_authentication.sql` through `0015_admin_console.sql` with the migration runner and review the resulting schema on a development database.
- Exercise browser auth flows, OAuth with configured provider credentials, email delivery, bearer login, session rotation, and device/session revocation in a normal runtime environment.
- Exercise browser-extension and desktop bearer sign-in, token rotation, policy sync, and device revocation in a normal runtime. Install and verify the desktop native messaging host and confirm that only a live tray agent reports healthy.
- Verify encrypted desktop cache behavior, local emergency overrides, active-app identification, idle and lock handling, and app-usage consent on each supported platform. Linux Wayland foreground-app detection is unsupported; Linux lock detection depends on the desktop environment.
- Implement signed, expiring policy snapshots before relying on cached desktop policy as tamper-evident offline state. The current desktop cache is encrypted but its policy payload is unsigned.
- Passkeys are deferred. Provider-specific OAuth configuration is not present in this workspace.
- Product guidance, recommended ratios, and tasks are advisory; no stage-based access policy is enforced in this phase.
- Activity ingestion passed isolated runtime acceptance; clients must still avoid sending personal or secret values in event attributes.
- Tool mapping and resolution routes passed isolated Phase 6 runtime/API acceptance; the user also accepted the tools-page browser flow. User-scoped mappings, product ownership, CSRF, export, and deletion boundaries passed. `BLOCKED` and `ALLOWED` are labels only; Phase 6 does not enforce access policy.
- Rule creation, edits, overrides, and evaluation have not passed runtime acceptance. Evaluation is currently exposed as a preview/API decision; native app enforcement and device agents are not implemented. Deterministic evaluator tests remain pending.
- Credit wallet code has not passed runtime or concurrent-device acceptance. The account row lock serializes operations within each global or product wallet; this guarantee still needs database concurrency coverage. Credit writes use Redis rate limits (120 per minute; grants/adjustments are additionally limited to 10 per hour). Authenticated earn and adjust routes let owners issue credits to their own accounts. New task rewards are issued only after evidence review; previously issued Phase 12 rewards remain marked self-reported. Manual earn and adjustment controls remain prototypes, not billing or evidence-verification sources.
- Authenticated activity history API reads, ownership, export, and deletion passed the Phase 5 isolated runtime acceptance; browser workspace presentation was not part of that service-level check. Phase 13 evidence endpoints enforce ownership and private file retrieval in source, but migration, authorization, content handling, review idempotency, reward issuance, account export/deletion, and browser behavior remain unverified. Integration references are not authenticated against providers. A client-side login redirect does not replace API authorization.
- Phase 14 integration APIs scope accounts to their owner/product, store only an API-key hash and encrypted signing secret, reject stale signatures, rate-limit by client IP and integration, and retain normalized events without raw payload metadata. Apply migration `0011_integration_platform.sql` and verify signature comparison, event replay/conflict handling, cross-product task ownership, revocation races, pending evidence review, reward gating, export, deletion, and browser behavior. Generic connections are controlled by the workspace owner and do not prove vendor origin. Vendor OAuth and webhook signature verification remain unimplemented.
- Phase 10 stores the bearer token and cached rules in browser extension local storage; Chrome restricts storage access to trusted extension contexts where supported, but the data is not encrypted. Protect the browser profile and revoke the extension device if it is lost. Cached policy is usable offline for at most 24 hours; when stale, the extension clears its owned rules once its worker wakes and pauses enforcement until sync succeeds. Phase 11 includes native-host source, but installation and live-agent heartbeat behavior remain unverified.
- A TLS-enabled Nginx template now covers separate app/API hosts, but it still contains example domains and has not been validated on a production host. Production TLS issuance, host-specific firewall rules, secret handling, and runtime proxy acceptance remain launch requirements.

Do not expose the services publicly until the remaining security phases and deployment checks are complete.
