# Design: ci-openspec-archive-exemption

## Context

`check-naming.sh` builds `SCRATCH_DIR_RE="(^|/)(tmp|scratch|backup|_old|deprecated|archive|wip)(/|$)"` from `constraints.yaml`. It checks every staged added or renamed path (pre-commit), or a single path argument (the Claude Code write-time hook passes the tool's absolute `file_path`). OpenSpec's archive directory is fixed at `openspec/changes/archive/`.

## Decisions

- D1 **One literal prefix.** The exemption is a list of literal, repo-relative directory prefixes, not regexes. The list holds exactly `openspec/changes/archive/`. A literal string comparison cannot over-match the way a regex can.
- D2 **Strip, then still check.** For a path under an exempt prefix, the remainder after the prefix still runs through the scratchpad regex. The exemption covers only the `archive` segment OpenSpec forces, not anything nested under it.
- D3 **Suffix rule untouched.** `FORBIDDEN_SUFFIX_RE` keeps matching the full path. Archived change names like `2026-11-05-foo` do not hit it, and a `foo_v2.md` inside an archive is still rejected.
- D4 **Normalise write-time paths.** In path-argument mode, a path that starts with `$repo_root/` is reduced to its repo-relative form before both checks. Absolute paths elsewhere are checked as given, so a prefix never matches them and they are no less strict than today.
- D5 **Fallback parity.** If `constraints.yaml` is absent, the built-in fallback includes the same single exempt prefix, so behaviour does not depend on the file being present. If `constraints.yaml` is present but has no `exempt_prefixes` key, nothing is exempt: `constraints.yaml` is the source of truth.

## Fixture — issue #54

```text
Change surface:
  - constraints.yaml: code_canonicality.scratchpad_directories gains `exempt_prefixes: ["openspec/changes/archive/"]` (one line; the comment naming the failure mode and decision 0007 goes on the preceding line — never a trailing `# comment` on the exempt_prefixes line, which the flow-list cleanup would split into entries)
  - .git-hooks/check-naming.sh: parse exempt_prefixes, apply it to the scratchpad check, normalise path-argument mode
  - scripts/test-guardrails.sh: new cases in the naming/scratchpad area
  - AGENTS.md: the Code Canonicality scratchpad bullet names the one exemption and links decision 0007
  - decisions/implemented/process/0007-openspec-archive-exempt-from-scratchpad-guard.md (new)
  - before the final review round: tick tasks 1.1–1.5, then commit `openspec archive ci-diff-guard-labels --yes` and `openspec archive ci-openspec-archive-exemption --yes` through the normal pre-commit hook (the output must not contain "incomplete task(s)"); the final review round covers that commit; the post-merge `openspec archive` step of phase-flow is skipped for this issue (already archived in the PR)
Must preserve:
  - bash 3.2 compatibility (no mapfile, no associative arrays, no ${var,,}, no yq or other non-default dependency); `set -euo pipefail`
  - the `constraints.yaml` grep that CI runs (`grep -q 'constraints\.yaml' .git-hooks/check-naming.sh`) still matches
  - the existing stderr source lines (`FORBIDDEN_SUFFIX_RE source: …`, `SCRATCH_DIR_RE source: …`), the violation messages, exit codes (staged mode 1, path mode 2, clean 0) and the `check-naming.sh: staged paths conform.` line
  - every path rejected today that is not under `openspec/changes/archive/` is still rejected; every path accepted today is still accepted (in path mode, a repo-absolute path's verdict now matches its repo-relative verdict)
  - the scratchpad `paths` list, the forbidden-suffix patterns, `.husky/pre-commit`, `.claude/hooks/pre-write-naming.sh`
Must add:
  - parsing: `yaml_get code_canonicality.scratchpad_directories.exempt_prefixes` reads a single-line flow list (same style as `paths`), strips quotes, splits on commas and whitespace with globbing disabled (`set -f` around the split, so glob characters in an entry are never expanded); an exempt prefix is used only when it is relative (does not start with `/`) and ends with `/` — any other entry is a configuration error: print `check-naming.sh: invalid exempt prefix: <entry>` to stderr and exit 2 (fail closed, never silently ignored)
  - a stderr line `check-naming.sh: scratchpad exempt prefixes: <space-joined list or "none">`
  - matching: literal prefix comparison (quoted in [[ == "$prefix"* ]]), so glob or regex characters in a prefix are not special; a path under an exempt prefix is checked by SCRATCH_DIR_RE on the remainder only, and by FORBIDDEN_SUFFIX_RE on the full path
  - path mode: a path starting with "$repo_root/" is made repo-relative before both checks
  - fallback when constraints.yaml is absent: exempt prefixes = openspec/changes/archive/; when constraints.yaml is present without the key: none
Governing invariant: a repo-relative path is rejected by the scratchpad check iff it has a scratchpad segment outside a leading `openspec/changes/archive/` prefix; the forbidden-suffix verdict is the same as before for every repo-relative path; in path mode a repo-absolute path gets its repo-relative verdict
Sibling surfaces: the Claude Code write-time hook (absolute paths), pre-commit staged mode, CI's grep on the hook, scripts/test-guardrails.sh, AGENTS.md Enforcement Index ("Forbidden naming + scratchpad dirs" row stays accurate), decisions/archived/ (unaffected: the segment there is `archived`), subagent-workflow phase-flow.md (the archive step now works unchanged — no edit)
Seams under test: .git-hooks/check-naming.sh in staged mode and path-argument mode, driven by scripts/test-guardrails.sh
Required evidence:
  - red: the new guardrail cases fail before the hook change (the exempt-prefix accept case is rejected)
  - pnpm test:guardrails exit 0 with these new cases, staged mode unless noted:
    (a) accept openspec/changes/archive/2026-01-01-probe/proposal.md
    (b) reject src/archive/x.ts — "scratchpad directory"
    (c) reject archive/x.txt (root)
    (d) reject openspec/changes/archive/2026-01-01-probe/tmp/x.md (scratch below the prefix)
    (e) reject openspec/changes/archive/2026-01-01-probe/foo_v2.md — "forbidden naming suffix", with --absent "scratchpad directory" (the exemption applies and the suffix rule still sees the full path)
    (f) reject docs/openspec/changes/archive/x.md (prefix not at the start)
    (g) reject openspec/archive/x.md (lookalike)
    (h) path mode: accept "$wt/openspec/changes/archive/2026-01-01-probe/proposal.md"; reject "$wt/src/archive/x.ts" (exit 2) — $wt, not the harness's $repo_root: the hook's root is the worktree (git returns the symlink-resolved path, which $wt already is)
    (i) invalid config (temp repo with its own constraints.yaml, never the real one), two runs on a clean path: exempt_prefixes ["/abs/"] and exempt_prefixes ["no-slash"] → each exits 2 with "invalid exempt prefix: <entry>"
    (j) constraints.yaml present without exempt_prefixes (temp repo) → (a)'s path is rejected
    (k) temp repo with no constraints.yaml → (a)'s path accepted in path mode, src/archive/x.ts rejected (fallback parity, D5)
  - bites (apply, run pnpm test:guardrails, restore): (i) exemption applied without checking the remainder → (d) fails; (ii) unanchored prefix (substring match) → (f) fails; (iii) no path-mode normalisation → (h) accept fails; (iv) invalid entries silently ignored → both (i) runs fail; (v) fallback without the exempt prefix → (k) fails
  - /bin/bash --version is 3.2 on the dev machine and `/bin/bash .git-hooks/check-naming.sh <path>` runs for (a) and (b)
  - pnpm decisions:check, pnpm docs:check, pnpm fmt:check exit 0
  - the archive commit: `openspec archive ci-diff-guard-labels --yes` and `openspec archive ci-openspec-archive-exemption --yes` are committed by the normal pre-commit hook (no --no-verify); `openspec list` no longer lists either; openspec/specs/ci-diff-guard/spec.md and openspec/specs/naming-guard/spec.md exist with the delta content
Non-goals: relaxing any other scratchpad directory or suffix; changing OpenSpec; archiving m1-canvas (it is still in progress)
Review focus: exemption narrowness (anchoring, literal match, remainder check); fail-closed parsing; bash 3.2; path-mode normalisation; no existing verdict changed outside the prefix
```
