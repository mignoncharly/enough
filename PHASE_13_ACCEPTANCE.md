# Phase 13 — Evidence System Acceptance

**Status: COMPLETE.** Isolated migration/runtime/API/storage acceptance and the one consolidated browser acceptance session passed. The canonical exit criterion, **Verified task completion can securely create credits**, is satisfied. Production launch remains **NO-GO** while all 18 dependency-security findings are open.

## Canonical scope and exit criterion

Phase 13 covers self-report evidence, notes, URLs, uploads, screenshots, integration references, and manual verification. Its exit criterion is: **Verified task completion can securely create credits.** The product/domain contract permits owner self-verification for voluntary accountability; it is not independent verification. No Phase 13 acceptance depends on unresolved P11-4 or P11-5. Phase 11 remains ACTIVE with P11-1–P11-3 PASS and P11-4/P11-5 BLOCKED.

## Existing implementation audit and fixes

- Existing schema and API already enforce task/product/user ownership, CSRF on writes, rate limits, strict evidence-type validation, supported file signatures, 2 MiB per-file, 20 MiB per-account and 200-item limits, authenticated retrieval, private/no-store delivery, checksums, export, and content deletion.
- Verified rewards use the existing credit ledger inside the evidence-review transaction. Completion locking and the `taskreward:<completionId>` idempotency key prevent duplicate grants. Rejected evidence can be retried with additional evidence.
- User-submitted integration references are recorded as `USER_SUBMITTED` and `PENDING`; no external provider or automatic reward is claimed for them.
- A bodyless DELETE forwarded by the web rewrite reached the API as empty JSON and returned 500. The API now treats an empty JSON body on DELETE as `{}`, preserving the route’s session, CSRF, ownership, and transaction checks.
- The evidence page previously stored success/review notices without rendering them. It now renders a polite status message and labels owner review as “Self-verified by product owner.”
- Evidence-operation error logging now records only error name/code/status, avoiding raw exception messages and stacks that can contain local source paths. Client error responses remain generic.
- Upload bytes now use an S3-compatible store through `@aws-sdk/client-s3`. PostgreSQL retains ownership, task/product/completion relationships, filename metadata, state, checksums, retry identifiers, review/audit data, and a cleanup outbox. Keys are random opaque values; writes omit public ACLs, and downloads proxy through the authenticated owner-scoped API with `private, no-store` headers. No presigned URL is issued.
- Existing `BYTEA` data is marked migration-pending, checksum-checked, staged, finalized, and verified before migration 0019 removes the old column. Failed finalization is resumable. Failed database writes delete staged objects when possible; outbox/reconciliation handles remaining object/metadata mismatches.
- The local fixture uses a disposable loopback S3-compatible S3rver instance under `TEMP/enough-phase13`, random test-only credentials, and a private-read middleware. It is started, stopped, and cleaned by the Phase 13 fixture scripts; no Docker or unrelated system service is used.

## Migration, runtime, and automated results

- Isolated PostgreSQL 18 applied migrations `0001` through `0019`; migration precheck found no pending migrations.
- Isolated PostgreSQL/Redis/API/worker/web readiness passed. The Tasks, Evidence, and Credits routes returned HTTP 200.
- `pnpm test:evidence:integration`: **8/8 passed across 2 test files**. This includes the isolated legacy BYTEA-to-object migration and the PostgreSQL-backed API/storage cases: anonymous and cross-account rejection; CSRF and URL validation; self-report, note, URL, screenshot, upload, and integration-reference evidence; content signatures and quotas; private retrieval; checksum/integrity; retry/idempotency; generic object-store errors; delete and account-delete cleanup; failed-finalization recovery; cleanup after DB transaction failure; bounded orphan reconciliation; export without storage identifiers; atomic verified-reward rollback/retry and exactly-once grant; and paired PostgreSQL dump/object restoration.
- The paired restore case dumps PostgreSQL metadata, restores it to a separate disposable database, restores the referenced object bytes through the staged/finalized path, then verifies owner-scoped metadata, object bytes, and SHA-256. It proves the local restore procedure; production backup scheduling, encryption, versioning/retention, and remote replication still belong to Phase 25 infrastructure acceptance.
- The local object-store request path denies unsigned access; the application itself never returns bucket names, object keys, storage credentials, local paths, or provider errors to users. Deployment must configure a private bucket with public access blocked and least-privilege credentials; do not enable static website/public access.
- Final verification: `pnpm test:evidence:integration` **8/8 passed**; `pnpm test` **103 passed** with 150 opt-in integration tests skipped; `pnpm typecheck` passed; `pnpm format:check` passed; `pnpm lint` exited 0 with the repository’s 124 existing warnings; `git diff --check` passed (Git only reported existing CRLF-to-LF normalization notices for the remediation handoff files).
- `pnpm test:evidence:clean` confirmed all Phase 13 services were stopped and removed only `TEMP/enough-phase13`; the disposable database credentials, object-store contents, synthetic uploads, and test backup files were not left behind.

## Consolidated browser acceptance

**PASS — user-reported, no manual acceptance failures.** The user signed into the isolated Phase 13 fixture; the Evidence page loaded without storage internals; a private upload was created, rendered, and retrieved through the authenticated UI; and a private screenshot was created and deleted without affecting the upload. No bucket name, object key, local path, storage credential, or direct object-store URL was exposed. The remaining upload was verified by the product owner, and the owner-review/self-verification state was recorded. The product-scoped Credits wallet showed exactly one +5 Build Credit reward. No duplicate manual verification was attempted because automated tests prove exactly-once reward idempotency. The fixture was stopped and `pnpm test:evidence:clean` completed successfully.

The manual fixture setup defect was corrected: `scripts/phase13-manual-account.mjs` now uses the canonical `/growth-tasks` and `/growth-tasks/:id/complete` API routes instead of `/tasks` and `/tasks/:id/complete`. This was a fixture setup defect, not an Evidence-system defect.

## Gaps and remaining acceptance

- The implementation validates file signatures but does not scan for malware. The remediation tracker rates unscanned uploads High and requires a decision on independence/scanning/moderation. Keep uploads authenticated and private; close that Phase 20/27 security decision and required controls before enabling any public or unauthenticated upload functionality. No scanner was added in Phase 13.
- The canonical state list mentions `EXPIRED`, but neither the domain model nor the Phase 13 contract defines an expiry trigger or period. No expiry transition was added.
- Automatic provider verification/rewards are not exercised here. User-submitted references remain pending until the authenticated Phase 14 provider flow exists; no unavailable external provider was required for this Phase 13 pass.
- No Phase 13 acceptance remains outstanding. The consolidated browser acceptance passed after automated storage acceptance.

## Security and release status

The tested S3-compatible implementation enforces account/task/product scope and does not expose file bytes without an authenticated owner check. Exports contain sensitive evidence bytes and remain authenticated downloads. Owner self-review is auditable but not independent. Storage errors are generic to users, and integrity is verified on finalization and retrieval. No malware-scanning capability is claimed; the High Phase 20/27 decision remains open before public upload functionality. Production object-store backup configuration and restore acceptance remain Phase 25 work. All 18 dependency-security findings remain open; production launch remains **NO-GO**.

No production deployment, Docker, GitHub Actions, external provider, production object store, unrelated dependency upgrade, or commit/push was performed.
