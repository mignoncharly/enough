# Operator-controlled releases

**PRODUCTION NO-GO.** `REMEDIATION_IMPLEMENTATION_PLAN.md` is the canonical roadmap: Phase 15 is the AI Layer; Phases 24–27 cover distribution, infrastructure, production verification and launch. Release-hardening checkpoint `35f18280231613a890d10e340160e62604ccb2d8` was previously labelled “15A”; it is supporting work for Phase 25 and does not accept the AI Layer or complete Phase 25. There is no GitHub Actions workflow; releases use approved local/release-host execution, with no Docker. Tag pushes do not automatically publish releases.

## Server release boundary

See [infra/README.md](infra/README.md) for configuration classifications, offline preflight, child-process isolation and callback logging. The production template includes policy signing, evidence storage and integration OAuth settings. Public app/API origins must be supplied at build time because Next embeds rewrite destinations.

The release CLI requires an explicit environment mode: `--clean` for install/static checks, `--test` for tests, `--build` for public origins and disposable module-evaluation values, `--runtime` for trusted preflight/runtime operations. Isolated modes reject root/web dotenv credential files. Fixtures can explicitly supply synthetic values through the helper API; parent credentials are never copied wholesale into tests.

Deployment remains blocked pending migration/evidence-storage orchestration, compatible rollback review, coordinated database/object backup and restore, and operational acceptance. The release-hardening checkpoint does not authorize executing deployment commands.

## Desktop installers

Build on target operating systems. An approved `vX.Y.Z` tag must match both desktop and extension package versions. Run `scripts/check-release-version.mjs` with `RELEASE_TAG` before the existing `pnpm desktop:dist` packaging entry point. Target installer configuration exists; signed artifacts and install/update acceptance still require evidence.

The GitHub updater requires a public repository identified by `GITHUB_REPOSITORY`, with operator-published release metadata/assets. Alternatively set `ENOUGH_UPDATE_URL` to an approved public HTTPS feed during packaging and publish generated manifests/installers there. Neither path is an automated CI publisher.

Release builds set `ENOUGH_RELEASE_BUILD=true`. Windows uses `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`; macOS uses `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` and Apple notarization credentials required by the existing packaging hooks. Inspect those hooks for exact platform requirements before execution. Signing credentials belong only in an approved signing process, never in source or install/test/static-check/web-build environments. No signing runner is provisioned by this document.

The reviewed `electron-winstaller` install hook in `pnpm-workspace.yaml` is unchanged. Signing/distribution acceptance is separate from server source validation.

## Extension store archives

`pnpm extension:release:artifacts` creates Chrome, Edge and Firefox archives in `apps/extension/dist/store-packages/`. Operators upload reviewed archives through publisher portals. Publisher accounts, listing IDs, store review and installed/update QA remain external gates.

## Remaining release gates

- Dependency audit: **21 findings — 3 critical, 9 high, 9 moderate**; no upgrade or waiver in this slice.
- Migration/evidence-storage orchestration; coordinated backup/restore; monitoring/alerting; operator/recovery approval.
- Hosted staging, physical-device and signed-distribution acceptance.
- External security approval/risk decision and legal/publication approval.
- Preserved Phase 14 exceptions: GA4 standard reporting/normalization/cleanup DEFERRED; Microsoft PERSONAL_MSA provider revocation BLOCKED by provider behavior. Provider acceptance is not reopened here.
