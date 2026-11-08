# Design

## Context

1. The canonical CLI is scripts/check-diff-size.sh; pr-diff-guard.yml invokes it. Issue44 is merged; no workflow relocation remains.
2. Default `**/` pathspecs omit root paths. Issue50 supplies the confirmed cause and historical1692 count; do not spend a run reconfirming the old report.
3. Governing invariant: generated lockfiles/snapshots are excluded at every intended depth, while ordinary changed lines retain identical threshold and failure semantics.

## Scope and decisions

4. Exact edits: `:(exclude)**/pnpm-lock.yaml` → `:(glob,exclude)**/pnpm-lock.yaml`; `:(exclude)**/__snapshots__/**` → `:(glob,exclude)**/__snapshots__/**`; `:(exclude)**/*.snapshot` → `:(glob,exclude)**/*.snapshot`. Keep all other pathspecs, diff-filter, whitespace handling and line regex unchanged.
5. Alternative: add a root-only literal lockfile path; rejected because it leaves the two snapshot siblings inconsistent and duplicates path policy.
6. Sibling audit: root/nested `pnpm-lock.yaml`; root/nested `__snapshots__` contents; root/nested `*.snapshot`; existing `*.lock`/changeset/decision exclusions; ordinary similarly named files remain counted.
7. No threshold, label lookup/exemption, trigger, required context, lockfile-pairing or template changes. Excluded contents remain subject to independent gates.
8. Preserve usage/base-ref/limit/git-diff fail-closed paths and exact label behavior. This is not permission to skip those checks.
9. A bug-fix decision records the path-semantics correction without changing gate policy. Author checks supersession and next ID at write time; no record retired just for quota.

## Verification

10. Reuse scripts/test-guardrails.sh fixture plumbing, source-tree script under test and cleanup. Do not create an implementation worktree; its existing throwaway test worktree is test infrastructure only.
11. First add native regression cases, stop for parent-run pnpm test:guardrails RED on unchanged script, then change the three production patterns.
12. The fixture matrix below pins paths, inputs, numeric counts and statuses. Each row starts from the clean fixture base; append lockfile lines rather than replacing existing content.
13. Extend the existing `expect_accept` with optional `--line` exact-output matching while preserving `--what` and all current callers. Capture one actual command execution, require exit0 and the full count line; never rerun to inspect output. Existing `expect_reject --line` handles rejected cases.
14. Existing401 ordinary-line rejection and400 boundary acceptance must remain. Existing exemptions, malformed base/limit, failed diff and cleanup cases stay intact.
15. Historical smoke: create an isolated temporary local clone, detach it at `ad97d5b`, and run `env -u PR_LABELS bash /Users/danker/Desktop/AI-vault/mindsprout/scripts/check-diff-size.sh 'ad97d5b^'` with that clone as cwd. Preserve its original constraints/tree. Require exit1 and exact line `Changed lines (excluding lockfiles/snapshots/records): 1684 (limit: 400)`. Capture logs before removing the owned temporary clone. Do not rerun supplied1692 baseline; independently attribute removed8 lines to the root lockfile.
16. Parent runs guardrails after fix, historical native smoke, formatting, docs/decisions, strict fixture validation and scoped diff check. Capture exact command/exit/output; no network or paid key required for fixtures.
17. No fake git/echo-based count oracle. Tests must invoke the actual guard and use real committed fixture diffs; inspect both exit and exact count.
18. Owner acceptance is gate behavior: generated files excluded, ordinary401 still fails; no threshold relaxation. Four high-risk review seats inspect all changed lines.

## Risks and rollback

19. Glob semantics can accidentally broaden exclusions; sibling/near-miss exact-count cases bound that risk. Existing generated-file policy, not every file containing a similar name, is authoritative.
20. Synthetic fixture files are test-only and restored. Never alter the real root lockfile or package manifest for this issue.
21. Historical source-tree execution uses an isolated clone, not checkout mutation of the implementation branch; clean temporary resources after preserving logs.
22. Rollback is the isolated commit revert; no persisted data migration or application behavior change.

## Native fixture matrix

Every generated line is nonblank and matches the unchanged line-count expression. Expected output is exactly `Changed lines (excluding lockfiles/snapshots/records): N (limit: 400)`. No exemption label is set. Before/after entries are `LINES / exit`.

| Case                      | Exact paths and delta                                                                                                                           | Before        | After   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| Root lockfile             | Append401 lines to `pnpm-lock.yaml`                                                                                                             | 401 / 1 (RED) | 0 / 0   |
| Paired manifest           | Append401 lockfile lines; insert one new valid JSON property line after the opening brace in `package.json`, leaving every prior line unchanged | 402 / 1 (RED) | 1 / 0   |
| Nested lockfile           | New `sub/pnpm-lock.yaml`,401 lines                                                                                                              | 0 / 0         | 0 / 0   |
| Root snapshot directory   | New `__snapshots__/fixture.txt`,401 lines                                                                                                       | 401 / 1 (RED) | 0 / 0   |
| Nested snapshot directory | New `sub/__snapshots__/fixture.txt`,401 lines                                                                                                   | 0 / 0         | 0 / 0   |
| Root snapshot suffix      | New `fixture.snapshot`,401 lines                                                                                                                | 401 / 1 (RED) | 0 / 0   |
| Nested snapshot suffix    | New `sub/fixture.snapshot`,401 lines                                                                                                            | 0 / 0         | 0 / 0   |
| Lockfile near-miss        | New `pnpm-lock.yaml.txt`,401 lines                                                                                                              | 401 / 1       | 401 / 1 |
| Directory near-miss       | New `__snapshots__extra/fixture.txt`,401 lines                                                                                                  | 401 / 1       | 401 / 1 |
| Suffix near-miss          | New `fixture.snapshot.txt`,401 lines                                                                                                            | 401 / 1       | 401 / 1 |

Near-misses are separate fixtures, outside excluded record directories. Nested/near-miss rows preserve behavior and need not fail before the correction; the four root regression rows supply semantic RED. Existing ordinary400/401 cases remain unchanged.
