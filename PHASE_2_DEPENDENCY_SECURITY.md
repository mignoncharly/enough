# Phase 2 dependency security disposition

Reviewed 2026-10-09 on Windows / Node 24.19.0 / pnpm 11.20.0, HEAD
`0b3df3a65ffef936409cc03c7493923f92a61b9c` plus the Phase 2 working-tree changes.
Owner for every open item: engineering. Phase 3 remains on hold; this is triage,
not a clean audit or acceptance of unresolved risk for release.

## Final Phase 2 disposition — 2026-10-09

Fresh `pnpm audit --json` confirms the same **18 open entries: 3 critical,
8 high, 7 moderate**, exit 1. `pnpm audit --prod --json` reports **12 tar entries:
1 critical, 8 high, 3 moderate**, also exit 1. Raw evidence:
`.runtime/phase2/audit-final-review.json` and `audit-final-prod.json`.
The production-filter result shows the optional native-install dependency is
still in the production graph; it is not evidence of packaged runtime absence.

Read-only registry checks reconfirmed get-windows latest 9.3.0 still depends on
the same optional node-pre-gyp/node-gyp chain, sprintf-js latest is still 1.1.3,
and Vitest 4.1.11 / tinypool 2.1.2 exist. Maintainer
[tinypool](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr),
[tar](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw) and
[Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
advisories were rechecked. Preserve registry severity even where the maintainer
uses another rating. No new package update, override or suppression was made.

**Engineering decision:** dependency disposition is complete for Phase 2.
There is no demonstrated Phase 2 auth exposure in the reviewed source, and its
web/desktop/extension authentication and revocation exit criteria now pass.
These findings therefore do not block local Phase 3 onboarding engineering.
They remain open security/release work, not fixed findings or an accepted launch
exception. The already-recorded instruction to document risky upgrades instead
of blindly applying them remains respected. Phase 3 awaits the user's final
review; launch stays NO-GO.

| Follow-up / owner | Required closure evidence and gate |
| --- | --- |
| DEP-TAR — engineering, 12 entries | Reviewed parent-chain update or compatible backport; all listed advisories covered; Windows and macOS native install/build validation and packaged dependency inspection. Close before Phase 24 native distribution and Phase 20 security acceptance. |
| DEP-TEST — engineering, 4 entries (tinypool, Vitest/mocker) | Coordinated runner/pool upgrade or reviewed backport; unit, database/HTTP and client-adapter suites pass with no lost/skipped cases. Close before Phase 23 quality acceptance and Phase 20 security acceptance; only trusted local tests meanwhile. |
| DEP-ESBUILD — engineering, 1 entry | Update the Drizzle Kit loader chain and verify schema tooling/build compatibility. Keep affected serve mode unused; close before release toolchain acceptance in Phases 20/23. |
| DEP-SPRINTF — engineering, 1 entry | Track a published patch or review a narrow patch/parent replacement; verify desktop packaging/logging. No user-controlled format path found. Close before Phase 24 packaging acceptance, or obtain an explicit documented release-risk decision. |

All 19 original entries are accounted for: Drizzle fixed plus these 18 open.
No claim is made that the entire product security review is complete; that is
later Phase 20/23 work. Critical/high findings continue to block security/release
acceptance until remediated; no further installed-client auth test is requested.

`pnpm audit --json` initially reported **19 package/advisory entries: 3 critical,
9 high, 7 moderate** (18 distinct GHSA IDs; one advisory affects two packages).
After the sole dependency upgrade, **18 remain: 3 critical, 8 high, 7 moderate**.
Both audit commands exit 1 because findings remain. Raw evidence is in ignored
`.runtime/phase2/audit-before.json` and `audit-after.json`; advisory metadata is in
`advisory-details.json`. Registry severities are retained even where a maintainer
labels a finding differently. No exploit payload was run against any service.

## Applied change

Pinned `packages/db`'s direct `drizzle-orm` dependency from resolved 0.44.7 to
**0.45.2**. This fixes identifier/alias escaping per the
[maintainer release](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.2).
The lockfile diff changes only that package's specifier, version and integrity.
`pnpm install --ignore-scripts` and `pnpm install --frozen-lockfile --ignore-scripts`
passed. No lifecycle hook, native rebuild, migration rewrite or architecture
change was introduced. Current migrations, auth HTTP/runtime and workspace
checks are recorded in `PHASE_2_ENGINEERING_VERIFICATION.md`.

Risk assessment: a pre-1.0 minor upgrade needs verification, but Enough only
initializes `drizzle(pool)` in `packages/db/src/index.ts`; the application uses
`pg` parameterized queries, and its Drizzle schema is empty. Searches found no
application consumers of the exported `db`, `sql.identifier()` or dynamic ORM
aliases. The vulnerable identifier construction is therefore not reached by
current application inputs. Removing the dependency entirely would expand scope;
the narrow patched version was retained instead.

## Every original audit entry

“Conditional install” means the dependency really extracts archives during native
installation/rebuild, but exploitation additionally requires malicious archive
input. It is not an internet-facing Enough request handler. “Not found” describes
reviewed source reachability, not a proof that the dependency is harmless.

| # | Package / advisory | Severity | Direct or transitive; surface | Enough reachability | First patched version | Upgrade risk / recommended action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | tar 6.2.1 — [GHSA-34x7-hfp2-rc4v](https://github.com/isaacs/node-tar/security/advisories/GHSA-34x7-hfp2-rc4v), hardlink traversal | High | Transitive optional native install/build, via get-windows | Conditional install: extraction hardlinks | 7.5.7 | Major 6→7; defer blind override. Replace/update parent chain or validate a reviewed backport across native platforms before release. |
| 2 | tar 6.2.1 — [GHSA-8qq5-rm4j-mr97](https://github.com/isaacs/node-tar/security/advisories/GHSA-8qq5-rm4j-mr97), link sanitization | High | Transitive optional native install/build | Conditional install: hardlink/symlink extraction | 7.5.3 | Same tar remediation; preserve archive provenance and avoid untrusted custom binary mirrors. |
| 3 | tar 6.2.1 — [GHSA-83g3-92jg-28cx](https://github.com/isaacs/node-tar/security/advisories/GHSA-83g3-92jg-28cx), symlink-chain hardlink escape | High | Transitive optional native install/build | Conditional install: extraction follows archive links | 7.5.8 | Major upgrade; controlled parent-chain/native-build verification required. |
| 4 | tar 6.2.1 — [GHSA-qffp-2rhf-9h96](https://github.com/isaacs/node-tar/security/advisories/GHSA-qffp-2rhf-9h96), drive-relative hardlink escape | High | Transitive optional native install/build | Conditional install; Windows-specific path handling is relevant here | 7.5.10 | Major upgrade; test Windows extraction/native install before adopting. |
| 5 | tar 6.2.1 — [GHSA-9ppj-qmqm-q256](https://github.com/isaacs/node-tar/security/advisories/GHSA-9ppj-qmqm-q256), drive-relative symlink escape | High | Transitive optional native install/build | Conditional install; Windows-specific path handling | 7.5.11 | Same tar remediation; do not force a transitive major during auth acceptance. |
| 6 | tar 6.2.1 — [GHSA-r6q2-hw4h-h46w](https://github.com/isaacs/node-tar/security/advisories/GHSA-r6q2-hw4h-h46w), APFS Unicode path reservation race | High | Transitive optional native install/build | Not on this Windows run; potentially relevant to supported macOS native builds | 7.5.4 | Major upgrade; include macOS/APFS testing in remediation. |
| 7 | tar 6.2.1 — [GHSA-vmf3-w455-68vh](https://github.com/isaacs/node-tar/security/advisories/GHSA-vmf3-w455-68vh), PAX/GNU parser differential | Moderate | Transitive optional native install/build | Archive parser is used during install; no Enough archive-validation/security-boundary pipeline found | 7.5.16 | Major upgrade; include in the same tar remediation, no separate product change. |
| 8 | tar 6.2.1 — [GHSA-w8wr-v893-vjvp](https://github.com/isaacs/node-tar/security/advisories/GHSA-w8wr-v893-vjvp), PAX numeric path crash | Moderate | Transitive optional native install/build | Conditional install: crafted archive can reach parser | 7.5.18 | Major upgrade; trusted inputs reduce exposure, do not close the finding. |
| 9 | tar 6.2.1 — [GHSA-23hp-3jrh-7fpw](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw), unbounded decompression/parsing | Critical | Transitive optional native install/build | Conditional install: decompression/parser used; no user-upload tar endpoint found | 7.5.19 | Major upgrade; prioritize tar parent-chain fix before native distribution. Patched version covering all listed tar findings is at least 7.5.21. |
| 10 | tar 6.2.1 — [GHSA-8x88-c5mf-7j5w](https://github.com/isaacs/node-tar/security/advisories/GHSA-8x88-c5mf-7j5w), negative-size replace loop | High | Transitive optional native install/build | No `tar.replace`/archive update call found in Enough or the reviewed install paths | 7.5.18 | Major upgrade; fix with the tar group, do not claim an application exploit. |
| 11 | tar 6.2.1 — [GHSA-gvwx-54wh-qm9j](https://github.com/isaacs/node-tar/security/advisories/GHSA-gvwx-54wh-qm9j), NUL PAX path exception | Moderate | Transitive optional native install/build | Conditional install: crafted archive parser/extraction | 7.5.17 | Major upgrade; same tar remediation. |
| 12 | tar 6.2.1 — [GHSA-r292-9mhp-454m](https://github.com/isaacs/node-tar/security/advisories/GHSA-r292-9mhp-454m), recursive member-selection DoS | High | Transitive optional native install/build | Reviewed callers use extract options, not a member-selection list; vulnerable selection path not found | 7.5.21 | Major upgrade; fix with tar group and verify parent API compatibility. |
| 13 | tinypool 1.1.1 — [GHSA-5gmw-xhrv-c9v3](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3), inherited worker options to code execution | Critical | Transitive via root Vitest; test/dev process | Worker pool is used by tests; exploitation needs a separate prototype-pollution primitive and attacker module/options. No Enough production import or such input path found | 2.1.1 | Major 1→2 override under Vitest 3 is unverified. Prioritize a reviewed backport or coordinated test-runner upgrade; no blind override. |
| 14 | tinypool 1.1.1 — [GHSA-85c8-ppgw-ccpr](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr), inherited run filename to code execution | Critical | Transitive via root Vitest; test/dev process | Tests reach pool execution; exploit also needs polluted prototype plus a run-options object lacking an own filename. No user-facing Enough path found | 2.1.2 | Same coordinated remediation; use at least 2.1.2 for both findings, prove test-runner compatibility. Run only trusted repository tests meanwhile. |
| 15 | drizzle-orm 0.44.7 — [GHSA-gpj5-g38j-94v9](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9), identifier SQL injection | High | **Direct**, packages/db; API/web/worker runtime dependency | Initialization reached; vulnerable identifier/alias inputs not used by current Enough queries | 0.45.2 | **FIX APPLIED**: pinned 0.45.2. Low application risk based on usage; isolated DB/API and workspace verification required and recorded. |
| 16 | esbuild 0.18.20 — [GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99), development-server CORS | Moderate | Transitive drizzle-kit → @esbuild-kit/esm-loader → core-utils; dev/schema tooling | Enough uses build/transform; no affected esbuild `serve()` endpoint configured. Client build esbuild is a separate patched 0.25.x instance | 0.25.0 per maintainer (audit says ≥0.24.3) | Pre-1.0 cross-minor override outside core-utils `~0.18.20` is unverified. Update the loader/Drizzle Kit chain in a focused change; do not enable old esbuild serve mode. |
| 17 | vitest 3.2.7 — [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), redirect-mock file read | Moderate | **Direct**, root dev dependency | Configured Node `vitest run`; no browser-mode mock-server exposure found | 4.1.11 stable (also 5.0.0-rc.2) | Major runner upgrade affects mock/config/pool semantics. Document and validate separately, ideally alongside tinypool remediation. |
| 18 | @vitest/mocker 3.2.7 — [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), same redirect-mock file read | Moderate | Transitive via Vitest; dev | Same unconfigured browser-mode endpoint; distinct audit package entry, not a second exploit | 4.1.11 stable | Keep versions aligned with Vitest; do not override just mocker. |
| 19 | sprintf-js 1.1.3 — [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), precision RangeError | Moderate | Transitive optional electron-builder → app-builder-lib → @electron/get → global-agent → roarr; packaging/dev | Formatter available to build logging; no Enough user-controlled format string path found | **No published patch** in registry as of review | Audit suggests ≥1.1.4, but `pnpm view sprintf-js versions --json` ends at 1.1.3; maintainer metadata gives no patched release. Track upstream or review a narrow patch; do not request a nonexistent upgrade. |

## Dependency paths and limitations

The vulnerable tar paths are `get-windows → @mapbox/node-pre-gyp → tar`,
`get-windows → node-gyp → tar`, and
`get-windows → node-gyp → make-fetch-happen → cacache → tar`. Inspection of
node-pre-gyp `lib/install.js` and node-gyp `lib/install.js` confirms real
`tar.extract` calls. Enough imports `activeWindow` from get-windows; its normal
window-enumeration code does not extract archives. Optional production dependency
classification in the audit does **not** make this a proven remotely exploitable
desktop runtime endpoint. Native installer and packaged dependency inclusion
remain unverified; do not claim the vulnerable package is absent from artifacts.

`pnpm view get-windows@latest ...` reports 9.3.0 (already pinned), still using
node-pre-gyp ^1.0.11 and node-gyp ^10.2.0. There is no parent patch upgrade that
automatically resolves the tar group today. Vitest's latest 3.x is 3.2.7; the
required stable security update is a major version. No audit suppressions,
allowlist exceptions, lockfile regeneration, broad updates or provider changes
were made.

Recommended next security work is a separate engineering change for the native
installer dependency chain and test-runner/backport validation. The user requested
risky changes be documented instead of blindly applied; these 18 entries remain
explicitly open under that instruction. They are not silently waived for launch.
