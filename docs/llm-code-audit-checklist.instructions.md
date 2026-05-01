# LLM Code Audit Checklist

## 1. Purpose

This document defines a repeatable, iterative audit process for LLM-generated and human-authored code in this repository.

Primary goals:

- Eliminate stale and dead code
- Detect active logic that is unintentionally disabled
- Surface forgotten or underused utilities
- Detect dead or hallucinated references
- Check architecture and implementation quality against common industry standards for similar stacks
- Expand and operationalize TODO work
- Refactor convoluted, outdated, or disorganized code toward consistent design patterns

## 2. Operating Model

This process is intentionally iterative and approval-driven.

Execution loop:

1. Audit a scoped area from the bottom up.
2. Produce findings and ranked opportunities.
3. Stop for user approval before making high-impact changes.
4. Implement approved items.
5. Validate and report deltas.
6. Move to next scope.

No broad refactors should be performed without explicit approval.

## 3. Scope Traversal Strategy

Audit from low-level modules upward.

Recommended order:

1. Leaf utilities and helpers
2. Domain and runtime services
3. Integration and orchestration layers
4. Entry points and interfaces
5. Cross-cutting docs and workflows

Repository-specific traversal guidance:

1. Python sidecar modules under src
2. Electron main process modules under desktop/electron
3. Renderer logic under desktop/src
4. Build and CI config under .github and desktop scripts
5. Documentation and process artifacts under docs

## 4. Audit Phases

For each scoped area, run phases in order.

### Phase 0: Preparation

Checklist:

1. Define target scope and boundaries.
2. Identify current branch, recent commits, and ongoing in-flight work.
3. Define non-goals for this iteration.
4. Establish validation commands for this scope.

Deliverable:

- Scope declaration and audit plan for current pass

### Phase 1: Inventory and Dependency Map

Checklist:

1. Enumerate files and modules in scope.
2. Identify entry points and call graph roots.
3. Map internal dependencies and external dependencies.
4. Record exported symbols and actual consumers.

Deliverable:

- Symbol and dependency map

### Phase 2: Reachability and Dead Code

Checklist:

1. Identify functions, classes, modules, or branches with no reachable path from active entry points.
2. Distinguish intentionally dormant code from accidental dead code.
3. Verify dead candidates with reference search and runtime assumptions.
4. Classify each candidate:
   - Safe remove now
   - Keep but document intent
   - Defer pending product decision

Deliverable:

- Dead code candidate list with confidence level and removal risk

### Phase 3: Active but Inactive Behavior

Checklist:

1. Find feature paths gated by flags, defaults, or stale conditions.
2. Detect behavior expected by product docs but not exercised in code paths.
3. Identify disabled code that should be active based on current roadmap.
4. Propose minimal reactivation plan where appropriate.

Deliverable:

- Inactive behavior findings with activation recommendations

### Phase 4: Utility Utilization Audit

Checklist:

1. List utilities, helper abstractions, and shared modules.
2. Find duplicated local logic that should call existing utilities.
3. Identify useful but underutilized helpers.
4. Propose consolidation opportunities.

Deliverable:

- Utility consolidation and reuse opportunities

### Phase 5: Reference Integrity and Hallucination Detection

Checklist:

1. Detect references to missing files, symbols, commands, APIs, or config keys.
2. Detect stale naming, legacy aliases, and broken assumptions.
3. Identify docs that claim behavior not present in code.
4. Identify code that references deprecated or removed functionality.

Deliverable:

- Broken and suspicious reference report with fix priority

### Phase 5.1: Discord Compliance Integrity

Checklist:

1. Verify no self-bot or user-token authentication paths exist.
2. Verify Discord intents remain least-privilege and match runtime requirements only.
3. Verify token values are not persisted in plaintext config files, logs, or artifacts.
4. Verify compliance and secret-guard checks are enforced in CI and release workflows.

Deliverable:

- Discord compliance integrity report with any policy-risk deltas

### Phase 6: Standards and Similar-Project Comparison

Checklist:

1. Compare structure and patterns against common standards for similar stacks.
2. Compare findings against project ideals and expected behavior documented in:
   - DungeonMaestro.md
   - docs/release-checklist.md
3. Flag and classify any gaps between implementation and documented intent.
4. For Electron plus React:
   - Separation of main process, preload bridge, renderer
   - Clear IPC contracts
   - Build and packaging hygiene
