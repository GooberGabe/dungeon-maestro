# Release Checklist

This checklist is intended for beta and production release readiness.

## 1. Branch and Version Prep

- Confirm release branch is created from the intended baseline (`main` or `release/*`).
- Confirm experimental work remains isolated in dedicated branches (`exp/voice-transcription`, `exp/live-track-search`) and is not part of the release scope.
- Bump versions where needed:
  - `desktop/package.json`
  - `pyproject.toml`
- Confirm release tag format (`vX.Y.Z`, `vX.Y.Z-beta.N`, `vX.Y.Z-rc.N`).

## 2. Local Preflight

- Desktop build passes: `npm run build` from `desktop`.
- Sidecar compile passes: `python -m compileall src/dungeon_maestro_sidecar`.
- Sidecar package build passes: `python -m build`.
- App starts locally and can open dashboard without renderer errors.

## 3. CI Validation

- `CI PR` workflow is green for the target branch.
- Artifacts uploaded successfully:
  - `desktop-dist`
  - `sidecar-dist`
- No unexpected warnings or dependency failures in build logs.

## 4. Functional Smoke Tests

- Session start and end work reliably.
- Collection open/switch works and priority updates are reflected in Feed resolver metrics.
- Track playback, pause/resume, seek, and skip are stable.
- Loop and crossfade settings work as expected.
- Feed diagnostics show expected runtime values.

## 5. Output Routing Checks

- Local output path verified.
- Discord route path verified (if in scope for release).
- Sidecar disconnection/recovery behavior reviewed.

## 6. Packaging and Artifact Checks

- Release workflow (`Release Tag`) completes successfully.
- GitHub Release is created from tag with generated release notes.
- Attached artifacts are present and downloadable:
  - desktop dist archive
  - sidecar wheel and sdist
- Artifact names clearly identify the release version.

## 7. Phase 6 Packaging Follow-Up (Installer Track)

- Add installer packaging step (electron-builder + sidecar bundle integration).
- Validate installer on a clean machine.
- Validate first-run sidecar launch from packaged app.
- Configure code signing and notarization (as applicable).
- Add auto-update manifest verification if updater is enabled.

## 8. Release Approval and Publish

- Product scope signoff for beta or stable release completed.
- Release notes reviewed for clarity and risk callouts.
- Known issues documented.
- Release published and announced to testers/stakeholders.

## 9. Post-Release

- Monitor runtime logs and issue tracker for regressions.
- Prepare hotfix plan if critical defects are found.
- Capture follow-up tasks for the next milestone.
