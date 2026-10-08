# Phase 0 review and agreement record

Date: 2026-10-07. Status: Phase 0 contract complete under delegated decision authority. Public launch remains NO-GO; implementation and runtime acceptance are separate.

## Deliverables

- [x] `PRODUCT_SPEC.md`: promise, required capabilities, platform proposal and out-of-scope list.
- [x] `ARCHITECTURE.md`: components, trust boundaries, adaptations from original recommendations.
- [x] `DOMAIN_MODEL.md`: terminology, ownership and shared state-machine target.
- [x] `RULE_ENGINE_SPEC.md`: current ranking and required session/signed-policy composition.
- [x] `PRIVACY_MODEL.md`: collection, consent, disclosure and lifecycle boundaries.
- [x] `EVENT_SCHEMA.md`: existing transports and required version/privacy constraints.
- [x] `THREAT_MODEL.md`: assets, attack boundaries, risks and acceptance evidence.
- [x] Existing implementation/remediation plan links and handoff updated.
- [x] User delegated choices to the implementation agent, prioritizing scaling, maintainability, security and compatibility. Contract decisions below are recorded under that authorization; Phase 0 terminology, architecture, state-machine target and privacy boundaries are frozen.

## Recorded contract decisions

1. Keep all Phase 27 required capabilities. Retain product-specific minute credits and the shared build/grow state machine; their incomplete implementation remains a launch blocker. Do not replace them with advisory ratios or manual wallet controls.
2. Retain Electron for desktop and one shared TypeScript engine. Require maintained dependencies, isolated renderers, least IPC privilege, signed updates and supported-platform tests. Use private S3-compatible object storage for evidence files at launch, keeping ownership, checksums and lifecycle metadata in PostgreSQL. Existing BYTEA storage is a development implementation requiring migration. Keep bounded polling for initial sync with measured convergence, jitter/backoff and explicit load acceptance; adopt push delivery if required by the measured propagation/load targets. Providers and exact sizing follow implementation evidence rather than untested performance promises.
3. Support declared Windows/macOS/Linux X11 and browser targets; explicitly exclude Wayland native enforcement until supported. Allow labelled owner self-verification for voluntary accountability, but automatic rewards require separately authenticated provider provenance and an idempotent verification rule. Maintain locally available bounded emergency access. Pause visibly when offline policy/reservations cannot be trusted; never claim guaranteed anti-tamper enforcement. No architecture can guarantee enforcement against the machine owner disabling clients.
4. Keep all existing required integrations in scope, including the original Phase 14 analytics adapters; implement them after mandatory core-loop providers, at Medium priority. Keep passkeys deferred per the original practical exception. Pricing, legal identity/processor disclosure and exact supported release versions remain pre-launch inputs; delegated engineering judgment does not supply business/legal facts or account credentials.

## Delegation and change rule

The user stated: "please always pick the best options in term of scaling, maintenability, security, compatibility etc." Routine engineering decisions now proceed without repeated architecture questionnaires. Record meaningful tradeoffs and validate them. Request input only for unavailable facts, credentials, business/legal choices or actions outside existing authorization. Changes to the frozen contract need a dated rationale and affected acceptance checks.

## Source findings affecting remediation

- `packages/shared/src/policy-rules.ts` evaluates conditions, classification, schedules and overrides; no balance/session reservation input exists. Original credit-minute/session state-machine promise is not yet integrated.
- `apps/worker/src/server.ts` has privacy cleanup every six hours and notification polling; BullMQ supports `healthcheck` only. Earlier claim that retention scheduling is absent was incorrect.
- `packages/auth/src/routes.ts` implements Stripe customer cleanup before local deletion. Runtime/failure acceptance remains open; it is not wholly missing code.
- Activity attributes currently permit bounded arbitrary scalar strings. A semantic type/version allowlist is needed to enforce the privacy promise server-side.

No application code was changed and no runtime tests were run for this documentation phase. Review compared the proposals with the canonical scope, shared types/evaluator, SQL statuses, API event schemas, worker timers and account cleanup source. No Phase 1–26 runtime or launch gate was accepted.
