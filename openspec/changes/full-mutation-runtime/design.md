# Design

## Existing system and invariant

1. Canonical workload remains stryker.config.mjs: existing mutate patterns,perTest coverage,high90/low70/breaknull, default concurrency and per-mutant timeouts. Keep that file byte-identical.
2. Canonical caller remains .github/workflows/mutation.yml, with its current6-path PR filter, weekly/manual triggers, job name, runner, permissions and action pins.
3. Governing invariant: success means the whole planned mutant universe has native terminal outcomes and both final reports; no partial/duplicate/missing/unexpected/Pending result may be called complete.
4. Sibling surfaces: plan event, individual results, final JSON/HTML, process exit, upload step and advisory score must describe the same invocation and unchanged scope.

## Decision and scope challenge

5. Use one170-minute command deadline within a180-minute job cap. Current profile estimates69.8minutes dynamic plus35.4static; the slower observed hosted-rate model estimates98.2+46.7≈145minutes. Add25minutes variability reserve and10minutes job overhead/upload margin.
6. These models are sizing inferences, not proof. The actual full hosted run must finish inside the budget before merge; if not, return to diagnosis instead of automatically extending again.
7. Sharding is the alternative, but requires scope partitioning, cross-shard identities and global score aggregation. Avoid that extra failure surface while one measured full job can meet the contract.
8. This is not a per-test timeout relaxation. No change to timeoutMS, timeoutFactor, dry-run test timeout, thresholds, static handling, skips, test filters, dependencies or product code.
9. A new decision record documents the evidence-based resource budget and report contract. Check next ID/supersession at write time; decision0014 retains triggers but cross-links the new owner of its runtime budget/report clause. Do not retire unrelated rationale.

## Execution and artifacts

10. Final workflow replaces the diagnostic-only20-minute run in place. Preserve original pnpm mutation entrypoint and add built-in clear-text/progress/html/event-recorder/json reporters plus fileLogLevel info.
11. Debug/trace verbosity is not used because installed Vitest config serialization fails before the dry run (#118); this issue does not patch that dependency or suppress runtime failures.
12. Preserve CPU/RSS/cgroup sampling, identity/config/command inventory and stdout/event logs. Add an event timestamp manifest at cleanup; ZIP timestamps alone have2-second resolution.
13. Process deadline or mutation failure stays nonzero despite tee/upload success. Stop/reap only owned sampler; retain diagnostics under reports/mutation and always upload, treating missing diagnostic artifacts as failure.
14. At successful command exit, require nonempty final HTML and JSON and a single plan event. Validate every plan ID exactly once in the final JSON at its corresponding normalized source path; reject missing, duplicate, unexpected, Pending or unknown statuses. No hard-coded3440 or42/44 count: use this run's plan.
15. Native Killed/Survived/Timeout/NoCoverage/RuntimeError/CompileError/Ignored statuses remain visible and unmodified. No reclassification or new exclusion; RuntimeError is not evidence of a product bug or a killed mutant. Original advisory thresholds remain unchanged; compare reported high/low to the canonical config where supported.
16. Keep validation small and at the workflow/report boundary, without introducing a parallel mutation engine or per-file execution architecture. Existing package scripts and dependencies suffice.

## Verification phases

17. Diagnosis evidence is retained in .workplans/88/diagnosis: old30-minute terminations, current20-minute profile,37.25s dry run,97.23% mean host CPU, ample memory/noOOM,895terminal results and source-level timeout formula. The profile's0Timeout results do not retroactively explain historical9/18 counters; full execution retains data needed to inspect later timeouts.
18. Before final acceptance, execute the actual completeness validation against the matrix below. Passing fixture data is only validator evidence, never a fabricated full mutation run or score. The separate exact-head hosted full run remains mandatory.
19. Mandatory permanent-path probes cover deadline interruption, initialization failure, nonzero command exit despite otherwise usable report fixtures, and missing required diagnostics. Each proves nonzero status despite successful log capture/upload, no accepted final-score claim, retained available diagnostics, and stop/reap of only its owned sampler. Preserve a separate owned canary process to prove cleanup does not kill unrelated processes. Use the actual final workflow execution block with controlled test inputs/command boundaries on a disposable diagnostic branch or equivalent Linux harness; do not replace the system under test or ship probe modes. Retained earlier profiles supplement but do not replace these probes.
20. Run pnpm test:guardrails, workflow formatting, docs/decisions and strict fixture checks after final edits. Then run the full hosted workflow at the exact frozen commit and inspect final JSON/HTML, plan/result set equality, score, status distribution and artifacts. No local-Mac run substitutes for hosted completion.
21. Four high-risk seats inspect every diff line, resource/error handling, completeness, same-invocation evidence and unchanged gate policy. Required GitHub checks must pass at the exact head; final owner acceptance follows the consolidated queue instruction.

## Risks and rollback

22. Hosted performance varies; the measured budget is bounded but must be validated. A failed full run remains a failure and cannot be hidden by a partial native report or relaxed oracle.
23. Per-mutant durations omit some framework/recovery work; do not equate residual worker-time entirely with one cause. GNU time on timeout may measure only its wrapper; use process samples for resource claims.
24. Existing dependency-level runtime serialization failures remain explicit follow-ups and terminal native statuses, not skipped work. No product defect is inferred from intermediate survivors or tool errors.
25. Roll back the isolated workflow/decision change if required; no application/data migration. Never merge the diagnostic-only20-minute state as the permanent solution.

## Completeness fixture matrix

- Positive: one matching nonempty plan and nonempty HTML/JSON, with one native result per ID/path. A seven-row fixture covers `Killed`, `Survived`, `Timeout`, `NoCoverage`, `RuntimeError`, `CompileError` and `Ignored`; each is retained verbatim. Assert `RuntimeError` remains present under that exact status, counts as terminal and is neither rewritten nor omitted.
- Negative, independently: missing HTML, missing JSON, empty HTML, empty JSON, zero plan events, multiple plan events, empty plan, missing planned ID, duplicate ID, unexpected ID, wrong source path, Pending, unknown status. Each must fail for the relevant contract rather than unrelated broken setup.
- Validate any reported high/low threshold against canonical configuration without altering high90/low70/breaknull semantics. Partial/synthetic fixtures must never be published as the acceptance run's final score.

## Interruption fixture matrix

| Probe                               | Controlled condition                                                                              | Required observation                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline                            | Short test deadline interrupts an actual full-scope command through the final execution path      | Nonzero deadline status, available partial diagnostics uploaded, no accepted final score, owned sampler reaped and canary remains alive            |
| Initialization failure              | Native command fails before any mutant execution                                                  | Original nonzero preserved, failing phase/exit metadata and available artifacts uploaded, no accepted final score, sampler reaped and canary alive |
| Nonzero with usable report fixtures | Underlying command exits nonzero even though the validator's matching report fixtures are present | Nonzero remains authoritative despite tee/upload, reports labelled diagnostic rather than accepted completion, sampler reaped and canary alive     |
| Missing required diagnostic         | Remove one required diagnostic in an otherwise qualified controlled execution                     | Explicit missing-diagnostic failure, other available evidence uploaded, no accepted final score, sampler reaped and canary alive                   |

The deadline may be shortened only in the disposable probe environment to exercise interruption promptly; it never replaces the170-minute full-workload acceptance run. Test doubles may provide controlled subordinate-command failure, but the final workflow status/capture/cleanup logic must execute unchanged and no mock mutation success is claimed.
