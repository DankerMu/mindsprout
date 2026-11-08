# Design

## Context

The required E2E job runs pnpm e2e, then a --list title-count predicate. Installed Playwright1.64.1 supports list,json reporters and PLAYWRIGHT_JSON_OUTPUT_FILE; JSON stats and nested spec.tests statuses are native runtime outcomes.

## Goals / Non-Goals

- Governing invariant: a successful zero-skip gate refers to a usable report from the one E2E execution in this job, contains no skipped runtime outcome and preserves route-smoke presence.
- Siblings: E2E command exit, list console output, JSON file, gate verdict/diagnostics, UI evidence upload, job result and All checks passed.
- Preserve triggers, contents:read, top-level concurrency.group/cancel-in-progress, job/check names, dependencies/timeouts, retries0, all product tests and both key routes. Preserve All checks passed if:always, its complete needs set and failure/cancelled/skipped rejection; preserve UI upload if:always, ui-evidence name, .run/ui-evidence/ path and if-no-files-found:ignore.
- No custom reporter, dependency change, test skip in shipped code, repeat execution, broad CI refactor or mutation changes.

## Decisions

1. Use native list,json reporting on the existing pnpm e2e invocation. Define one job-scoped JSON output path under the existing UI evidence directory so producer/validator/upload share it. Remove the owned report before execution to prevent stale qualification; do not clear screenshots or unrelated outputs.
2. Replace the discovery predicate with a small Node check in the existing gate step. Parse the report, validate the counter/status/suite fields it consumes, enumerate nested test outcomes and compare their counts with native stats. Require the independent top-level errors field to be an array and empty. Reject missing/malformed/structurally invalid or inconsistent reports and report-level errors with attributable diagnostics rather than guessing success.
3. Report skipped case file/title/project where available. Preserve the old at-least-one renders without console errors route-title guarantee using actual report entries; do not silently drop that guarantee when replacing --list. Existing E2E nonzero exit remains authoritative; gate cannot turn assertion failure into success.
4. Prefer the native reporter over a custom reporter/helper framework. Decision0020 records this new evidence contract; active source-bound gate policies remain intact.

## Verification

5. Native baseline on an unmerged disposable PR: add one issue125/deadline-linked runtime-skipped case while preserving existing route cases. Actual console must show the skip and the old gate succeeds; that is the RED regression oracle, not evidence of a prior skipped run.
6. After the fix, the identical skipped-case bytes on a disposable child PR must produce a runtime report with skip, diagnostic naming that case, failed skip gate and failed All checks passed. Temporary probes never merge.
7. Native assertion-failure probe must still fail E2E/job/aggregate and upload available UI evidence; no recovery re-executes passing tests. Main candidate's real suite is the no-skip positive control and must pass the new gate.
8. A disposable harness executes the actual gate block extracted from YAML against a real native JSON report and controlled variants: missing file, malformed JSON, wrong field types, counter/outcome mismatch, absent route-smoke entries, wrong-typed errors and a nonempty report-level errors array. Each fails with an attributable diagnostic; same real report unmodified passes. Verify stale report removal through the actual producer prefix with a sentinel and a command that emits no report.
9. Parent runs native evidence, scoped85-case guardrails, formatting/docs/decisions/strict checks; four-seat review and exact-head genuine CI before merge and separate sync/archive.

## Risks / Trade-offs

Native JSON schema is an external contract; check only consumed fields and native outcome consistency, not unrelated payload details. Rejected reports remain uploaded for diagnosis. Intentional skips are rejected rather than silently treated as coverage. Recovery from external Hurl failures remains decision0019, not test retries.

## Migration Plan

No product/data migration. Revert the isolated workflow/report-policy change if needed. No per-issue owner acceptance prompt or required-check bypass.
