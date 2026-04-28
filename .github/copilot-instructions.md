# Copilot Instructions

## Mission

- Preserve behavior unless a change is explicitly requested.
- Prefer small, focused patches over broad rewrites.
- Keep architecture and naming consistent across desktop and sidecar code.

## Project Structure

- desktop/electron: Electron main process, IPC, persistence, sidecar process lifecycle.
- desktop/src: React renderer and UI state.
- src/dungeon_maestro_sidecar: Python runtime, config parsing, audio/transcription/playback.
- .github/workflows: CI and release workflows.
- docs: product, pipeline, and audit process documents.

## Required Validation

For every non-trivial change:

1. Run unit tests.
2. Run build checks for affected scope.
3. Run full project build checks when feasible.

Minimum commands used in this repo:

- From desktop: npm run test:unit
- From desktop: npm run build
- From repo root: python -m unittest discover -s tests -p "test_*.py"

## Audit and Approval Workflow

- Follow docs/llm-code-audit-checklist.md for iterative audits.
- Stop at approval gates before high-impact edits.
- Compare findings against documented ideals in:
  - DungeonMaestro.md
  - docs/release-checklist.md

## Compatibility and Design Rules

- Prefer soundscape-first naming and behavior.
- Preserve legacy collection aliases only where compatibility is required.
- Do not remove uncertain code paths without explicit approval.

## Security and Release Hygiene

- Do not introduce plaintext secret persistence.
- Keep Discord token handling aligned with secure credential storage design.
- Keep release secret guards operational in source and packaged outputs.

## CI/CD Conventions

- Main branch merges are expected to satisfy the CI PR workflow.
- Required status check context: Validate Desktop and Sidecar.
- Releases are tag-driven via v* tags.

## Documentation Discipline

When behavior, process, or architecture changes:

1. Update relevant docs in the same change set.
2. Keep docs concise and aligned with current code behavior.
