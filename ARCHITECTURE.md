# Enough architecture

Status: Phase 0 contract agreed under user-delegated engineering authority, 2026-10-07. Existing source is described separately from required targets.

## Components and ownership

| Component | Responsibility | Source |
| --- | --- | --- |
| Next.js web | Control center, account and workspace UI, same-origin API proxy | `apps/web` |
| Fastify API | Authentication, ownership checks, authoritative policy, ledger, task/evidence, provider and admin operations | `apps/api`, `packages/auth` |
| Worker | Scheduled retention and notification delivery; queue execution and future provider jobs | `apps/worker` |
| Desktop | Local voluntary enforcement, app metadata, encrypted cache, emergency exit, native messaging | `apps/desktop` |
| Extension | Top-level domain enforcement, scoped API access, optional hostname events, native-host health | `apps/extension` |
| Shared logic | Deterministic stages, classification, rules, time and client helpers | `packages/shared` |
| PostgreSQL | Durable account/domain records, ledger, event deduplication, migrations | `packages/db` |
| Redis | Rate limits and BullMQ; not the authoritative credit ledger | `packages/cache`, `packages/queue` |
| Nginx/systemd | TLS and loopback proxy, process restart, timers/logs | `infra` |

The API owns authorization and authoritative mutations. Web UI visibility and client caches are not security boundaries. Every operation verifies account/product/device ownership. Credit/evidence mutations and idempotency are committed transactionally in PostgreSQL.

## Data flow and deployment

Browser -> HTTPS Nginx -> Next.js; same-origin `/api/*` rewrites -> Fastify. Desktop/extension -> scoped HTTPS API using bearer sessions. API and worker -> local PostgreSQL/Redis. Provider adapters exchange tokens and normalized events server-side; clients do not receive provider secrets. Native messaging exchanges bounded messages only with allowed installed extensions.

Deploy one Ubuntu host without containers using reviewed refs, checksum migrations, backup before changes, atomic code releases and systemd. Separate app/API DNS names are templates, not configured deployment evidence. Code rollback does not reverse database migrations. Remote restore, renewal, external alert delivery and reboot must be tested.

## Architecture decisions

| Decision | Agreed target | Original recommendation / tradeoff |
| --- | --- | --- |
| Desktop framework | Retain existing Electron implementation and harden it | Original plan recommends Tauri 2/Rust; retaining Electron avoids a rewrite but requires IPC, navigation, packaging and updater security acceptance |
| Evidence storage | Private S3-compatible object storage for file bytes; PostgreSQL for metadata, ownership, checksums and lifecycle | Matches original recommendation and decouples file growth from transactional DB backups. Current BYTEA needs a verified migration, export/deletion compatibility and object backup/recovery |
| Shared engine location | Extend `packages/shared` for one policy/session state implementation | Original names `packages/rules-engine`; package location can differ, but independently duplicated state machines are unacceptable |
| Client propagation | Bounded polling with jitter/backoff and measured convergence; add push when required by acceptance targets | Original recommends realtime/WebSocket; launch requires measured load/lock-unlock convergence, and push does not replace authoritative resync |

These decisions follow the user's delegated priorities of scale, maintainability, security and compatibility. Retaining the existing TypeScript desktop reduces migration risk; its acceptance still requires actual security and platform evidence. No performance, compatibility or deployment acceptance is implied by this decision.

Private evidence storage must disable public access, use least-privilege service credentials, verify object ownership before download, use short-lived authorized retrieval, preserve quotas/checksums, and reconcile upload/delete failures idempotently. Require encryption, malware-risk controls, export compatibility, orphan cleanup and tested object/metadata restore together. Choose an actual storage provider only after deployment credentials, region and privacy requirements are known.

## Missing architectural work

Implement a server-authoritative build-session/reservation lifecycle and shared state reducer; signed policy snapshots with issuer/key rotation, owner/device/product scope and expiry; bounded offline spend; required vendor adapters and refresh/revocation; end-to-end consent boundaries and concurrency tests. The current rules evaluator does not use wallet balances or consume session credits.

Existing worker timers schedule email delivery and privacy retention; the BullMQ handler currently accepts `healthcheck` only. Retention and Stripe customer cleanup exist in source and require runtime/recovery acceptance. Do not reimplement them based on old limitation wording.

## Test boundaries

Unit/property: deterministic shared logic. PostgreSQL/Redis integration: constraints, race safety, idempotency, consent and transactions. Service integration: auth/providers/jobs. Browser/desktop/extension: actual enforcement and recovery. Operational: TLS, signing, deployment/reboot and isolated restore. All evidence must identify the release and environment.
