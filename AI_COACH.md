# AI Coach

The Coach provides advisory help for seven actions: onboarding analysis, task suggestions, task scope challenges, weekly diagnosis, next action, overbuilding explanation, and evidence topic classification.

## Provider setup

The AI provider is optional. Without `OPENAI_API_KEY`, the API returns deterministic stage guidance and labels the result `STAGE_GUIDANCE`. To enable model responses, configure `OPENAI_API_KEY` and optionally set `OPENAI_MODEL` in `.env`; the default model is `gpt-6-astra`. Restart the API after changing the environment.

The API sends model requests to the OpenAI Responses API using strict JSON Schema output. The request sets `store: false`. See the [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Data sent

Nothing is sent to an external provider until a signed-in user clicks **Get advice**. The server verifies product ownership and only assembles context needed for the selected action:

| Action | Context that may be sent |
| --- | --- |
| Onboarding analysis | Product stage guidance and ratio, target customer, problem statement, and active goal titles |
| Task generation | The onboarding context plus active task titles, to reduce duplicate suggestions |
| Scope challenge | Product stage guidance, active goal titles, and the selected task title, notes, and estimate |
| Weekly diagnosis | Product stage guidance, active goal titles, numeric user/revenue totals, and a seven-day aggregate event count |
| Next action | Product stage guidance, active goal and task titles, numeric traction, and a seven-day aggregate event count |
| Overbuilding explanation | Product stage guidance and its suggested build/customer-learning ratio |
| Evidence classification | Selected evidence type, title, and up to 1,500 characters of its note as text; no product-stage context |

The Coach does not attach account/internal IDs, passwords, session credentials, rule data, raw activity events/attributes, evidence URL/reference fields or uploaded file contents to provider input. User-entered titles, descriptions and notes are sent as authored; they are not anonymized or automatically scrubbed of embedded identifiers, URLs or secrets. Remove sensitive details and send only content you have permission to share. The server sends its provider API key only in the authentication header, never in the model input or browser response. Enough application logs do not store prompts or responses; provider retention is separate (see the dated review below).

## Limits

AI output is advisory. It cannot edit rules, enforce policy, verify or reject evidence, or issue credits. Suggested tasks are saved only after the user clicks **Add task**, through the existing task API, with a zero-credit reward. Evidence classification describes an apparent topic and never decides authenticity or reward eligibility. The normal evidence review flow remains required.

Weekly event counts describe recorded activity, not customer outcomes. Stage ratios are planning guidance; the product does not measure actual time spent building or talking with customers. OpenAI request storage is disabled in the request, while any other provider data handling follows the account's current API terms and configuration.

## Runtime acceptance

**PHASE 15 — AI LAYER: COMPLETE (2026-10-17). PRODUCTION: NO-GO.** Pass 1 deterministic hardening, Pass 2 provider-disabled runtime, Pass 3 bounded development-provider acceptance, provider/data-handling review and the USER-REPORTED consolidated browser session P15-1–P15-6 pass. Final read-only task/credit/consent/log/provider checks pass and the isolated fixture is stopped. Account controls remain NOT VERIFIED, with no special-control claims. The closure record below supersedes earlier ACTIVE/pending entries, which remain as dated history.

### Phase 15 reconciliation audit — 2026-10-17

`REMEDIATION_IMPLEMENTATION_PLAN.md` is authoritative: Phase 15 is AI Layer. The existing API/page/docs were introduced in foundation commit `7e78c9d`; reuse them. Release-hardening checkpoint `35f1828`, formerly labelled “15A”, supports Phase 25 and does not count as Coach acceptance. **Phase 15 ACTIVE; production NO-GO.**

| Requirement | Existing implementation / audit finding | Remaining acceptance |
| --- | --- | --- |
| Seven advisory capabilities | `apps/api/src/ai.ts` implements all seven and capability-specific context; no model tool execution. | Deterministic API coverage for every capability and adversarial/untrusted context. |
| Provider request | Responses API, strict `text.format` JSON schema, `store: false`, 25-second timeout, 1600 output-token cap. | Real synthetic-data success with an authorized development key/model; mocked incomplete/refusal/timeout/HTTP/malformed cases. No key/model access was checked in this audit. |
| Response validation | Zod validates advice and filters task suggestions; only `incomplete` is explicitly rejected as a response status. Refusals become a generic no-advice error if no output text exists. | Require a completed response and explicitly reject refusal/non-completed/malformed envelopes before using text; test mixed refusal/text, invalid schema, duplicate tasks and non-task capabilities. |
| Local fallback | No provider key returns labelled deterministic `STAGE_GUIDANCE`. With a configured key, provider failures return safe HTTP 502; they do not silently fall back. | Verify both paths. Preserve the distinction unless a deliberate product decision changes failure behavior. |
| Authentication/authorization | Session, CSRF, ownership checks and per-user rate limits exist; configured provider requires AI-processing consent. | Isolated DB/API tests for unauthorized/cross-owner product/task/evidence, invalid input, consent on/off and rate limits. |
| Schema compatibility | Consent reads `privacy_consents` (0014); usage writes `admin_ai_usage_events` (0015); evidence queries current storage-era tables. | Use a separate fixture through 0020 with precheck. The old “through 0011” checklist is insufficient. No migration was run during this audit. |
| Advisory boundary / saving tasks | Coach does not mutate policy/evidence/credits; Add task calls the normal task endpoint with `rewardCredits: 0`. | Prove explicit user action, ownership, no reward issuance, and duplicate-click behavior. |
| UI selection and async results | `getAdvice` accepts a late result without checking its originating product/action; selectors remain enabled while requesting. Added-task titles are not reset when the context changes. | Regression-test product/action changes during requests; prevent stale advice from being saved to another selected product and scope added-task state to the result/context. Findings are from source inspection, not browser acceptance. |
| Privacy and safe logs | Context excludes raw events, uploads, evidence URLs/references and explicit account IDs. Provider error logs omit raw response text; context/usage DB catches still log raw error objects. | Capture logs with synthetic canaries for prompts, notes, responses and credentials; inspect DB-error paths. Never promise automatic removal of personal data typed into titles/notes. |
| Browser/accessibility | Existing labels, disclosures, consent gating, loading/error/empty states and result live region. | Actual desktop/mobile viewport and keyboard acceptance, unauthorized redirect, consent changes, stale requests and task saving. No UI acceptance claimed from markup alone. |

At the initial audit, no dedicated Coach regression tests or Phase 15 fixture mode were present. The deterministic work below supersedes those source findings; runtime/provider/browser acceptance remains pending.

### Provider documentation review

The [official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) documents incomplete responses and refusals as distinct cases requiring handling. Strict JSON output does not establish factual correctness or permit the model to make evidence/reward decisions.

`store: false` does **not** establish zero provider retention. The [official data controls documentation](https://developers.openai.com/api/docs/guides/your-data) distinguishes application state from abuse-monitoring logs and model-specific caching; standard abuse-monitoring retention may be up to 30 days. The development/production account's actual controls and agreement still require confirmation. This source review is not account-specific legal approval.

### Acceptance execution order

1. Add deterministic provider/route/logging regressions using synthetic context and mocked network responses. Fix demonstrated response-validation and stale-result issues without redesigning the Coach.
2. Extend the existing fixture approach with independently owned Phase 15 paths/ports/database; apply current schema and exercise API/consent/task flows. Never reuse Phase 14 state or a production database.
3. Run automated runtime, state and quality checks on that fixture.
4. After authorization, perform minimal real-provider acceptance with synthetic context and a locally protected development credential, then one consolidated browser session across viewport/keyboard/error states. Automate fault cases; do not force real provider outages or repeated manual testing. Do not print prompts, evidence, outputs or credential values.
5. Record actual results against the canonical checklist. Keep provider/account/UI gates pending until observed. Do not commit or push without authorization.

GA4 deferred acceptance and Microsoft PERSONAL_MSA revocation remain preserved external Phase 14 exceptions. The dependency baseline remains 21 findings (3 critical / 9 high / 9 moderate); no dependency or infrastructure work is part of this audit.

### Pass 1 — deterministic hardening

All seven existing capability identifiers remain unchanged. Each is dispatched by `POST /ai/coach` in `apps/api/src/ai.ts`, sent by `requestAiAdvice` through `/api/ai/coach`, and selected on `apps/web/app/coach/page.tsx`:

| Capability | Existing UI action |
| --- | --- |
| `ONBOARDING_ANALYSIS` | Onboarding analysis |
| `TASK_GENERATION` | Generate tasks |
| `SCOPE_CHALLENGE` | Challenge task scope |
| `WEEKLY_DIAGNOSIS` | Weekly diagnosis |
| `NEXT_ACTION` | Choose a next action |
| `OVERBUILDING_EXPLANATION` | Explain overbuilding risk |
| `EVIDENCE_CLASSIFICATION` | Classify evidence topic |

- The REST response must have `status: completed`, no provider error, and one completed assistant message with one schema-valid output. Partial/multiple text fragments and SDK-only convenience output cannot bypass this check. Refusal content takes precedence over advice in a mixed message. No automatic retry is performed.
- Refusal returns HTTP 200 with `outcome: REFUSED`, a fixed explanatory message and **no advice/tasks**. It is shown as a separate notice. Other failures retain HTTP 502 with safe categories: `AI_TIMEOUT`, `AI_PROVIDER_ERROR`, `AI_INCOMPLETE`, `AI_NOT_COMPLETED`, `AI_MALFORMED`. Missing provider configuration alone returns deterministic `STAGE_GUIDANCE`; configured failures never fabricate a local/provider result.
- The existing usage table is unchanged: `SUCCEEDED` means usable advice; `FAILED` means no usable advice, including refusal. Refusal is distinguished by safe `REFUSED` log metadata, not counted as a provider outage in the response. Only existing account/capability/model/status/duration/token metadata is persisted; invalid/negative/out-of-range token counts become null. No prompt, context, output or refusal text is logged or persisted there.
- Consent remains mandatory when a provider is configured. It is checked before context reads and again immediately before sending; a revocation completed during context assembly blocks the call. A consent-store failure fails closed with 503. A later revocation cannot retract data already sent. Provider-disabled local guidance remains available without provider-processing consent.
- `coach-session.ts` owns request state for one mounted page, with synchronous context invalidation and request generations. Product/action/task/evidence selection changes clear results, errors, refusals and save notices. Late successes/errors/finalizers and unmounted requests cannot overwrite a newer context. Rendering also checks the full context key. There is no global Coach cache.
- Only a current task-generation suggestion can be explicitly saved. The page sends the ordinary Growth Task request with `rewardCredits: 0`; task creation issues no credits or completions. Synchronous save guards block double clicks and repeated attempts for the same product/title within that page session, including ambiguous failures. After ambiguity, inspect Tasks before creating another copy. This is not durable server-side idempotency across reloads; the general task API and Phase 12/13 reward/evidence contracts are unchanged.
- AI context/consent/usage, authentication, rate-limit and task-save failure paths log fixed categories instead of raw exceptions. Task connection/rollback failures cannot escape with private SQL diagnostics. Structured canaries exercise these paths and ordinary request-header redaction.

Deterministic coverage lives in `apps/api/src/ai.test.ts` (real Fastify route injection, mocked provider/database/auth dependencies), `apps/web/app/coach/coach-session.test.ts` (the actual page state controller with delayed promises), and `packages/auth/src/rate-limit.test.ts`. Existing auth-origin/CSRF and request-log regressions are included. No real OpenAI calls, PostgreSQL fixture, or browser session was used. These tests prove route/state behavior, not real database isolation or browser acceptance.

The first full serial run exposed an unrelated storage unit-test setup failure: importing the database loaded production environment validation before the test's own intentionally invalid endpoint assertion. The unit now mocks its unused database dependency. Storage implementation, migrations and reward behavior were not changed. Initial sandbox runs could not resolve Fastify's installed `ajv` link; the approved run outside the sandbox resolved it without dependency installation/upgrades.

Pass 1 validation (2026-10-17): dedicated Coach API/state tests **183 PASS** (165 API, 18 state); focused suite including auth/logging/storage/fixture-plan checks **200 PASS** across seven files. Final serial default suite **380 PASS / 167 opt-in runtime tests skipped**, 35 files passed and 14 skipped. The first serial run was **365 PASS / 1 FAIL / 167 skipped** before the unit-test isolation correction; it is not hidden or counted as a pass. Final monorepo typecheck, changed-scope Biome check (13 files), repository format check (237 files), and `git diff --check` passed. The full changed/new-file scan found no credential material, real provider identifiers or private acceptance artifacts; test values are synthetic. Dependencies and the last recorded audit baseline were unchanged; no new audit was requested or run in this pass.

### Isolated runtime contract

`scripts/phase15-fixture-plan.mjs` is a side-effect-free fixture contract with offline regression coverage. The executable launcher is `scripts/phase15-runtime.mjs`; it does not invoke earlier phase runners. Do not pass an unsupported `--phase15` flag to an older phase runner.

| Item | Dedicated Phase 15 value / guard |
| --- | --- |
| TEMP root | `%TEMP%\enough-phase15-ai\` |
| Ownership marker | `phase15-fixture.json`, fixture `enough-phase15-ai`, version 1; refuse unowned folders and symlinks |
| PostgreSQL / database and role | `127.0.0.1:55950` / `enough_phase15_ai`; fresh synthetic credentials generated only on authorized fixture creation |
| Redis | Windows loopback `56411`, dedicated WSL loopback `56412` |
| API / worker / web | `4440` / `4441` / `3320`, all loopback |
| Migration order | Precheck, full `0001`–`0020` chain, precheck; verify exact ledger and no pending migrations, never inherit a migration stop override |
| Runtime environment | Central allowlisted subprocess environment plus explicit generated fixture values; provider disabled by default; no root dotenv or earlier phase configs; a future development key must be supplied separately after authorization |
| Cleanup | Stop only processes launched/identified as this fixture; require exact resolved TEMP root, valid owner marker, no links, and stopped Windows/WSL listeners before any explicit cleanup; preserve data on failure |

Runtime coverage:

1. Two synthetic accounts, two products owned by the primary account and one by the second; synthetic active tasks and note evidence. Verify product, task and evidence ownership and no disclosure across accounts/products.
2. Exercise every capability, selected-context validation, 8/min Coach quota, 120/min status quota, session/origin/CSRF rejection, and consent absent/grant/revoke (including a delayed context request).
3. Use deterministic provider faults for timeout/transport/HTTP/incomplete/refusal/malformed paths, provider-disabled fallback, safe usage metadata and captured-log canaries. Do not induce real provider failures or send private fixture content to a provider without consent.
4. Verify explicit zero-reward task persistence, unchanged credit ledger, current-result-only saving and duplicate-click/ambiguous-save handling. Do not accept later evidence/credit phases by implication.
5. Only after isolated runtime checks, use an authorized development OpenAI credential for minimal successful synthetic requests, then one consolidated desktop/mobile/keyboard browser session covering loading/empty/error/refusal/unauthorized/consent/context-switch/save states.

The dedicated ports, fresh migrations, precheck and runtime seed have now been exercised below. Development-provider access and manual browser acceptance remain pending. Phase 15 remains ACTIVE; production NO-GO. Phase 14 state and external exceptions remain untouched.

The proposed ports were checked against repository fixture source, including the preserved GA4 helper's `4430`/`4431`; Phase 15 avoids those ports. The seven offline fixture-plan regressions were rerun after choosing `4440`/`4441`/`3320` and passed. No existing listener was stopped or inspected through its private state.

### Pass 2 — isolated provider-disabled runtime acceptance

The launcher uses native PostgreSQL, dedicated WSL Redis behind a Windows loopback bridge, the real API and an isolated Next development web copy. API/web are loopback-only. The worker is unnecessary for these synchronous Coach, consent, task and note-evidence flows; port 4441 stays reserved. No production object store, old fixture, root dotenv, Phase 14 credentials or GA4 markers are read. Generated credentials and sessions remain only beneath the owned TEMP root.

Commands (provider remains disabled in every mode):

- `pnpm test:ai:runtime`: start services, verify migrations, deterministically recreate the two synthetic accounts, run live tests, stop and retain state.
- `pnpm test:ai:serve`: restart services and preserve seeded accounts/sessions; seed only if absent. This is not a provider-enabled mode.
- `pnpm test:ai:stop`: ask the owning supervisor to stop its child processes, verified Redis instance and PostgreSQL directory; retain state.
- `node scripts/phase15-runtime.mjs status`: ownership-checked supervisor status.
- `pnpm test:ai:clean`: explicit disposable cleanup; requires exact realpath, owner/version marker, no linked root/state, no active supervisor and free dedicated Windows/WSL ports. Unknown/unmarked roots are refused. The retained acceptance fixture was not deleted.

The subprocess allowlist excludes inherited OpenAI, OAuth, storage, signing, database/Redis credentials and `NODE_OPTIONS`/migration overrides. Only explicit generated fixture values are supplied. The API preload `phase15-egress-guard.mjs` replaces fetch with a counted denial before initialization; it never records URLs, bodies or headers. This guards the current fetch-based provider abstraction, not all operating-system networking. **Observed outbound API fetch attempts: 0.** A separate in-process real route/database test uses a synthetic key and mocked fetch for configured-path consent/success/refusal/error; the listening API remains disabled and no external call occurs.

Fresh migrations **0001–0020 PASS**: all 20 exact filenames once, SHA-256 checksums match, precheck clean/no pending migrations, rerun leaves ledger/checksums/application timestamps unchanged. Schema assertions cover 0014 consent, 0015 usage, 0018/0019 storage metadata and finalized BYTEA removal, and 0020 provider configuration. Later schema presence does not accept later phases. Safe evidence is retained in `fresh-migration-evidence.json` and `migration-evidence.json` beneath the fixture root.

| Capability | Synthetic dependencies | Runtime result |
| --- | --- | --- |
| ONBOARDING_ANALYSIS | Account A IDEA/EARLY_USERS products, onboarding profile, target/problem and active interview goal | PASS |
| TASK_GENERATION | Product/goal context plus active task titles | PASS |
| SCOPE_CHALLENGE | Owned selected 35-minute active task | PASS |
| WEEKLY_DIAGNOSIS | Traction totals and three events within seven days; 999 older events excluded | PASS |
| NEXT_ACTION | Owned product, goal, tasks, traction and activity | PASS |
| OVERBUILDING_EXPLANATION | Product stage and existing guidance | PASS |
| EVIDENCE_CLASSIFICATION | Owned completed task and synthetic NOTE evidence | PASS |

Seed: two verified synthetic accounts/sessions; two A products and one B product; three active goals, metrics and active tasks; three completed-task/note pairs; historical aggregates; initially no AI consent. No credits issued. Repeated local advice is deterministic; all seven preserve task/ledger counts and reject cross-account products. Selected task/evidence must belong to the product. Deleted records, malformed input and missing/invalid/revoked sessions are rejected.

Live acceptance **22/22 PASS** includes consent grant/revoke persistence and cross-account isolation, configured-path denial immediately after revocation, real consent-read failure with fail-closed 503, shared 8/min account quota and independent B, CSRF/exact-origin rejection through API/web proxy, metadata-only usage persistence, and private-content/session log canaries. Initial live result: **21 PASS / 1 FAIL**. The test incorrectly expected extra `userId` consent input to be ignored; the existing strict API correctly returned 400. The corrected test passed. No product defect was found in this pass.

The actual page controller plus live web proxy/API/database prove explicit current task saving, one row for rapid double-submit/retry within the page session, correct ownership, `rewardCredits = 0`, unchanged ledger and no saving after refusal/error/context changes. Related Phase 12/13 regressions cover completion idempotency, evidence ownership, pending NOTE evidence, deletion returning completion to AWAITING_EVIDENCE, and no early credits. Earlier phase fixtures and their independent opt-in suites were not reused.

Four delayed real-response cases cover product/capability/task/evidence changes; older results cannot overwrite newer success/error state. Dedicated state tests also cover refusal/loading/unmount/ambiguous saves. These exercise the actual UI controller and real HTTP, **not hydrated-browser visual/keyboard acceptance**. `/coach` compiled and returned 200; manual browser acceptance remains pending.

Lifecycle: fresh and repeat test runs stopped owned services. `serve` restarted the retained cluster/seed; `stop` completed with supervisor inactive and dedicated listeners closed. Offline guards reject wrong/missing/obsolete markers, linked roots, wrong paths and active ports. Tooling fixes: seed `tsx` lookup uses the API workspace; WSL stopped-port checks tolerate TIME_WAIT; fixture-plan declarations support API typecheck. No dependencies changed. Fixture state is retained for the next pass.

Validation: dedicated Coach/state **183 PASS**; focused suite **204 PASS** across seven files; default serial suite **384 PASS / 189 opt-in skipped**, 35 files passed and 15 skipped. Monorepo typecheck, changed-scope Biome check (18 files), repository format check (242 files), and `git diff --check` PASS. A sandbox TypeScript-link EPERM was rerun outside the sandbox successfully without installation. Full changed/new-file privacy scan PASS, including private in-memory comparisons against generated fixture credentials/sessions; all ten retained fixture logs also pass canary/credential checks. No real provider identifier, key, token or accidental acceptance artifact was added. Audit baseline remains 21 findings (3 critical / 9 high / 9 moderate); dependencies/lockfile are unchanged and no audit or upgrade was run.

### Pass 3 plan — prepared, not executed

After explicit authorization, add a separate opt-in provider mode using only this owned fixture and synthetic data. Load a development-only key from `%TEMP%\enough-phase15-ai\openai.env` (`OPENAI_API_KEY`; optional authorized `OPENAI_MODEL`), never root dotenv or a parent key. Ordinary test/serve must stay disabled. No credential file or enabled mode has been created in Pass 2.

Budget **seven real Responses calls maximum**, one per existing capability, sequentially with no automatic retry. Require completed schema-valid advice, capability/product scope and safe usage metadata; explicitly save one eligible task with zero reward. Classification remains advisory. A natural error/refusal is reported accurately and consumes its attempt.

No-consent/revoked/cross-account denials, disabled fallback and log checks require no additional provider calls. Existing deterministic/mock boundaries cover incomplete/refusal/timeout/API-error/malformed cases; do not manufacture real outages, unsafe prompts or redundant calls. Review provider-account terms/data handling before sending synthetic context. Scan logs without printing keys/private content; stop and retain owned state afterward. One consolidated manual browser session follows separately.

The development credential/model permission is the remaining external provider dependency. Pass 3 still needs authorization and the bounded opt-in runner mode; manual browser acceptance and provider-account review are separate Phase 15 gates. A credential alone does not complete Phase 15. **No real OpenAI credential/call, manual browser acceptance, deployment, commit or push occurred.**

### Pass 3 — bounded development-provider acceptance (2026-10-17)

The authorized run used only the dedicated development key in the owned TEMP fixture's `openai.env`. The launcher supplies an isolated child environment with an empty provider key; only the bounded child reads the key into memory. No key enters argv, subprocess environment, repository, generated config, ledger or logs. Ordinary fixture test/serve remains disabled. The current fetch-based provider transport permits exactly `https://api.openai.com/v1/responses`, POST with redirects rejected, `store: false`, the selected model and capability. This is an application transport guard, not an operating-system firewall.

Preflight passed ownership, dedicated ports/database, synthetic accounts/context, credential presence, environment isolation, captured-log privacy, disabled fallback and live revoked-consent denial. The ordinary listening API stayed disabled; the separately enabled acceptance process exercised the real Fastify Coach/privacy/task routes against the same isolated database and Redis. Each submission required both real-route consent reads and an additional immediate transport consent read. Consent grant occurred immediately before each call. Revoked consent and local fallback used zero provider calls.

Exactly **seven sequential OpenAI Responses calls**, one attempt per capability, succeeded with `gpt-6-astra` between 08:45:38 and 08:47:46 UTC. No retries occurred. Every envelope and assistant message was completed; every result passed the hardened application schema validation before acceptance.

| Capability | Result | Input / output tokens | Transport latency |
| --- | --- | --- | --- |
| ONBOARDING_ANALYSIS | PASS | 430 / 782 | 19,891 ms |
| TASK_GENERATION | PASS | 450 / 819 | 23,087 ms |
| SCOPE_CHALLENGE | PASS | 433 / 637 | 16,595 ms |
| WEEKLY_DIAGNOSIS | PASS | 448 / 771 | 19,480 ms |
| NEXT_ACTION | PASS | 474 / 664 | 17,129 ms |
| OVERBUILDING_EXPLANATION | PASS | 395 / 691 | 16,813 ms |
| EVIDENCE_CLASSIFICATION | PASS | 418 / 461 | 13,455 ms |

One current task suggestion was explicitly saved through the ordinary `/growth-tasks` route: correct account/product ownership, ACTIVE status, `reward_credits = 0`, exactly one additional task and unchanged credit transactions. No task was completed, evidenced or rewarded. No durable cross-reload idempotency claim is made. Provider calls themselves created no tasks or credits. Sequential context selection plus the focused stale-generation regressions protect request context; no browser race acceptance is claimed here.

All seven new usage rows contain only the existing schema fields: IDs/account association, capability, provider, model, status, input/output token counts, latency and creation time. The safe acceptance ledger contains only capability, attempt, timestamps, outcome/HTTP/completion categories, token counts and latency. Raw prompts/responses remain in process memory only, except the single deliberately saved suggestion. In-run log checks compare actual key/session/canary/prompt/response strings before every subsequent submission. Independent post-run inspection passes all retained acceptance logs, usage schema and changed-source credential/privacy checks; known synthetic test literals and public baseline text are not classified as newly leaked data.

After real success, the focused suite passed **220/220 across six files**, including 165 Coach API cases, 18 client state cases, 20 bounded transport cases, consent, safe logging, zero reward, incomplete/refusal/timeout/provider-error/malformed output, and stale result rejection. These negative branches use deterministic fixtures and consumed no real calls. Monorepo typecheck passed. Harness-only corrections addressed the TypeScript loader working directory, the config normalizer's absent-key representation, the usage schema's existing `provider` column and privacy-scan baseline comparison. Sandbox EPERM workspace-link reads were rerun with approval; no provider attempt was retried. No product implementation defect or provider/account limitation was found.

The bounded child cleared provider configuration and disabled its boundary on exit. The ordinary fixture was stopped cleanly and restarted in its normal provider-disabled mode; original API/web logs were retained for inspection. A representative listening-API request returned `STAGE_GUIDANCE`, with unchanged seven-call ledger and zero blocked outbound attempts after disable. State remains isolated under `%TEMP%\enough-phase15-ai` for the later browser session. Safe evidence files are `provider-ledger.json`, `provider-report.json`, `provider-inspection.json` and `provider-route.log`; never print the credential file or raw application content.

**Pass 3 PASS. Phase 15 remains ACTIVE; production NO-GO.** Provider-account policy/data-handling review and one consolidated hydrated desktop/mobile/keyboard browser acceptance remain. No Phase 14/GA4 state, production data, dependency versions, deployment, commit or push was touched. Do not rerun the exhausted provider runner: the retained ledger blocks budget reset.

### Provider policy and payload review — 2026-10-17

Scope: current official policy plus the actual `requestOpenAiAdvice` / `buildContext` payload, consent routes, client request/status code, logging and usage writer. No credential file, provider account console or administrative API was accessed; no additional model/API requests were made. All categories below describe source behavior, without fixture values or generated advice. This review follows the accepted Pass 3 run; the small payload reduction below was verified with mocked transport, not another real call.

Policy sources reviewed on **2026-10-17**:

- OpenAI, [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data), covering training, abuse monitoring, application state and residency. API input/output is excluded from model training/improvement unless the customer explicitly opts in. Default abuse logs may include prompts/responses for up to 30 days, with documented legal/safety exceptions. Modified Abuse Monitoring (MAM) and Zero Data Retention (ZDR) are distinct controls requiring eligibility and prior approval. Residency/regional processing requires project configuration and supported features. `store: false` does not prove those controls or eliminate provider retention.
- OpenAI, [OpenAI Services Agreement](https://openai.com/policies/services-agreement/), sections 3.2 and 4.2–4.3. Enough remains responsible for input rights/licenses/permissions, required user consents, and judging output accuracy and suitability. Structured schema validity does not establish factual truth or evidence eligibility.

Account-control status:

| Control | Status / source evidence |
| --- | --- |
| Actual organization/project training-data-sharing opt-in | **ACCOUNT CONFIGURATION NOT VERIFIED**; policy default is not proof of this account's sharing choices |
| Modified Abuse Monitoring | **NOT VERIFIED — ACCOUNT CONFIGURATION NOT VERIFIED**; no approval or effective project setting inspected |
| Zero Data Retention | **NOT VERIFIED — ACCOUNT CONFIGURATION NOT VERIFIED**; no approval or effective project setting inspected |
| Data residency / regional processing | **NOT VERIFIED — ACCOUNT CONFIGURATION NOT VERIFIED**; source calls the global `api.openai.com` endpoint, with no regional routing configuration; no EU-only claim |
| Enough request setting | **VERIFIED in source/tests:** `store: false`; this is not an organization/project retention control |
| Enough fixture provider mode | **VERIFIED by accepted Pass 3:** returned to disabled; seven-call budget exhausted and not reopened |

Data-category disclosure matrix, **after minimization**:

All seven requests include system/instruction content (advisory/safety rules), a capability selector, and a static output schema. These are needed to route/structure advisory responses and contain no customer values. There is no free-text Coach prompt parameter; strict request validation accepts only capability and local selection IDs. User-entered Coach data below comes from existing workspace text fields.

| Capability | Required categories / actual retained fields | Necessity of retained fields | Task content sent | Raw evidence text sent | Activity sent |
| --- | --- | --- | --- | --- | --- |
| ONBOARDING_ANALYSIS | Product/stage context; target-customer and problem-statement text; up to five active goal titles; system/instructions | Stage guidance frames the analysis; target/problem describes what is being assessed; goal titles anchor proposed next steps | None | None | None |
| TASK_GENERATION | Product/stage context; target/problem text; up to five active goal titles and fifteen active task titles; system/instructions | Target/problem and goals make suggestions relevant; existing titles avoid duplicate suggestions; task descriptions/status/history are omitted | Active titles only | None | None |
| SCOPE_CHALLENGE | Product/stage context; up to five active goal titles; selected active task title, description and estimated minutes; system/instructions | Title/description identify the work to reduce; estimate establishes its size; goals and stage guide a smaller useful outcome | Selected title/description/estimate only | None | None |
| WEEKLY_DIAGNOSIS | Product/stage context; up to five active goal titles; launch flag, user/paying-user counts, revenue amount/currency; seven-day aggregate event count; system/instructions | Goals/traction provide review context; currency gives amounts meaning; launch flag distinguishes pre/post launch; event total is explicitly a recording count, not measured customer outcomes | None | None | One seven-day sum only |
| NEXT_ACTION | Product/stage context; up to five goal titles and fifteen task titles; the same numeric traction/launch/currency fields and seven-day count; system/instructions | Stage/goals/traction prioritize one action; titles avoid recommending already active work; totals remain planning context | Active titles only | None | One seven-day sum only |
| OVERBUILDING_EXPLANATION | Product/stage guidance only; system/instructions | Stage key/label, public guidance headline, build/customer-learning percentages, priorities and signal examples support a stage-relative explanation; no measured time-allocation claim | None | None | None |
| EVIDENCE_CLASSIFICATION | Evidence-classification input: selected evidence type, title and up to 1,500 characters of its note; system/instructions | Type identifies the submitted format; title/note supply the text whose apparent topic is being classified; no other workspace context is needed | None | **Yes:** title and bounded note as authored, including for evidence types that also have files/links | None |

For every retained stage bundle in the first six rows, fields are `key`, `label`, `headline`, `buildPercent`, `marketPercent`, `priorities`, `signals`: the stage identity and public interpretation/ratio/priorities/signal examples drive the existing stage-aligned Coach behavior. They are guidance, not raw activity or inferred measurements. No goal descriptions, task histories, individual events, device/application/hostname details or event attributes are sent. There are no evidence file bytes, image/OCR extraction, evidence URL fields, integration references or storage object keys in any row.

**Identifier and credential disposition applies to every row:** direct Enough account/email/product/goal/task/evidence/device IDs are omitted from provider input; no pseudonymous account hashes, `user`, safety identifiers or provider-request metadata IDs are supplied. IDs in browser-to-Enough requests are used only for local authentication/ownership/selection. This does not make the text anonymous: names, contact details, links, identifiers and secrets typed into titles/notes can be disclosed unchanged. No application session cookie, user access token, integration credential or provider key is programmatically inserted into the prompt/body. The server's OpenAI key necessarily authenticates the HTTPS request in its Authorization header; it is not advice input and is never returned to the browser or logged. Provider authentication can associate usage with the OpenAI account; omission of Enough IDs is not anonymity from the provider.

**Minimization result:** removed the entire product-stage guidance bundle from the external EVIDENCE_CLASSIFICATION input; it is unnecessary for topic classification. The local fallback retains its existing stage context and behavior. All other workspace fields above have a concrete purpose in the current capability; no further private field removal or capability redesign was warranted. Regression coverage checks each capability's top-level and nested payload fields, omitted IDs/credentials, the 1,500-character raw-note boundary and exclusion of extra evidence/file/link/storage fields. The input schema also rejects an extra user prompt.

**Consent/disclosure result:** the existing consent still gates external execution both before context assembly and immediately before submission. Revocation denies future submissions and cannot recall prior data. Coach and Privacy copy now disclose external OpenAI processing, raw bounded evidence notes, possible sensitive values embedded in user text, and the user's permission responsibility. The linked public policy distinguishes Enough logs/metadata from provider retention. New AI consent changes record policy version `2026-10-17`; existing grants retain their historical version until changed, with no new automatic grant or assertion of re-consent. Activity consent remains on its existing version. Browser-source review found no provider key reference or public environment export in client code; status returns configuration/consent/model only.

**Enough retention boundary:** Coach preparation, failures and usage-write failures log safe categories/capability only; no prompt/response objects are passed to the logger. `admin_ai_usage_events` receives only record/account IDs, capability, provider, model, status, token counts, latency and time. Those account IDs are local pseudonymous linkage, not provider payload. Advice is not stored as an AI transcript; an explicitly saved task stores the chosen suggestion through the ordinary task API. These Enough controls make no claim about OpenAI's own retention. The accepted Pass 3 log/usage inspection remains valid; no new runtime fixture inspection or provider calls were needed for this review.

This policy/source review is complete with account controls explicitly **NOT VERIFIED**. Unverified controls are not a blocker to a synthetic, provider-disabled browser session because no special controls are claimed or relied on. Production remains NO-GO; actual operator/account settings, agreements and publication details remain production review obligations. **The one consolidated hydrated visual/keyboard browser acceptance is still pending and was not started.**

Review validation: **169 PASS** across the affected Coach API/consent and request-logging tests (166 + 3), including exact capability/nested field sets, bounded raw-note projection, omission of extra evidence fields and credentials, consent/revocation, revised AI consent policy version, metadata-only usage and safe failure logs. Monorepo typecheck, scoped Biome check on five source files, repository format check (247 files) and `git diff --check` PASS. The 36 changed/new source files pass secret/private-artifact scanning; client source has zero provider-key references. No audit, dependency changes, fixture/provider execution, commit or push was performed for this review. Before the later browser session, refresh the normal provider-disabled fixture so its isolated web copy and API load this reviewed revision; the currently retained processes predate these source changes.

### Final consolidated browser acceptance and closure — 2026-10-17

**USER-REPORTED browser results:** the user reported all six checks PASS, with no failures. Codex prepared/refreshed the owned fixture and performed final read-only verification; it did not operate or independently observe the hydrated browser session. Browser/version was not separately supplied. The session used the latest reviewed API/web/consent/privacy source with the real provider disabled throughout.

| Manual check | USER-REPORTED result and scope |
| --- | --- |
| P15-1 | **PASS:** desktop and approximately 390px layout; Tab navigation and visible focus; Enter/Space activation; reachable controls; no blocking overflow; loading/error layout usable |
| P15-2 | **PASS:** consent/privacy disclosure, grant/revoke UI, external-provider notice, raw authored evidence-note and sensitive-text disclosure, provider retention separated from Enough logging; no unverified ZDR/EU-only/regional-processing promise |
| P15-3 | **PASS:** ONBOARDING_ANALYSIS, TASK_GENERATION, SCOPE_CHALLENGE, WEEKLY_DIAGNOSIS, NEXT_ACTION, OVERBUILDING_EXPLANATION and EVIDENCE_CLASSIFICATION through hydrated controls; correct current context, readable desktop/narrow results and understandable loading; provider-disabled stage guidance, not another real-provider acceptance |
| P15-4 | **PASS:** product/capability/task/evidence selection invalidated prior results; an in-flight context change could not overwrite the newly selected context |
| P15-5 | **PASS:** exactly one suggestion explicitly saved; correct product, success/Added feedback and visible task; user observed unchanged credit balances; no completion or evidence action |
| P15-6 | **PASS:** temporary browser Offline produced a safe in-page error without crash, stack trace or raw provider payload; recovery after restoring network passed; initial/context-cleared no-result state usable. Refusal and missing-product/context states remain accepted through automated coverage only, not claimed as manually displayed |

**Final read-only browser-session verification PASS:** the pre-session baseline contains nine account tasks; exactly one additional task exists for the expected synthetic account and Product A. It is ACTIVE, `reward_credits = 0`, with `completed_at = NULL`, zero completion records and zero evidence records. Exactly one matching `growth_task.created` audit event contains the correct task/product linkage; a matching successful POST/201 request log corroborates creation through the existing task route. Source wiring remains Coach explicit save → browser `/api/tasks` → API `/growth-tasks`. No durable cross-reload idempotency is asserted.

The complete account credit-transaction count/hash and all three wallet snapshots match the pre-session baseline. Product A Available **0 → 0** and Reserved **0 → 0**; no ledger transaction was caused by advice or saving the task. Final synthetic AI consent is truthfully **revoked/disabled (`enabled = false`)**, policy version `2026-10-17`, revision `14`; it was not changed during final verification. The authenticated status read confirms provider not configured, model null and consent disabled.

All **16 retained Phase 15 logs** pass the final in-memory credential/session/canary/task/evidence-text and unsafe-body/header checks. No development API key value was read or printed. No provider/prompt/response/evidence body or prohibited task content was found in logs. Existing metadata-only usage storage remains as previously accepted. The seven-entry provider ledger is byte-for-byte unchanged from the captured baseline; **seven total real calls, sequential, no retries, no additional calls or blocked outbound attempts after disable**. Final verification ran database queries in read-only transactions and made only a loopback status GET; it did not mutate task, credit or consent data.

**Fixture shutdown PASS:** the owned supervisor stopped only its PostgreSQL 55950, Windows Redis bridge 56411 / WSL Redis 56412, API 4440 and web 3320 services. Port 4441 remained reserved/unneeded. Fixture evidence and state remain beneath `%TEMP%\enough-phase15-ai`; no destructive cleanup occurred, and `openai.env` was neither read nor modified/deleted. Preserve the exhausted provider ledger; do not reopen its budget.

| Canonical Phase 15 criterion | Accepted evidence | Result |
| --- | --- | --- |
| Development-provider success, incomplete/refusal/timeout/provider-error handling and local fallback | Pass 3 seven completed/schema-valid real successes; Pass 1/2 and final deterministic negative branches; no real calls manufactured for negative cases; disabled fallback/consent denial use zero calls | **COMPLETE** |
| Isolated schema, ownership, consent, usage and zero-reward task persistence | Pass 2 migration chain 0001–0020 and 22 live tests; accepted consent/minimization regressions; real-provider save plus browser-session read-only task/audit/ledger verification | **COMPLETE** |
| Provider terms/data disclosure, minimization and safe logs | Accepted dated official-policy/payload matrix and disclosure review; account controls explicitly NOT VERIFIED; Pass 3 privacy/usage checks plus final 16-log inspection | **COMPLETE** |
| Desktop/narrow/keyboard/loading/empty/error/unauthorized and consent behavior | USER-REPORTED P15-1–P15-6; deterministic controller/API unauthorized, refusal and missing-context coverage supplements the stated manual scope | **COMPLETE** |

Final relevant validation: **223 distinct focused tests PASS** across six files: 166 Coach API/consent/task cases, 20 page-state cases, 20 provider-boundary cases, 11 fixture-plan cases, three request-logging and three rate-limit cases. The initial final run passed 221 tests; two additional regressions directly cover the existing current-context unauthorized redirect and suppression of stale unauthorized redirects, and the revised 20-case state file passed. No application behavior changed after browser acceptance. Monorepo typecheck, changed-scope lint (25 files), repository format check, `git diff --check`, and full changed/new-file secret/privacy scanning PASS. All tracked dependency manifests retain their version/dependency configuration; root package changes add fixture commands only. Lockfile is unchanged. No dependency audit was rerun; baseline remains **21 findings (3 critical / 9 high / 9 moderate)**. No mutating runtime/provider acceptance replay was necessary or performed.

**PHASE 15 — AI LAYER: COMPLETE. PRODUCTION: NO-GO.** All four canonical criteria are accepted. Phase 11 stays ACTIVE with its existing blockers; Phase 14's Microsoft PERSONAL_MSA revocation and GA4 deferred reporting/normalization/cleanup exceptions are preserved. Release-hardening checkpoint `35f18280231613a890d10e340160e62604ccb2d8` remains supporting Phase 25 work and is not counted as Phase 15 evidence. Provider-account controls, production/legal/security/operations and later-phase gates remain project-wide obligations. No Phase 14/GA4 state, deployment, dependencies, commit or push was touched. **Phase 16 is NOT STARTED; the user has authorized the Phase 15 checkpoint commit and push only.**
