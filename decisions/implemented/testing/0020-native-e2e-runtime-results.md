---
id: 0020
title: Native E2E runtime results
kind: testing
status: implemented
date: 2026-11-08
---

# Native E2E runtime results

## Problem

Playwright discovery lists test titles without executing their bodies. A route-title count therefore cannot establish that the required E2E run contains zero skipped tests: an in-body skip remains discoverable alongside the route cases.

## Decision

- Run `pnpm e2e --reporter=list,json` once in the existing E2E step. Native list output remains human-readable; native JSON supplies runtime outcomes without a custom reporter or another discovery/execution pass.
- Set `PLAYWRIGHT_JSON_OUTPUT_FILE` once at job scope to `.run/ui-evidence/e2e-results.json`. Remove only that owned report immediately before the invocation. A previous report cannot qualify an execution that emits none; unrelated UI evidence remains untouched.
- The existing zero-skip step parses that same report with Node built-ins. Require an object root, an empty report-level `errors` array, correctly typed consumed suite/spec/test containers and identity fields, and native test outcomes. Compare counts of serialized test outcomes against all four nonnegative integer counters: `expected`, `unexpected`, `flaky`, and `skipped`. Missing, malformed, invalid or inconsistent evidence fails closed with a diagnostic.
- Reject every skipped outcome and identify its file, suite/test title and project. Require at least one actual spec with test entries whose title contains `renders without console errors`. This preserves route-smoke presence without claiming discovery is execution evidence or replacing the route assertions.
- Keep the E2E command's nonzero exit authoritative. Result checking is not recovery and cannot rerun tests or turn an assertion failure into success. Preserve test selection, routes, retries, timeouts, workflow triggers, permissions, concurrency group/cancellation, job identities and dependencies. `All checks passed` retains its complete needs set, `if: always()` and rejection of failed, cancelled or skipped jobs. UI upload retains `if: always()`, artifact name `ui-evidence`, path `.run/ui-evidence/` and `if-no-files-found: ignore`.

No active decision is superseded. [Decision 0013](../process/0013-pin-required-checks-to-github-actions.md) owns required-check sources; [decision 0014](../process/0014-separate-guardrail-and-mutation-triggers.md) owns guardrail/mutation triggers; [decision 0018](0018-bounded-full-mutation-completion.md) owns mutation completion evidence; [decision 0019](../process/0019-incident-scoped-hurl-recovery.md) owns incident-scoped Hurl recovery. None authorizes bypassing E2E failure.

## Alternatives considered

- **Discovery counts or source scanning:** rejected because neither observes runtime skips, including conditional or in-body skips.
- **A second execution for JSON:** rejected because its outcomes need not describe the execution whose console output and exit qualify the job.
- **Custom reporter or report-validation library:** unnecessary ownership and dependency surface when the installed Playwright reporter supplies native outcomes and Node can validate the consumed contract inline.
- **Console text parsing:** couples acceptance to presentation instead of the native result schema.
- **Accept missing reports or clear the whole evidence directory:** the former allows stale or absent evidence to qualify; the latter discards unrelated diagnostics.

## Consequences

- Native JSON is an external contract. Validate only fields consumed by this gate, not unrelated report payloads; dependency upgrades must retain the native producer/validator agreement. Outcome counters count test entries, not specs or retry attempts.
- Local protocol checks execute the actual YAML gate against a real native report and independently corrupted variants. A stale-report sentinel exercises the actual producer cleanup with a controlled no-report command. These checks do not establish browser or full-suite acceptance.
- Native CI evidence must separately establish identical runtime-skip rejection, ordinary assertion-failure propagation, and a successful complete no-skip suite. Disposable negative probes never merge; their identities and outcomes belong in issue evidence.
- Failure still attempts artifact upload, including the native report when available. No product behavior, dependency, protection rule or product changeset changes. Rollback is confined to the workflow and this policy record; there is no application/data migration.
