# DungeonMaestro CI/CD Pipeline Playbook

This playbook describes how CI/CD works in this repository and how to operate it safely for day-to-day development, beta shipping, and stable releases.

## Scope

The playbook covers:

- Pull request and main-branch validation
- Tag-driven release publishing
- Branch and tag naming strategy
- Operator checklists for release runs
- Failure triage by workflow stage

Related process documents:

- [llm-code-audit-checklist.md](llm-code-audit-checklist.md)

Primary workflow files:

- [.github/workflows/ci-pr.yml](../.github/workflows/ci-pr.yml)
- [.github/workflows/release-tag.yml](../.github/workflows/release-tag.yml)

Related desktop scripts/config:

- [desktop/package.json](../desktop/package.json)
- [desktop/scripts/release-secret-guard.cjs](../desktop/scripts/release-secret-guard.cjs)

## Pipeline Map

### 1. Validation lane (PR + push)

Workflow: [.github/workflows/ci-pr.yml](../.github/workflows/ci-pr.yml)

Triggers:

- pull_request to main
- push to main

What it validates:

- Desktop dependency install and renderer build
- Sidecar environment setup, compile check, and distribution build
- Artifact generation for inspection (desktop dist and sidecar dist)

Why it exists:

- Catch build and packaging regressions early
- Keep branch quality high before tagging

### 2. Release lane (tag-driven)

Workflow: [.github/workflows/release-tag.yml](../.github/workflows/release-tag.yml)

Triggers:

- push tags matching v*
- manual run via workflow_dispatch

What it produces:

- Windows NSIS installer artifacts
- Desktop dist zip
- Sidecar wheel and tar.gz distributions
- GitHub Release entry with attached artifacts

Release classification logic:

- Tags containing -alpha, -beta, or -rc are published as prerelease
- Other tags are published as stable release

## Branch and Tag Strategy

### Branches

- main: integration branch and source for releases

Suggested operating rule:

- Keep feature work in short-lived branches
- Open PRs into main
- Require CI PR workflow success before merge

### Tags

Use semantic versioning with prerelease suffixes while in beta.

Examples:

- v0.1.0-beta.11
- v0.1.0-rc.1
- v0.1.0

Tagging rule:

- Create and push tags from the commit that should be released
- Do not retag a different commit with the same tag name

## Standard Developer Flow

1. Implement changes in a feature branch.
2. Run local checks:
   - desktop build
   - sidecar compile/build if Python code changed
3. Open PR to main.
4. Wait for CI PR workflow green.
5. Merge PR.
6. If release-ready, create and push a tag from main.

## Local Preflight Commands

Run from repo root unless noted.

Desktop:

```powershell
Set-Location desktop
npm ci
npm run guard:release-secrets
npm run build
```

Sidecar:

```powershell
Set-Location ..
python -m pip install -e .
python -m compileall src/dungeon_maestro_sidecar
python -m build
```

Optional local installer rehearsal (requires free disk space):

```powershell
Set-Location desktop
npm run package:win
```

## Release Operator Checklist

### A. Before tagging

1. Confirm clean working tree.
2. Confirm target commit is on main.
3. Confirm CI PR checks are green for the commit/PR range.
4. Run local preflight (desktop and sidecar).
5. Confirm no temporary/local files are staged.

### B. Tag and push

1. Create annotated or lightweight tag using the agreed version.
2. Push branch and tag.
3. Verify release workflow started for the tag.

### C. Validate GitHub Release output

1. Installer file present.
2. Blockmap and latest yml present.
3. desktop-dist.zip present.
4. Python wheel and tar.gz present.
5. Release marked prerelease/stable as expected from tag format.

### D. Smoke test

1. Install via released installer on clean machine/profile.
2. Verify app launch, sidecar startup, and renderer asset loading.
3. Verify Discord token persistence and secure storage behavior.
4. Verify no sensitive values are present in packaged text resources.

## Failure Triage Guide

### 1) CI PR failures

#### Node install/build failed

Likely stage:

- Setup Node
- Install desktop dependencies
- Build desktop renderer

Checklist:

1. Reproduce locally in desktop with npm ci and npm run build.
2. Check package-lock drift and dependency version mismatches.
3. Confirm Node major version compatibility (workflow uses Node 20).

#### Python compile/build failed

Likely stage:

- Install sidecar build dependencies
- Validate sidecar syntax
- Build sidecar Python distributions

Checklist:

1. Reproduce with python -m compileall src/dungeon_maestro_sidecar.
2. Re-run python -m build locally.
3. Check pyproject metadata and optional dependency changes.

### 2) Release workflow failures

#### Secret guard failure (tracked files)

Likely stage:

- Release guard (tracked files)

Checklist:

1. Read the reported file and snippet in workflow logs.
2. Remove hardcoded secret material.
3. Replace with env/config injection pattern.
4. Re-tag from corrected commit.

#### Renderer dist validation failure

Likely stage:

- Validate desktop dist contents

Checklist:

1. Confirm index html exists in desktop/dist.
2. Confirm hashed js/css bundles exist in desktop/dist/assets.
3. Confirm no absolute /assets references in built index html.

#### Installer build failure

Likely stage:

- Build Windows installer

Checklist:

1. Reproduce with npm run package:win on Windows.
2. Verify available disk space (installer build can require multi-GB temp space).
3. Verify sidecar runtime preparation script completes.
4. Inspect electron-builder logs in release output folder.

#### Secret guard failure (packaged resources)

Likely stage:

- Release guard (packaged resources)

Checklist:

1. Inspect packaged resource files under desktop/release/win-unpacked/resources.
2. Identify whether issue is genuine secret or false positive pattern.
3. Fix source content and rebuild package.

#### Publish release failure

Likely stage:

- Publish GitHub Release

Checklist:

1. Confirm tag and permissions are correct (contents: write required).
2. Confirm expected artifact files exist in artifacts folder before publish step.
3. Re-run workflow_dispatch using existing tag when needed.

## Manual Rerun Procedure

If a release job fails after tag creation and no code change is needed:

1. Open GitHub Actions for Release Tag workflow.
2. Use Run workflow.
3. Provide existing tag in workflow_dispatch input when requested.

If code change is required:

1. Commit fix on main.
2. Create next tag (do not reuse previously published tag).
3. Push next tag.

## Security Practices in Pipeline

- Secret scanning guard runs before build and after packaging.
- Discord token uses secure credential storage in app runtime.
- Plaintext local settings should not contain bot token.
- Local config/test files remain ignored from git tracking.

## Implemented Baseline Controls

1. CI PR runs desktop unit tests and sidecar unit/integration smoke tests.
2. Branch protection policy can be applied as code via scripts/apply-branch-protection.ps1.
3. Release flow remains tag-driven with source and packaged secret guards.

## Recommended Next Enhancements

1. Add workflow concurrency cancellation for stale runs.
2. Add code-signing steps for installer in release workflow.
3. Add a short release notes template for consistent operator comms.

## Required Status Check Policy

Target branch: main

Required check context:

- Validate Desktop and Sidecar

Apply policy using script:

```powershell
$env:GITHUB_TOKEN = "<token-with-repo-admin-permission>"
./scripts/apply-branch-protection.ps1
```

Notes:

- The policy requires the branch to be up to date before merge (strict=true).
- If the CI job name changes, update the required context in scripts/apply-branch-protection.ps1.

## Quick Commands Reference

From repo root:

```powershell
git status --short
git branch --show-current
git tag --list "v*" --sort=version:refname
```

Create and push next beta tag:

```powershell
git tag v0.1.0-beta.11
git push origin main
git push origin v0.1.0-beta.11
```
