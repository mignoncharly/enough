# Privacy boundaries

Status: agreed Phase 0 engineering contract, 2026-10-07; not a published legal policy. See `PRIVACY.md` for the current processing draft and missing operator details.

## Collection and disclosure

Optional activity collection requires account consent plus the client's local toggle. Do not collect source code, keystrokes, clipboard, terminal commands, window/document contents, email bodies, page paths/query strings or browsing content. Hostnames, app identifiers, bounded durations and policy metadata are the activity target. The current API accepts bounded scalar attributes rather than a semantic allowlist; add type-specific allowlists so secrets cannot pass merely because their strings are short.

User-authored evidence/notes are intentional separate uploads, not passive capture. Files remain private with authenticated ownership checks. Current limits: 2 MiB per file, 20 MiB/account and 200 evidence items; PNG/JPEG/WebP/PDF only. Signature checks do not constitute malware scanning.

Provider adapters must request minimum scopes, normalize outcomes and avoid persisting mail/calendar bodies or raw provider payloads. Authentication provider identities and integration OAuth credentials are distinct. Review actual provider data disclosure before connecting accounts. AI receives only disclosed, consented, user-requested context; never raw event streams or evidence files. Prevent prompts, notes, tokens and response bodies entering logs.

## Lifecycle

| Data | Current target / boundary |
| --- | --- |
| Activity/notifications | Default 365 days; choices 30/90/180/365/730/1825/3650; test pruning and aggregate repair |
| Audit metadata | Default 730 days with configured retention; no credential content |
| Evidence | Until owner deletion/account deletion; erase bytes/content, preserve minimal necessary review/reward tombstone |
| Identity/product/ledger | Account lifecycle; test ownership cascades, export completeness and re-authenticated deletion |
| Backups/logs | Infrastructure templates: backup local retention 14 days, minimum three; journald max 30 days/1 GiB; remote retention and deletion recovery must be configured |

Worker retention timers and Stripe customer cleanup exist in source. Acceptance must exercise scheduling, failures, retries, consent revoke races, external deletion failures and restore/re-erasure. Local account deletion is blocked if required Stripe cleanup fails; explain pending deletion honestly. Backups need a bounded expiry and a procedure to reapply deletions on restore.

Revoking capture consent denies server ingestion and causes clients to stop capture/clear queued activity on their next sync. It does not erase previous records automatically. Offline clients may learn revocation later; distinguish server-effective revocation from local convergence. Export includes evidence bytes and may be sensitive; require authenticated delivery and safe size limits.

## Before publication

Owner must supply legal entity/contact, deployed processors/regions, remote backup and log retention, and reviewed user disclosures. Engineering privacy boundaries are agreed under delegated authority; legal compliance is not established by this document. Admin/support access must exclude secrets and unnecessary evidence content, be role scoped and audited.

Launch storage target: private object storage for evidence bytes and PostgreSQL for ownership/checksum/lifecycle metadata. Current BYTEA files must migrate with verified checksums and private access, export, erase and backup/restore behavior; no public bucket or indefinite signed link is permitted.