5. For Python service layer:
   - Clear module boundaries
   - Testability and deterministic behavior
   - Configuration validation and error handling
6. For CI/CD:
   - Fast PR signal quality
   - Reliable release gating
   - Security checks in source and packaged artifacts

Deliverable:

- Standards gap analysis and recommended target state

### Phase 7: TODO Extrapolation and Backlog Synthesis

Checklist:

1. Aggregate explicit TODO, FIXME, and placeholder markers.
2. Infer implicit TODO items from audit findings.
3. Convert each item into action-oriented tasks with:
   - Scope
   - Risk
   - Validation method
   - Estimated effort class
4. Group by milestone and dependency ordering.

Deliverable:

- Prioritized TODO backlog derived from real code state

### Phase 8: Refactor and Standardization Proposals

Checklist:

1. Propose architecture and design cleanups that reduce complexity.
2. Prefer incremental refactors over broad rewrites.
3. Define preconditions and rollback points.
4. Specify measurable success criteria for each proposal.

Deliverable:

- Refactor proposal pack with implementation sequence

### Phase 9: Approval Gate

Before code changes, present:

1. Findings summary sorted by severity and impact.
2. Candidate actions grouped into:
   - Safe cleanups
   - Behavioral changes
   - Structural refactors
3. Explicit ask for approval per group.

No high-impact edits should proceed without approval.

### Phase 10: Implementation and Validation

Checklist:

1. Implement approved items only.
2. Keep patches small and reviewable.
3. Run relevant tests and required build checks.
4. Ensure the project build succeeds for the audited scope, and full-project build succeeds when feasible.
5. Report exact deltas and residual risks.

Deliverable:

- Change log and validation results

## 5. Severity and Priority Rubric

Severity classes:

- Critical: correctness, security, data-loss, or release-blocking risk
- High: major reliability, maintainability, or user-impact risk
- Medium: meaningful complexity or quality issue with moderate risk
- Low: minor cleanup, style, or consistency issue

Priority guidance:

- Prioritize by risk first, then by effort and dependency constraints

## 6. Per-File Checklist Template

Use this checklist for each file in scope:

1. What is this file responsible for?
2. Is it reachable from active entry points?
3. Which symbols are exported and actually consumed?
4. Are there dead branches or stale conditions?
5. Are there duplicated patterns that should use shared utilities?
6. Are there references to missing or outdated symbols/files?
7. Does this file match current architecture conventions?
8. Is there unnecessary complexity or coupling?
9. What tests currently cover this file?
10. What is the minimal safe improvement?

## 7. Findings Report Template

For each audit pass, produce:

1. Scope audited
2. Files reviewed
3. Findings by severity
4. Dead code candidates with confidence
5. Underutilized utilities
6. Broken references and hallucination suspects
7. Standards gaps
8. Documentation-alignment gaps (DungeonMaestro.md and docs/release-checklist.md)
9. Proposed actions requiring approval
10. Proposed actions safe to apply immediately
11. Validation plan for approved changes (including build success criteria)

## 8. Approval Prompt Template

Use this structure when stopping for approval:

1. Summary of top risks
2. Grouped action options
3. Expected impact and risk per option
4. Clear response choices

Example response choices:

- Approve safe cleanups only
- Approve safe cleanups plus low-risk behavioral fixes
- Approve all proposed changes for this scope
- Revise proposals before implementation

## 9. Iteration Cadence

Suggested cadence for each cycle:

1. Select one bounded scope.
2. Audit and report.
3. Obtain approval.
4. Implement and validate.
5. Update docs and backlog.
6. Move to next scope.

Stop conditions for a scope:

- No high-confidence dead code remains
- No unresolved broken references remain
- Complexity hotspots have a documented action plan

## 10. Repository Ground Rules for LLM Execution

1. Do not remove code with uncertain ownership or intent without approval.
2. Do not perform broad architectural rewrites in one pass.
3. Keep behavior-preserving cleanups separate from behavior changes.
4. Always include validation evidence for each change set.
5. Keep docs synchronized with code and workflow changes.

## 11. Maintenance of This Checklist

Update this document when:

1. CI/CD gates change
2. Architecture conventions change
3. New recurring audit failure patterns emerge
4. Approval workflow or reporting structure changes
