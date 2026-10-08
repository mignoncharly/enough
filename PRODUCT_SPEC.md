# Enough product contract

Version: Phase 0 contract, 2026-10-07. Status: agreed and frozen under user-delegated engineering authority; implementation acceptance remains pending.

## Purpose and launch promise

Enough helps founders interrupt excessive building and earn their next building session through market-facing work. The control center is a web application; a desktop agent and browser extension provide voluntary enforcement. Guidance and AI remain advisory. Enforcement follows explicit deterministic policy, verified rewards, and available product credits.

The product is a personal accountability system. Owners can disable clients and use an emergency exit; do not advertise protection against a device administrator or guaranteed independent proof of market outcomes.

## Required launch scope

All Phase 27 requirements remain in scope: onboarding; products/stages; activity detection; classification; Build Credits; rules; browser/native blocking; tasks/evidence; Gmail, Outlook, Google Calendar, Microsoft Calendar; Stripe billing and vendor payment evidence where required; generic webhook/API; AI coach; reports; multiple devices; offline enforcement; emergency unlock; privacy/export/delete; admin; installers/updates; monitoring/backups; automated critical-path tests.

OAuth sign-in with Google/GitHub is separate from mail/calendar integration permission. An owner-signed Generic webhook does not satisfy a named vendor integration.

Notifications remain in Phase 17 scope. PostHog, Plausible and GA4 remain original Phase 14 scope at Medium priority after core-loop providers. Passkeys remain deferred under the original practical exception.

## Support target

| Surface | Launch target | Required evidence |
| --- | --- | --- |
| Web | Current desktop/mobile browser versions declared at release | Core journeys, keyboard access, responsive layouts, supported versions recorded |
| Browser extension | Chrome, Edge, Brave and Firefox | Actual install, sync, permissions, enforcement and recovery; store approval where distributed through a store |
| Desktop | Windows x64, macOS x64/arm64, Linux x64 X11 | Native-app identity, emergency exit, idle/lock/suspend, install/update/uninstall per platform |
| Linux Wayland | Native-app enforcement excluded until implemented/tested | Clear unsupported-capability message; other features must state their tested support |
| Server | Ubuntu VPS, Node, PostgreSQL, Redis, Nginx, systemd | Production verification, reboot and restore evidence |

Exact OS/browser versions are release acceptance inputs, not implied compatibility with all versions.

## Core journey and invariants

1. Sign in, create a product, select a stage and goals, and choose enforcement and optional capture settings.
2. Classify tools and apply explicit policy. Recommend stage ratios without silently creating restrictions.
3. Start a build session using product credits. Reserve budget centrally so simultaneous devices cannot spend it twice.
4. Warn before exhaustion; restrict configured build tools when budget/policy requires growth.
5. Complete a market task, submit evidence, obtain the applicable verification, and grant the reward exactly once.
6. Reconcile usage and release unused reservation budget. Allow the next session when policy and available credits permit.

Unit: one Build Credit represents one building minute, matching the original examples. Fractional usage, rounding, offline reservations and heartbeat/release rules must be specified and tested before this mechanism is accepted. Global wallet prototype controls do not substitute for product-specific session budgets. Implement the missing connection between the credit ledger, session accounting and shared evaluator during remediation.

## Safety and evidence contract

Emergency bypass is always reachable locally, has a visible expiry and reason, and reconciles its audit record on reconnect. Enforcement must never trap a user out of their operating system, security tools, account controls or emergency exit. Exhausted budget and paid access are separate decisions: subscription payment never proves a growth task.

Owner review is allowed as clearly labelled self-verification for voluntary accountability; provider-authenticated evidence is labelled by source. Automatic rewards require independently authenticated provider provenance and a tested idempotent verification rule. Neither proves a customer's intent or truth of every claim. A completion claim alone grants no reward. Owner-signed inbound events remain pending review. Never label them vendor verified or automatically grant rewards from them.

Offline contract: use only verified, scoped, expiring policy and bounded prepaid reservations for metered build sessions. Once policy or reservation expires, show enforcement as paused/degraded and permit emergency access; do not claim valid protected enforcement. Existing unsigned caches cannot meet this target. The 24-hour policy limit is a maximum, not a promise of unlimited offline credit use.

## Out of scope

Public social network; CRM; campaign platform; social scheduler; landing-page/website builder; code editor or source-code analyzer; Jira/Slack replacement; general project-management suite; AI content factory. No collection of source code, keystrokes, clipboard, terminal commands, email bodies or browsing page contents for activity measurement.

## Review decisions and acceptance

The support matrix, evidence trust model, offline pause/emergency behavior and architecture targets are agreed under the user's delegated decision authority; see `PHASE_0_REVIEW.md`. Product-specific minute credits and the shared state machine are retained original requirements, not accepted implementation claims. Pricing, legal operator, provider scopes and exact release support versions remain pre-launch inputs.

Phase 0's documentation/agreement exit is complete as recorded in `PHASE_0_REVIEW.md`. Implementation and runtime gates remain open. Changes after agreement require a dated reason, affected tests and updated launch gate.
