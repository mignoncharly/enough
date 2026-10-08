# Desktop and Extension Releases

## Desktop installers

Desktop packages are built on their target operating systems. A `vX.Y.Z` tag must match the versions in both `apps/desktop/package.json` and `apps/extension/package.json`. The release workflow builds a Windows x64 NSIS installer, macOS x64 and arm64 DMGs plus update ZIPs, and Linux x64 AppImage and DEB packages. It also creates the extension store archives and attaches all artifacts and updater metadata to the GitHub release.

The GitHub updater uses the repository in `GITHUB_REPOSITORY`. The repository must be public so installed apps can read release metadata and assets. For another update host, set `ENOUGH_UPDATE_URL` to a public HTTPS generic feed during packaging and publish the generated update manifests and installers to that feed. Generic feeds require the release owner to upload the files; the workflow's GitHub release job does not mirror them to a separate host.

Release builds set `ENOUGH_RELEASE_BUILD=true`. CI requires these repository secrets:

- `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`: Windows code-signing certificate and password.
- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`: Apple Developer ID Application certificate and password.
- `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`: App Store Connect API key for notarization.

The macOS runner writes the decoded API key to a temporary file. Do not commit signing keys or passwords. Local, unsigned packages can be built with `pnpm desktop:dist`; set `GITHUB_REPOSITORY=owner/repository` or `ENOUGH_UPDATE_URL` if the local package should have an update feed.

## Extension store archives

Run `pnpm extension:release:artifacts`. The output is written to `apps/extension/dist/store-packages/`:

- `enough-chrome-web-store.zip`
- `enough-edge-addons.zip`
- `enough-firefox-addons.zip`

The Chrome and Edge packages contain the Chromium build. The Firefox package contains its generated Firefox manifest and background script. Upload each archive through its store's publisher portal. The first store submissions require publisher accounts, listing identifiers, and store review; no store upload credentials are configured in this workspace.

## GitHub Actions

`.github/workflows/release.yml` supports manual artifact builds and tagged releases. A pushed `vX.Y.Z` tag creates a GitHub release after all platform builds succeed. The workflow requires the signing secrets above for Windows and macOS. It does not submit extensions to the stores; those publisher actions require the listing IDs and account credentials.

The `electron-winstaller` install hook is enabled in `pnpm-workspace.yaml` for desktop packaging. Its reviewed script selects the matching architecture's vendored 7-Zip executable and DLL for the Windows installer build.
