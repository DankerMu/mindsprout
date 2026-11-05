# Phase Flow

Load when running the workflow. Keep briefs short: point subagents at the OpenSpec fixture and the issue instead of restating them.

## Phase 0: Select Issue + OpenSpec Fixture

1. If the user named an issue, use it. Otherwise list open issues (`gh issue list --state open --limit 50 --json number,title,labels,body`), skip epics and anything whose `Depends on #XX` is still open, and pick by phase label `p0 > p1 > p2 > p3`, then priority, then lowest number. Announce the pick.
2. Read the issue body and comments. Note `Suggested fixture level` and `Minimal mergeable slice` when present (issues from `stage-change-pipeline` carry them).
3. Locate `openspec/changes/<change>/` (the issue usually names the change). If it is missing, create it:
   ```bash
   openspec new change <change-name> --description "<short issue summary>"
   openspec instructions <proposal|design|specs|tasks> --change <change-name>   # once per artifact you author
   ```
4. Triage with `issue-risk-contract.md`: fixture level (`none|compact|expanded`), selected risk packs with one-line reasons, required evidence. Start from the upstream `Suggested fixture level`; if you diverge, write the one-line reason into `proposal.md`.
5. Complete the fixture to the level's artifact set (`issue-risk-contract.md`). Every selected risk pack maps to a test, a verification command, or an explicit non-goal in `tasks.md`.
6. If `openspec/project-profile.md` exists, take the project's verification commands and known risk surfaces from it; if this issue exposes a new recurring risk surface, add a line there. Otherwise discover the build/lint/test commands from the repo (package scripts, Makefile, CI workflow).
7. Spawn one read-only `reviewer` with the fixture-review brief (`review-briefs.md`). It returns `pass` or `revise` with the missing items. On `revise`, fix the fixture and rerun; at most two revise iterations. A third `revise` means the issue itself is under-specified: stop, post the concrete gaps on the issue, and report to the user instead of repairing further.
8. `openspec validate <change-name> --strict --no-interactive` must pass before Phase 1.

## Phase 1: Implementer Subagent

1. Branch from the integration base, in the checkout you are already in (primary or linked worktree; never add a worktree):
   ```bash
   DEFAULT_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
   git fetch origin && git checkout --no-track -b feat/issue-<N>-<change-name> "origin/${DEFAULT_BRANCH:-main}"
   ```
   Branching from `origin/<default>` works the same in a linked worktree, where the local default branch is usually checked out elsewhere and cannot be switched to.
2. Spawn one `implementer` subagent with `git rev-parse --show-toplevel` as working directory and no worktree isolation. Brief:
   - Required subagent boundary (`SKILL.md`).
   - Issue number, the OpenSpec change path, fixture level and selected risk packs, key source files.
   - Scope and acceptance criteria; implementation and tests ship together; the project's verification commands must pass.
   - Do not commit, push, or open PRs.
   - Report: changed files, verification commands and results, and deviations from the fixture or brief (one line each: what, why, impact; write "no deviations" explicitly).
3. Wait quietly with a long timeout; do not poll. If the implementer fails or returns a blocker, refine the brief and retry once; then escalate.

## Phase 2: Verify, Commit, PR

1. Run the project's verification (build, lint, test) once, serially. This is the only local rerun in the workflow; reviewers receive its output as evidence and do not rerun it.
2. Audit the diff read-only against the fixture: every selected risk pack evidenced, error paths tested, existing consumers intact, no test or spec weakened to pass, and the implementer's report shows each new-behavior test red against pre-change source and green after (a missing red run is a finding: the test may verify imagined behavior). A gap becomes a Phase 3 fix item; do not patch implementation files yourself.
3. A verification failure whose cause is not evident from the output gets a diagnosis brief, not a guessed fix (see Phase 3 fix pass).
4. Stage specific files (never `git add -A`), commit `feat(<scope>): <desc> (#<issue>)`, push, and open the PR. The PR body carries a `偏离记录` section seeded from the implementer's deviation report (`无偏离` when none); fix passes append to it.

## Phase 3: Cross-Review Loop

Evidence lives in `<REVIEW_DIR>` (default `.workplans/<issue-or-pr>/review/`); persist each reviewer report and verdict there. Open the fix-pass gate first: `python3 <skill>/scripts/fix_gate.py open --pr <N>` (state in `<project>/.review-gate.json`; gitignore it).

**Round 1.** Select seats by fixture level (`review-briefs.md`): `none` skips review unless the Phase 2 audit found risk; `compact` one seat; `expanded` two or three. Spawn the seats in parallel in one batch with the reviewer brief. Reviewers are read-only and return candidate findings, not verdicts.

**Adjudicate.** Dedup candidates (same defect, same location). For each remaining candidate, check the claimed path against the diff and code and mark it CONFIRMED, PLAUSIBLE, or REFUTED with one line of evidence. Spawn a `verifier` subagent (verifier brief in `review-briefs.md`, batched by failure class, at most five candidates per batch) only for P0/P1 candidates you cannot settle from the code; take its verdict as final. Never drop a coverage finding for behavior this PR introduces. Record the verdict table in `<REVIEW_DIR>`.

