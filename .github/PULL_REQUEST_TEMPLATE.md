## Summary

<!-- One paragraph: what changed and why. Not what files changed (the diff already shows that). -->

## Type of change

- [ ] feat — new functionality
- [ ] fix — bug fix
- [ ] refactor — internal change, no behavioural change
- [ ] chore — tooling, deps, infra
- [ ] docs — documentation only
- [ ] test — tests only

## Test plan

<!-- How was this verified? Specific commands, env, results. "I ran the tests" is not a test plan. -->

- [ ] Unit tests pass: `pnpm test:unit`
- [ ] Integration tests pass: `pnpm test:integration`
- [ ] Lint, typecheck, boundaries pass: `pnpm check`
- [ ] Functional acceptance: <what the owner can click through or watch to accept this>

## Runtime evidence

<!-- Required: commands run + key output. For UI changes: screenshot reference from .run/ui-evidence/.
     State which tree/branch was serving, real vs. fixture data/keys, and which mode flags were active.
     Only accepted escape hatch, verbatim: "None — review-only change (reason: ...)". -->

## Risk

<!-- What could break? Who is affected if it does? What's the rollback? -->

## Decision record

<!-- Non-trivial change: link the decisions/ record shipped in this PR, or write "mechanical/local edit — no record". -->

## Canonicality check

- [ ] No `_v1`/`_v2`/`_new`/`_old`/`_backup` suffixes introduced.
- [ ] No commented-out code blocks introduced.
- [ ] No `tmp/`, `scratch/`, `wip/` directories.
- [ ] If this replaces an existing implementation, the old version is deleted in this PR (not deprecated for later).

## References

<!-- Issues, decision records, specs -->
