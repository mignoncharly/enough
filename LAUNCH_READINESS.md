# Phase 27 — Full Product Launch Gate

Last assessed: 2026-10-10 (tool-classification capability row only; full launch gate not reassessed)

## Decision

**NO-GO. Do not open the product to general users.** The required capabilities have not been accepted as one working production system. The project has no configured production host; migrations `0002` through `0015` have only been exercised in disposable development fixtures; Phase 26 production checks have not run; multiple critical user flows remain unverified; and required integrations or release artifacts are missing.

This is a decision from the evidence recorded in this workspace, not a claim that the source implementation is absent. Source presence, unit tests, and successful bundle builds do not substitute for the launch gate's integrated runtime evidence.

## Capability assessment

| Required capability | Recorded state | Gate |
| --- | --- | --- |
| Onboarding | UI/API source exists; migration and browser/runtime acceptance pending. | Not accepted |
| Products and stages | Source exists; migrations, persistence, stage transitions, and runtime acceptance pending. | Not accepted |
| Activity detection | Activity APIs and optional client event capture exist; ingestion, privacy, ordering, and aggregates lack runtime acceptance. | Not accepted |
| Tool classification | Phase 6 COMPLETE: migrations, API/data boundaries, resolver, and tools-page create/edit/remove/preview accepted; P6-1–P6-5 PASS by user report. BLOCKED/ALLOWED are descriptive labels only. | Accepted (Phase 6 only) |
| Build Credits | Ledger, reservations, refunds, and evidence-gated rewards exist in source; product-specific minute/session accounting is not connected to rule enforcement. DB and multi-device concurrency acceptance pending. Manual earn/adjust remain prototype controls. | Missing integration / not accepted |
| Rules engine | Deterministic rules and overrides exist in source; database, schedules, client parity, and enforcement acceptance pending. | Not accepted |
| Browser blocking | Chromium/Firefox extension source and store archives exist; browser installation, policy parity, offline behavior, and store publication are pending. | Not accepted |
| Native desktop blocking | Desktop agent and native-host source exist; signed packages, platform behavior, identity limits, policy sync, and runtime acceptance are pending. | Not accepted |
| Growth tasks | Templates and task flows exist; migration, browser use, recurrence, and reward acceptance pending. | Not accepted |
| Evidence | Private evidence and review flows exist; migration, privacy, deletion, content handling, and reward acceptance pending. Review is owner-controlled, not independent verification. | Not accepted |
| Gmail | Provider-specific OAuth, sync, and signature adapter are not implemented. | Missing |
| Outlook | Provider-specific OAuth, sync, and signature adapter are not implemented. | Missing |
| Google Calendar | Provider-specific OAuth, sync, and signature adapter are not implemented. | Missing |
| Microsoft Calendar | Provider-specific OAuth, sync, and signature adapter are not implemented. | Missing |
| Stripe | Checkout, portal, and webhook source exist; test/live configuration, price IDs, feature mapping, migrations, and runtime acceptance remain pending. | Not accepted |
| Generic webhook/API | Signed inbound event source exists; migration, external-client, replay, revocation, and runtime acceptance remain pending. It authenticates a workspace-controlled source, not a vendor. | Not accepted |
| AI coach | Advisory API and local fallback exist; provider setup, consent, cost/usage behavior, and runtime acceptance remain pending. | Not accepted |
| Reports | Report APIs and views exist; source data, database, browser, and correctness acceptance remain pending. | Not accepted |
| Multi-device | Locking, ordering, and revocation protections exist in source; cross-device concurrency and convergence are unverified. | Not accepted |
| Offline enforcement | Browser/desktop cache and stale-policy behavior exist; signed policy snapshots are absent and fail-open/client-disabled cases are not accepted. | Not accepted |
| Emergency unlock | Source flow exists; device behavior, audit trail, expiry, and synchronization are unverified. | Not accepted |
| Billing | Subscription and entitlement source exists; pricing/feature decisions, Stripe configuration, migrations, and end-to-end webhook acceptance remain pending. | Not accepted |
| Privacy, export, and delete | Controls and source flows exist; migrations, retention scheduler, consent gates, external Stripe deletion, export/deletion completeness, and runtime acceptance remain pending. | Not accepted |
| Admin | Console/API source exists; migration `0015_admin_console.sql`, authorization, audit, and operational acceptance remain pending. | Not accepted |
| Installers | Targets and workflow exist; signed Windows/macOS builds and accepted Linux packages are missing. Local desktop packaging hit `EPERM` reading linked `dotenv`. | Missing/blocked |
| Auto-update | Feed configuration exists; public feed/repository, signed artifacts, and end-user update installation are not verified. | Not accepted |
| Monitoring | Readiness timer and journald templates exist; no production deployment or external alerting is configured. | Not accepted |
| Backups | Encrypted backup and isolated restore scripts exist; no production off-host backup or restore has been run. | Not accepted |
| Automated tests | 65 unit/property/contract tests passed in the earlier Phase 23 record; database, browser/Electron, multi-device, load, security, and production integration coverage is incomplete. No suite was run for this gate. | Partial |

## Release-blocking evidence

1. Configure and accept a production-like Ubuntu deployment using [the Phase 25 runbook](infra/README.md). Apply and verify reviewed migrations, TLS, service restart behavior, external monitoring, off-host backups, isolated restore, and reboot recovery.
2. Complete [Phase 26 production verification](infra/production-verification.md) with redacted evidence for the required service and integration flows. No Phase 26 production scenario has run; the last read-only workspace probe found the relevant local ports closed.
3. Implement and verify the four provider integrations listed as missing above, or formally revise the product contract before launch. A Generic webhook is not a substitute for vendor-authenticated Gmail, Outlook, or calendar sync.
4. Resolve Stripe pricing and entitlement mapping; configure test-mode credentials and verify signed, replay-safe webhook behavior before any live billing enablement.
5. Complete database/browser/client runtime acceptance for Phases 2–22, including admin migration `0015`, privacy deletion/export, evidence review/rewards, multi-device behavior, offline enforcement, and emergency unlock.
6. Produce and sign desktop packages, submit browser extensions, publish a reachable update feed, and verify installation and update on supported platforms. No signing or store credentials are configured here.
7. Expand automated coverage for database migrations, critical cross-service flows, two-device convergence, browser/Electron runtime, restore, load, and security. Preserve the existing 65 passing tests as a baseline; they do not clear these gaps.
8. Close product and operational policy decisions: signed desktop policy freshness, the fail-open enforcement cases, independent-evidence expectations, data retention/deletion behavior, launch support ownership, and external alert response.
9. Implement the original build-credit product loop: shared build/grow states, product minute reservations, session metering/settlement and bounded offline spend. Passing manual wallet routes and static policy evaluation is insufficient.

## Gate process

For each required capability, record a release commit, environment, scenario, expected result, observed result, protected evidence reference, and follow-up owner in the applicable phase checklist. Use synthetic accounts/data and provider test modes. Do not log credentials, OAuth codes, session cookies, or webhook secrets. A capability passes only with runtime evidence; source implementation alone remains pending.

Reassess this decision after the blockers above are resolved. Phase 27 exits only when every required capability works together in production and the evidence is accepted. Until then, the launch gate remains **NO-GO**.