**Decide.** A round is clean when no CONFIRMED P0/P1 (or PLAUSIBLE P0/P1 at `expanded`) and no coverage gap remains. Record it: `fix_gate.py record-round --sha <sha> --clean|--not-clean`. Clean means go to Phase 4; leftover P2s are noted in the work summary, not fixed. Not clean with exit 0 means a fix pass; exit 2 means the gate locked (stop rule below):

- Group findings by failure class (`risk-adaptive-cross-review` `finding-contract.md`). The same class in two places is one cross-cutting fix that audits the sibling surfaces, not two line fixes. P2s ride along in the fix list when a fix pass runs anyway.
- A finding whose cause is not established gets a diagnosis brief first: the implementer builds one command that goes red on the failure, minimizes, ranks hypotheses, and reports the confirmed cause with evidence, never a fix. Only then does it enter the fix list.
- Brief the `implementer` with the boundary, a fix list (per finding: file, problem, exact fix, required test), the verification commands, and the deviation-report instruction. Run Phase 2 verification on its result, commit, push, append deviations to `偏离记录`.

**Re-review.** After a fix pass, spawn one fresh `reviewer` (`correctness+test-evidence`) with the full diff and the fix summary: it checks that each finding is closed and that the fix introduced nothing new. Adjudicate as above. Clean means Phase 4.

**Stop rule (mechanical).** Each not-clean round buys one fix pass; the third not-clean round makes `record-round` exit 2 and set `locked` in `.review-gate.json`, and the `review-gate` hook then denies implementer/reviewer spawns. Stop the loop and report to the user: the open findings, the fixture, and a recommendation (split along `Minimal mergeable slice` when the issue declares one, redesign, or descope). Post the same on the source issue so upstream sizing learns from it. Only the user's recorded decision, `fix_gate.py extend --user-approved "<decision>"`, unlocks one more pass; abandoning or splitting ends with `fix_gate.py close`.

Out-of-scope defects found during review go to `issue-scribe` when installed (one observation per delegation; it dedups and files the issue); otherwise note them with a one-line reason in the work summary.

## Phase 4: CI, Work Summary, Merge

1. Freeze `FULL_SHA=$(git rev-parse HEAD)` and wait for CI quietly (long `gh run watch --exit-status --interval 60`, or delegate the wait to a `monitor` subagent with the run ID when installed). No polling loops in the chat.
2. CI failure: read the failing log once. Formatting, lint, flaky-timing, or workflow-wiring fixes are delegated to the implementer, verified locally, and pushed without another review round. A failure that changes source behavior, tests, or contracts re-enters Phase 3 as a fix pass. A failure that does not reproduce locally gets a diagnosis brief first.
3. Write the PR body update and the Chinese work-summary comment to local files, inspect them (no unreplaced placeholders, SHA matches `FULL_SHA`, no secrets), then post with `gh pr comment --body-file`. The PR body's `Agent Review` section lists reviewer seats used, reviewed head SHA, fixture level and risk packs, and where the reports live.

   ```markdown
   ## 工作情况说明（Merge 前）
   - 关联 Issue：#<N> ｜ PR：#<PR> ｜ 冻结提交：`<FULL_SHA>`
   - 本次改动：<按模块/行为列出主要改动>
   - 计划偏离：<汇总 偏离记录；无则写"无偏离">
   - 测试与验证：<本地命令与结果；CI 状态>
   - Review 闭环：<seats、轮次、修复项；P2 notes: <n>（见 <REVIEW_DIR>）>
   - 剩余风险与已知限制：<每条附 follow-up issue 链接或一行不落 issue 的理由；无则写"无">
   ```

4. Pre-merge checks, all against `FULL_SHA`: `.review-gate.json` records the last round as clean on this SHA (or every later commit is a CI-only repair from step 2), or the fixture is `none` and the Phase 2 audit found no risk; CI is green; `git fetch origin && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/<branch>)" ]`; every deferred finding has an issue URL or a recorded reason; each acceptance criterion in the issue and each selected `tasks.md` item is satisfied by the diff, not by the implementer's say-so. Any failure blocks the merge and returns to the owning phase.
5. When every check in step 4 passes, merge without asking:
   ```bash
   LINKED=""; if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]; then LINKED=1; fi
   if [ -n "$LINKED" ]; then git switch --detach; fi   # linked worktree: free the PR branch so --delete-branch can remove it
   gh pr merge <PR#> --merge --delete-branch
   git fetch origin
   if [ -n "$LINKED" ]; then git switch --detach "origin/${DEFAULT_BRANCH:-main}"; else git checkout "${DEFAULT_BRANCH:-main}" && git pull; fi
   gh issue close <N> --comment "Closed via merged PR #<PR#>. <summary>"
   openspec archive <change-name>
   python3 <skill>/scripts/fix_gate.py close
   ```
   In a linked worktree the default branch is checked out in the primary worktree, so `git checkout <default>` fails with "already used by worktree"; the detached `origin/<default>` tip is the equivalent end state there. Commit the archive as merge follow-up. Report the next unblocked issue; start it when the user asked for a queue run (several issues or "all"), otherwise stop.
