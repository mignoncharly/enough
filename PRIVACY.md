# Privacy and processing record

**Status:** implementation privacy record and policy draft, dated 2026-10-06. Before production, replace the owner and hosting placeholders and review this document against the actual deployment, contracts, and applicable law.

## Service promise

Enough tracks where you build, not what you build. The client capture controls default off. Enough does not collect source code, keystrokes, clipboard contents, screen recordings, document contents, email bodies, passwords, or terminal commands. Activity collection also requires account-level consent and a local capture toggle in the client.

## Processing record

| Purpose | Data | Storage and access | Retention |
| --- | --- | --- | --- |
| Create and secure an account | Email, optional display name, password hash or OAuth provider subject, session and device metadata, authentication audit events | PostgreSQL; accessible to the account owner and authorized service operators | Account life; login/session/security records are deleted with the account except minimal anonymized deletion audit data |
| Provide product workspace features | Product descriptions and goals, task titles and notes, metrics, stage history, policy rules and versions, credit and task reward ledger | PostgreSQL; account-scoped API and workspace pages | Until the account is deleted; required reward ledger rows are preserved for account history while the account exists |
| Record optional activity | Supported event type, product/device reference, timestamps, client sequence, and the event attributes shown on the Privacy page | PostgreSQL; user can inspect the latest records and full history | Default 365 days; user can choose 30, 90, 180, 365, 730, 1825, or 3650 days, or erase the history now |
| Store task evidence | User-submitted titles, notes, links, integration references, uploaded file metadata and file bytes, review status | PostgreSQL; private, authenticated, account-scoped reads | Until individually deleted or the account is deleted. A minimal tombstone and task/reward review history remain after evidence deletion |
| Deliver notifications | Notification title/body, product reference, read and delivery state, channel settings, email address for email delivery | PostgreSQL; email content sent through Resend only when configured and opted in | Default 365 days; user can choose the same retention periods |
| Maintain account audit history | Event type, timestamp, limited action metadata, and related account/device IDs | PostgreSQL; visible in Privacy and included in export | Default 730 days; user can choose the same retention periods. Account deletion events are detached from the deleted user and contain no email |
| Optional AI coaching | Relevant stage/target/problem text, goal and task titles, selected task description/estimate, numeric traction and seven-day event total; classification sends only evidence type/title and up to 1,500 characters of its raw note | External OpenAI processing requires configuration, AI consent and Get advice; `store: false`. No transcript is stored by Enough; a suggestion is stored as a task only when explicitly saved | Enough application logs exclude prompt/response bodies; usage records contain metadata only. OpenAI retention is separate; see below |
| Billing | Stripe customer/subscription identifiers, plan/status, invoice amounts, tax, hosted invoice link, and bounded payment error summary | Enough stores billing state in PostgreSQL; Stripe Checkout collects payment details directly | Local account data is deleted with the account. Account deletion requests deletion of the Stripe customer and immediate cancellation of active subscriptions; Stripe may retain limited history for accounting, dispute, or fraud purposes |
| Sign in with Google or GitHub | Provider subject, email, optional display name, and identity link | Enough stores identity association, not provider access tokens | Until identity disconnect or account deletion |

## Optional processors and external services

| Service | When used | Data sent or received |
| --- | --- | --- |
| OpenAI | Only if an API key is configured, account consent is enabled, and the user requests Coach advice | The selected context described above; no raw activity events or evidence files |
| Stripe | Only when billing is enabled | Billing account, checkout, subscription, invoice, and payment details; raw card data is handled by Stripe Checkout |
| Resend | Only when configured and an email is required or the account opts into email notifications | Recipient email, message body, and delivery metadata |
| Google and GitHub | Only when the user chooses OAuth sign-in | Authentication request and provider identity response |
| User-configured event source | When the user creates a signed webhook or public event API integration | Normalized event type, amount/currency when supplied, occurrence time, hashed user reference, and user-created reference fields; source signatures establish possession of the secret, not independent truth |
| Hosting, database, and network operators | Required to operate the chosen deployment | Depends on the actual operator, region, backups, and observability configuration. The production vendor and region are not specified by this source tree and must be recorded before launch |

## OpenAI processing disclosure — reviewed 2026-10-17

Current official policy and account-control status are recorded in the [public AI disclosure](apps/web/public/privacy-policy.md#openai-processing-disclosure--reviewed-2026-10-17) and the dated [AI Coach review](AI_COACH.md#provider-policy-and-payload-review--2026-10-17). Enough's own log and metadata storage is a separate boundary from provider retention.

Selected evidence notes are text sent to the provider, not anonymized summaries. File bytes and dedicated URL/reference fields are omitted, but user text can contain identifiers, links or secrets; remove these before requesting advice. Enough sends no internal account/task/evidence IDs in the prompt. Its server-side API credential authenticates the provider request and is never browser advice input. Enough must have permission to send inputs and must evaluate output appropriately under the [OpenAI Services Agreement](https://openai.com/policies/services-agreement/). Revocation prevents future submissions, not retrieval of already submitted content. See [AI_COACH.md](AI_COACH.md) for the capability matrix and review evidence. No claim of zero provider retention or EU-only processing is made.

## User controls

- Export all account data as JSON from the Privacy page. Uploaded evidence bytes are included as base64.
- Grant or revoke account-level activity collection and optional AI provider processing separately. The API rejects events immediately after revocation; connected clients stop local capture, clear unsent events, and require the local toggle to be enabled again at their next five-minute sync. Consent revisions detect a revoke-and-regrant while a device is offline.
- Choose activity, notification, and audit-history retention periods; the worker targets a six-hour cleanup cycle while it is running.
- Delete activity history and its hourly aggregates immediately.
- Delete evidence one item at a time. The content and file are erased; a minimal tombstone preserves review and reward history.
- Disconnect Google or GitHub as a sign-in method. This deletes Enough's identity link; existing Enough sessions stay active until revoked. No provider access token is held for remote revocation; revoke the session at Google or GitHub separately if needed.
- Revoke a device, which also revokes its active sessions, or revoke sessions individually from Devices.
- Delete the account after re-authentication. Account-owned records cascade away. Stripe cleanup must succeed before local account deletion completes.

## Contact and launch record

- Controller / operating entity: **[fill in legal entity and address before production]**
- Privacy contact: **[fill in monitored contact address before production]**
- Production hosting provider, database operator, region, backup retention, log retention, and applicable transfer safeguards: **[document from the deployed environment before production]**
- New AI consent changes record policy version `2026-10-17`; unchanged prior grants retain their historical version. Activity consent uses `2026-10-06`.
