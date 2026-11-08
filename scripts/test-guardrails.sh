#!/usr/bin/env bash
# scripts/test-guardrails.sh — proves each wired guard actually rejects what it
# claims to reject. Creates one violation per guard in a throwaway worktree and
# asserts the guard EXITS NON-ZERO and names the reason. Exit 126/127 (missing tool,
# non-executable hook) counts as FAIL — "not runnable" is phantom enforcement, not rejection.
# Every process a fixture starts is reaped here, and a leftover one is a FAIL.
set -u

repo_root="$(git rev-parse --show-toplevel)" || exit 1
tmp="$(mktemp -d "${TMPDIR:-/tmp}/guardrails.XXXXXX")" || exit 1
tmp="$(cd "$tmp" && pwd -P)" || exit 1
wt="$tmp/wt"
mkdir -p "$tmp/pids" "$tmp/logs" "$tmp/bin"

spawn_fixture() {
  name="$1"
  shift
  if [ -e "$tmp/pids/$name" ]; then
    echo "FATAL: fixture \"$name\" started twice — pid records are per fixture" >&2
    exit 1
  fi
  ( set -m; "$@" </dev/null >"$tmp/logs/$name.log" 2>&1 & echo "$!" > "$tmp/pids/$name" )
}

fixture_groups_alive() {
  for f in "$tmp"/pids/*; do
    [ -f "$f" ] && kill -0 -- "-$(cat "$f")" 2>/dev/null && return 0
  done
  return 1
}

reap_fixtures() {
  for f in "$tmp"/pids/*; do
    [ -f "$f" ] && kill -TERM -- "-$(cat "$f")" 2>/dev/null
  done
  i=0
  while fixture_groups_alive && [ "$i" -lt 50 ]; do
    sleep 0.1
    i=$((i + 1))
  done
  for f in "$tmp"/pids/*; do
    [ -f "$f" ] && kill -KILL -- "-$(cat "$f")" 2>/dev/null
  done
  return 0
}

fixture_strays() {
  ps -A -ww -o pid= -o args= | FIXTURE_ROOT="$tmp" awk 'index($0, ENVIRON["FIXTURE_ROOT"])'
}

kill_strays() {
  kill -KILL $(printf '%s\n' "$1" | awk '{ print $1 }') 2>/dev/null
}

cleanup() {
  cd "$repo_root" || exit 1
  reap_fixtures
  strays=$(fixture_strays)
  [ -n "$strays" ] && kill_strays "$strays"
  rm -rf "$wt/node_modules"
  git worktree remove --force "$wt" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git -C "$repo_root" worktree add --quiet --detach "$wt" || {
  echo "FATAL: could not create temp worktree (need at least one commit)" >&2
  exit 1
}
cd "$wt" || exit 1

pass=0
fail=0

# expect_reject [--line <exact output line>] [--absent <text>] <name> <reason> <cmd...>
# --line also requires one output line to equal the text; --absent requires the text to be missing.
expect_reject() {
  line=""
  absent=""
  while :; do
    case "$1" in
      --line) line="$2"; shift 2 ;;
      --absent) absent="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  name="$1"
  reason="$2"
  shift 2
  out=$("$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "FAIL  $name — guard ACCEPTED the violation (phantom enforcement)"
    fail=$((fail + 1))
  elif [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
    echo "FAIL  $name — guard not runnable (exit $rc): missing tool or non-executable hook"
    fail=$((fail + 1))
  elif ! printf '%s\n' "$out" | grep -qF -- "$reason"; then
    echo "FAIL  $name — exited $rc without naming \"$reason\" — crash, not rejection:"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=$((fail + 1))
  elif [ -n "$line" ] && ! printf '%s\n' "$out" | grep -qxF -- "$line"; then
    echo "FAIL  $name — exited $rc without the line \"$line\":"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=$((fail + 1))
  elif [ -n "$absent" ] && printf '%s\n' "$out" | grep -qF -- "$absent"; then
    echo "FAIL  $name — exited $rc but printed \"$absent\" (must abort before that):"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=$((fail + 1))
  else
    echo "PASS  $name — guard rejected the violation and named it (exit $rc)"
    pass=$((pass + 1))
  fi
}

skip() {
  echo "SKIP  $1 — $2 (a skipped guard is a readiness gap, not a pass)"
}

# expect_accept [--what <accepted input>] [--line <exact output line>] <name> <cmd...>
# --what defaults to "the clean tree"; --line requires one output line to equal the text.
expect_accept() {
  what="the clean tree"
  line=""
  while :; do
    case "$1" in
      --what) what="$2"; shift 2 ;;
      --line) line="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  name="$1"
  shift
  out=$("$@" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "FAIL  $name — guard REJECTED $what (exit $rc; always-failing guard or broken setup):"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=$((fail + 1))
  elif [ -n "$line" ] && ! printf '%s\n' "$out" | grep -qxF -- "$line"; then
    echo "FAIL  $name — accepted $what without the line \"$line\":"
    printf '%s\n' "$out" | sed 's/^/        /'
    fail=$((fail + 1))
  else
    echo "PASS  $name — guard accepts $what"
    pass=$((pass + 1))
  fi
}

# 0. Clean-state baseline — every directly runnable guard must accept the untouched worktree.
expect_accept "naming guard (clean tree)" bash .git-hooks/check-naming.sh
expect_accept "secret guard (clean tree)" bash scripts/check-secrets.sh
expect_accept "test-pairing guard (clean tree)" bash scripts/check-test-pairing.sh
expect_accept "docs gate (clean tree)" node scripts/check-docs.mjs
expect_accept "decisions gate (clean tree)" node scripts/check-decisions.mjs

# 1. Naming guard — forbidden suffix.
echo "guardrail self-test" > "foo_v2.ts"
git add "foo_v2.ts"
expect_reject "naming guard (foo_v2.ts)" "forbidden naming suffix" \
  bash .git-hooks/check-naming.sh
git reset --quiet -- "foo_v2.ts"
rm -f "foo_v2.ts"

# 2. Scratchpad guard — forbidden directory.
mkdir -p scratch
echo "guardrail self-test" > scratch/note.txt
git add scratch/note.txt
expect_reject "scratchpad guard (scratch/)" "scratchpad directory" \
  bash .git-hooks/check-naming.sh
git reset --quiet -- scratch/note.txt
rm -rf scratch

# 2a. Scratchpad exemption — only OpenSpec's fixed archive prefix is exempt (decision 0007).
# Like the diff guard, these cases run the hook under test from the repo root with the worktree
# as cwd, and the worktree reads the repo root's constraints.yaml for this section (restored at
# the end), so the uncommitted versions are the ones tested. Cases (i)–(k) use throwaway repos
# under $tmp with a copy of the hook and their own constraints.yaml (or none); the real one is
# only ever read.
naming_hook="$repo_root/.git-hooks/check-naming.sh"
cp "$repo_root/constraints.yaml" constraints.yaml
probe_staged() {
  mkdir -p "$(dirname "$1")" && echo "guardrail self-test" > "$1" && git add -- "$1"
}
drop_staged() {
  git reset --quiet -- "$1" && rm -f -- "$1"
}
in_dir() {
  (cd "$1" && shift && "$@")
}
naming_repo() {
  rm -rf "$1" && mkdir -p "$1/.git-hooks" && git -C "$1" init --quiet &&
    cp "$naming_hook" "$1/.git-hooks/check-naming.sh"
}
archive_ok="openspec/changes/archive/2026-01-01-probe/proposal.md"

probe_staged "$archive_ok"
expect_accept --what "$archive_ok" "scratchpad exemption (a) $archive_ok" bash "$naming_hook"
drop_staged "$archive_ok"

for c in "b src/archive/x.ts" "c archive/x.txt" "d openspec/changes/archive/2026-01-01-probe/tmp/x.md" \
  "f docs/openspec/changes/archive/x.md" "g openspec/archive/x.md"; do
  p="${c#* }"
  probe_staged "$p"
  expect_reject --line "  scratchpad directory:    $p" "scratchpad exemption (${c%% *}) $p" \
    "scratchpad directory" bash "$naming_hook"
  drop_staged "$p"
done

p="openspec/changes/archive/2026-01-01-probe/foo_v2.md"
probe_staged "$p"
expect_reject --line "  forbidden naming suffix: $p" --absent "scratchpad directory" \
  "scratchpad exemption (e) $p" "forbidden naming suffix" bash "$naming_hook"
drop_staged "$p"
rm -rf openspec/changes/archive/2026-01-01-probe src/archive archive docs/openspec openspec/archive
rmdir openspec/changes/archive 2>/dev/null

expect_accept --what "a repo-absolute exempt path" "scratchpad exemption (h) write-time \$wt/$archive_ok" \
  bash "$naming_hook" "$wt/$archive_ok"
expect_reject --line "naming violation (write-time): $wt/src/archive/x.ts — see AGENTS.md § Code Canonicality" \
  "scratchpad exemption (h) write-time \$wt/src/archive/x.ts" "naming violation (write-time)" \
  bash "$naming_hook" "$wt/src/archive/x.ts"

for entry in /abs/ no-slash; do
  naming_repo "$tmp/naming-invalid" &&
    sed "s|^    exempt_prefixes:.*\$|    exempt_prefixes: [\"$entry\"]|" "$repo_root/constraints.yaml" \
      > "$tmp/naming-invalid/constraints.yaml"
  expect_reject --line "check-naming.sh: invalid exempt prefix: $entry" --absent "scratchpad exempt prefixes:" \
    "scratchpad exemption (i) exempt_prefixes [\"$entry\"]" "invalid exempt prefix: $entry" \
    in_dir "$tmp/naming-invalid" bash .git-hooks/check-naming.sh src/clean.ts
done

naming_repo "$tmp/naming-nokey" &&
  grep -v '^    exempt_prefixes:' "$repo_root/constraints.yaml" > "$tmp/naming-nokey/constraints.yaml"
in_dir "$tmp/naming-nokey" probe_staged "$archive_ok"
expect_reject --line "  scratchpad directory:    $archive_ok" \
  "scratchpad exemption (j) constraints.yaml without exempt_prefixes" "scratchpad directory" \
  in_dir "$tmp/naming-nokey" bash .git-hooks/check-naming.sh

naming_repo "$tmp/naming-nofile"
expect_accept --what "$archive_ok without constraints.yaml" "scratchpad exemption (k) fallback $archive_ok" \
  in_dir "$tmp/naming-nofile" bash .git-hooks/check-naming.sh "$archive_ok"
expect_reject "scratchpad exemption (k) fallback src/archive/x.ts" "naming violation (write-time)" \
  in_dir "$tmp/naming-nofile" bash .git-hooks/check-naming.sh src/archive/x.ts
rm -rf "$tmp/naming-invalid" "$tmp/naming-nokey" "$tmp/naming-nofile"

# 2b. Staged paths are judged by their real bytes (#61): without -z, git C-quotes a path that
# holds non-ASCII or control bytes, and the quoted form slips past both anchored regexes.
staged_case() { # staged_case <case> <label> <path> <reason> <exact output line>
  probe_staged "$3"
  expect_reject --line "$5" "naming staged ($1) $2" "$4" bash "$naming_hook"
  drop_staged "$3"
}
staged_case n1 "tmp/é.md" "tmp/é.md" "scratchpad directory" "  scratchpad directory:    tmp/é.md"
staged_case n2 "tmp/x<LF>y.md" "$(printf 'tmp/x\ny.md')" "scratchpad directory" \
  "  scratchpad directory:    tmp/x"
staged_case n3 "note_é_new" "note_é_new" "forbidden naming suffix" "  forbidden naming suffix: note_é_new"
staged_case n4 "docs é/Backup" "docs é/Backup" "forbidden naming suffix" \
  "  forbidden naming suffix: docs é/Backup"
p="openspec/changes/archive/2026-01-01-probe/说明.md"
probe_staged "$p"
# The accept only means something if the probe is really staged under its exact bytes.
expect_accept --what "$p staged" "naming staged (n5) probe is staged" \
  sh -c 'git diff --cached --name-only -z | tr "\0" "\n" | grep -qxF -- "$1"' sh "$p"
expect_accept --what "$p" "naming staged (n5) $p" bash "$naming_hook"
drop_staged "$p"
p="openspec/changes/archive/2026-01-01-probe/tmp/说明.md"
staged_case n6 "$p" "$p" "scratchpad directory" "  scratchpad directory:    $p"
rm -rf tmp "docs é" openspec/changes/archive/2026-01-01-probe
rmdir openspec/changes/archive 2>/dev/null

# 2c. Path mode judges an absolute path by where it physically is (#59, decision 0008): outside
# the worktree → accepted; inside, also through a symlink → the repo-relative verdict; a `..`
# segment never earns the outside verdict.
path_reject() { # path_reject <case> <label> <path argument>
  expect_reject --line "naming violation (write-time): $3 — see AGENTS.md § Code Canonicality" \
    "naming path mode ($1) $2" "naming violation (write-time)" bash "$naming_hook" "$3"
}
mkdir -p "$tmp/outside/scratch"
ln -s "$wt" "$tmp/wt-link"
ln -s "$wt/src" "$tmp/l"
expect_accept --what "a path outside the repository" \
  "naming path mode (p1) \$tmp/outside/scratch/notes_old.md" bash "$naming_hook" "$tmp/outside/scratch/notes_old.md"
expect_accept --what "a path outside the repository" \
  "naming path mode (p1) /tmp/scratch-probe/x_old.md" bash "$naming_hook" /tmp/scratch-probe/x_old.md
expect_accept --what "a non-existent path outside the repository" \
  "naming path mode (p2) /nonexistent-mindsprout-probe/notes_old.md" \
  bash "$naming_hook" /nonexistent-mindsprout-probe/notes_old.md
path_reject p3 "\$wt/scratch/x.md" "$wt/scratch/x.md"
path_reject p3 "\$wt/foo_v2.ts" "$wt/foo_v2.ts"
path_reject p4 "\$tmp/wt-link/scratch/x.md" "$tmp/wt-link/scratch/x.md"
expect_accept --what "an exempt path reached through a symlink" \
  "naming path mode (p4) \$tmp/wt-link/$archive_ok" bash "$naming_hook" "$tmp/wt-link/$archive_ok"
path_reject p5 "scratch/x.md" "scratch/x.md"
path_reject p5 "foo_v2.ts" "foo_v2.ts"
path_reject p6 "\$tmp/nope/../wt/foo_v2.ts" "$tmp/nope/../wt/foo_v2.ts"
path_reject p6 "\$tmp/nope/../wt/scratch/x.md" "$tmp/nope/../wt/scratch/x.md"
path_reject p6 "\$tmp/l/../foo_v2.ts (\$tmp/l -> \$wt/src)" "$tmp/l/../foo_v2.ts"
# p7: another spelling of the same directory (here case; also firmlinks, Unicode normalisation)
# must not read as outside. Needs a case-insensitive filesystem (default macOS APFS).
wt_upper="$(printf '%s' "$wt" | tr '[:lower:]' '[:upper:]')"
if [ "$wt_upper" != "$wt" ] && [ -d "$wt_upper" ] && [ "$wt_upper" -ef "$wt" ]; then
  path_reject p7 "\$WT/scratch/x.md (upper-cased \$wt)" "$wt_upper/scratch/x.md"
  path_reject p7 "\$WT/foo_v2.ts (upper-cased \$wt)" "$wt_upper/foo_v2.ts"
else
  skip "naming path mode (p7) upper-cased \$wt" "filesystem is case-sensitive, so no case alias of \$wt exists"
fi
rm -rf "$tmp/outside"
rm -f "$tmp/wt-link" "$tmp/l"
git checkout --quiet -- constraints.yaml

# 3. Secret guard — a credential-shaped token in a staged addition.
printf 'const key = "sk-ant-%s";\n' "$(printf 'x%.0s' $(seq 1 40))" > leak.ts
git add leak.ts
expect_reject "secret guard (sk-ant- token)" "possible secret" \
  bash scripts/check-secrets.sh
git reset --quiet -- leak.ts
rm -f leak.ts

# 4. TDD pairing guard — a new production file without its test.
mkdir -p src/shared
echo "export const orphan = 1;" > src/shared/orphan.ts
git add src/shared/orphan.ts
expect_reject "test-pairing guard (src/shared/orphan.ts)" "missing paired test" \
  bash scripts/check-test-pairing.sh
git reset --quiet -- src/shared/orphan.ts
rm -f src/shared/orphan.ts

# 5. Docs gate — a dead relative link.
printf '# Broken\n\nSee [missing](./does-not-exist.md).\n' > docs/guardrail-fixture.md
expect_reject "docs gate (dead link)" "dead link" \
  node scripts/check-docs.mjs
rm -f docs/guardrail-fixture.md

# 6. Decisions gate — a record with an unknown kind.
mkdir -p decisions/proposed
printf -- '---\nid: 9999\ntitle: Fixture\nkind: vibes\nstatus: proposed\ndate: 2026-01-01\n---\n\n## Alternatives considered\n\n- none\n' > decisions/proposed/9999-fixture.md
expect_reject "decisions gate (unknown kind)" "unknown kind" \
  node scripts/check-decisions.mjs
rm -f decisions/proposed/9999-fixture.md

# 7. Boundaries guard — domain-is-pure admits zod (decision 0005) and nothing else;
# test files are exempt from it (decision 0006). no-framework-in-domain-or-application rejects
# next/react/react-dom/drizzle-orm/postgres/@supabase in domain/ and application/ (#37).
# depcruise reads the repo root's .dependency-cruiser.cjs, copied into the worktree for this
# section (restored at the end) so the uncommitted version is the one tested, and must resolve
# the probed packages. A symlink to the root node_modules would resolve to real paths
# outside the worktree (matching no rule path), so mirror only zod, react, vitest and postgres
# into the worktree, keeping pnpm's .pnpm/<pkg>@<ver>/node_modules/<pkg> layout when present.
mirror_package() {
  pkg="$1"
  nm="$(cd "$repo_root/node_modules" && pwd -P)" || return 1
  real="$(cd "$repo_root/node_modules/$pkg" && pwd -P)" || return 1
  rel="${real#"$nm"/}"
  if [ "$rel" = "$real" ]; then
    cp -R "$real" "$wt/node_modules/$pkg"
  else
    mkdir -p "$wt/node_modules/$(dirname "$rel")" &&
      cp -R "$real" "$wt/node_modules/$rel" &&
      ln -s "$rel" "$wt/node_modules/$pkg"
  fi
}
depcruise_bin="$repo_root/node_modules/.bin/depcruise"
mkdir -p "$wt/node_modules"
if [ ! -x "$depcruise_bin" ] || [ ! -f "$repo_root/.dependency-cruiser.cjs" ]; then
  skip "boundaries guard" "depcruise not installed at $depcruise_bin or no .dependency-cruiser.cjs"
elif ! mirror_package zod || ! mirror_package react || ! mirror_package vitest ||
  ! mirror_package postgres; then
  skip "boundaries guard" "could not mirror zod/react/vitest/postgres from $repo_root/node_modules"
else
  cp "$repo_root/.dependency-cruiser.cjs" .dependency-cruiser.cjs
  mkdir -p src/contexts/map/domain
  printf "import { z } from 'zod';\nexport const probe = z.string();\n" > src/contexts/map/domain/zod-probe.ts
  expect_accept "boundaries guard (zod in domain)" \
    "$depcruise_bin" src --config .dependency-cruiser.cjs
  printf "import { describe } from 'vitest';\nimport { z } from 'zod';\nexport const probe = z.string();\ndescribe;\n" \
    > src/contexts/map/domain/zod-probe.test.ts
  expect_accept "boundaries guard (test file in domain)" \
    "$depcruise_bin" src --config .dependency-cruiser.cjs
  printf "import 'react';\n" > src/contexts/map/domain/react-probe.ts
  expect_reject "boundaries guard (react in domain)" "domain-is-pure" \
    "$depcruise_bin" src --config .dependency-cruiser.cjs
  expect_reject "boundaries guard (b3) react in domain also names the framework rule" \
    "no-framework-in-domain-or-application" "$depcruise_bin" src --config .dependency-cruiser.cjs
  rm -f src/contexts/map/domain/zod-probe.ts src/contexts/map/domain/zod-probe.test.ts \
    src/contexts/map/domain/react-probe.ts
  mkdir -p src/contexts/map/application
  printf "import 'react';\n" > src/contexts/map/application/react-probe.ts
  expect_reject "boundaries guard (b1) react in application" "no-framework-in-domain-or-application" \
    "$depcruise_bin" src --config .dependency-cruiser.cjs
  rm -f src/contexts/map/application/react-probe.ts
  printf "import 'postgres';\n" > src/contexts/map/application/postgres-probe.ts
  expect_reject "boundaries guard (b2) postgres in application" "no-framework-in-domain-or-application" \
    "$depcruise_bin" src --config .dependency-cruiser.cjs
  rm -f src/contexts/map/application/postgres-probe.ts
  git checkout --quiet -- .dependency-cruiser.cjs
fi
rm -rf "$wt/node_modules"

# 7a. Duplicate-code gate — the working-tree package.json scripts.duplicate-code (read at runtime,
# not retyped) must load jscpd.json, so test files count as neither clones nor lines (#47); and
# jscpd.json's threshold, the only one that runs, must equal constraints.yaml
# anti_drift.duplicate_code_threshold_percent. The gate runs in throwaway dirs under $tmp,
# outside the worktree, each holding a copy of the working-tree jscpd.json.
dup_script=$(node -e 'process.stdout.write(require(process.argv[1]).scripts["duplicate-code"] || "")' \
  "$repo_root/package.json")
dup_clone() { # dup_clone <file> — writes one block far above jscpd's minimum clone size
  cat > "$1" <<'CLONE'
export function probeTotal(items: readonly number[]): number {
  let total = 0;
  for (const item of items) {
    if (item > 10) {
      total += item * 2;
    } else if (item > 5) {
      total += item + 3;
    } else {
      total -= item;
    }
  }
  const scaled = total * 7 + items.length;
  return scaled > 100 ? scaled - 100 : scaled + 100;
}
CLONE
}
dup_dir() { # dup_dir <dir> — a fresh dir with src/ and the working-tree jscpd.json
  rm -rf "$1" && mkdir -p "$1/src" && cp "$repo_root/jscpd.json" "$1/jscpd.json"
}
dup_run() { # dup_run <dir> — runs the working-tree duplicate-code script in <dir>
  (cd "$1" && PATH="$repo_root/node_modules/.bin:$PATH" sh -c "$dup_script")
}
# dup_parity <jscpd.json> <constraints.yaml> — the runtime threshold equals the canonical one.
dup_parity() {
  j=$(node -e 'const t = require(process.argv[1]).threshold; process.stdout.write(t === undefined ? "" : String(t))' \
    "$1") || return 1
  c=$(awk 'prev ~ /^  duplicate_code_threshold_percent:$/ && /^    value: / { print $2 } { prev = $0 }' "$2")
  if [ -z "$j" ] || [ -z "$c" ] || [ "$j" != "$c" ]; then
    echo "duplicate-code threshold drift: jscpd.json threshold '${j}' != constraints.yaml anti_drift.duplicate_code_threshold_percent '${c}'"
    return 1
  fi
}
if [ -z "$dup_script" ] || [ ! -x "$repo_root/node_modules/.bin/jscpd" ]; then
  skip "duplicate-code gate" "no scripts.duplicate-code in package.json or jscpd not installed"
else
  dup_dir "$tmp/dup-tests"
  dup_clone "$tmp/dup-tests/src/a.test.ts"
  dup_clone "$tmp/dup-tests/src/b.test.ts"
  printf 'export const probeName = "duplicate-code gate";\n' > "$tmp/dup-tests/src/probe.ts"
  expect_accept --what "a clone between two *.test.ts files" \
    "duplicate-code gate (d2) clone between test files" dup_run "$tmp/dup-tests"
  dup_dir "$tmp/dup-prod"
  dup_clone "$tmp/dup-prod/src/a.ts"
  dup_clone "$tmp/dup-prod/src/b.ts"
  expect_reject "duplicate-code gate (d3) clone between production files" "too many duplicates" \
    dup_run "$tmp/dup-prod"
  rm -rf "$tmp/dup-tests" "$tmp/dup-prod"
fi
expect_accept --what "the working-tree jscpd.json and constraints.yaml" \
  "duplicate-code gate (d4) threshold parity" dup_parity "$repo_root/jscpd.json" "$repo_root/constraints.yaml"
node -e 'const f = process.argv[1]; const c = require(f); c.threshold += 1;
  require("fs").writeFileSync(process.argv[2], JSON.stringify(c))' "$repo_root/jscpd.json" "$tmp/jscpd-drift.json"
expect_reject "duplicate-code gate (d4) mismatched jscpd.json threshold" "threshold drift" \
  dup_parity "$tmp/jscpd-drift.json" "$repo_root/constraints.yaml"
rm -f "$tmp/jscpd-drift.json"

# 8. Commit-message guard — non-conventional message (commitlint needs node_modules → run from repo root).
badmsg="$tmp/badmsg"
echo "bad message" > "$badmsg"
if [ -f "$repo_root/commitlint.config.cjs" ]; then
  expect_reject "commit-msg guard (\"bad message\")" "may not be empty" \
    sh -c "cd '$repo_root' && pnpm exec commitlint --edit '$badmsg'"
else
  skip "commit-msg guard" "no commitlint config found"
fi

# 9. PR diff size guard — counts the PR diff against constraints.yaml size_limits.max_pr_diff_lines,
# honours an exact diff-limit-exempt line in PR_LABELS, and fails closed when it cannot count.
# The guard runs from the repo root (the version under test) with the worktree as cwd, so it
# reads the worktree's git history and constraints.yaml. Fixture commits use plumbing only
# (write-tree + commit-tree + checkout), so no commit hook runs and none is bypassed; every case
# restores the worktree to $diff_base and leaves it clean.
diff_guard="$repo_root/scripts/check-diff-size.sh"
diff_base="$(git rev-parse HEAD)"
fixture_lines() {
  seq 1 "$1" | sed 's/^/diff guard fixture line /'
}
commit_fixture() {
  git add -A -- "$@" &&
    fixture_commit=$(GIT_AUTHOR_NAME=guardrails GIT_AUTHOR_EMAIL=guardrails@example.invalid \
      GIT_COMMITTER_NAME=guardrails GIT_COMMITTER_EMAIL=guardrails@example.invalid \
      git commit-tree -p HEAD -m "guardrail diff fixture" "$(git write-tree)") &&
    git checkout --quiet --detach "$fixture_commit"
}
restore_fixture() {
  git checkout --quiet --detach "$diff_base"
  git checkout --quiet -- constraints.yaml
}

fixture_lines 401 > diff-guard-fixture.txt
commit_fixture diff-guard-fixture.txt
expect_reject --line "Changed lines (excluding lockfiles/snapshots/records): 401 (limit: 400)" \
  "diff guard (401 lines, no label)" "diff limit" \
  env -u PR_LABELS bash "$diff_guard" "$diff_base"
expect_reject "diff guard (401 lines, near-miss label)" "diff limit" \
  env PR_LABELS=$'bug\nnot-diff-limit-exempt' bash "$diff_guard" "$diff_base"
expect_accept --what "an exempt PR" "diff guard (401 lines, diff-limit-exempt label)" \
  env PR_LABELS=$'bug\ndiff-limit-exempt' bash "$diff_guard" "$diff_base"
restore_fixture

fixture_lines 400 > diff-guard-fixture.txt
commit_fixture diff-guard-fixture.txt
expect_accept --what "a PR at the limit" "diff guard (exactly 400 lines, no label)" \
  env -u PR_LABELS bash "$diff_guard" "$diff_base"
restore_fixture

mkdir -p sub decisions
fixture_lines 401 > sub/pnpm-lock.yaml
fixture_lines 401 > x.lock
fixture_lines 401 > decisions/diff-guard-fixture.md
commit_fixture sub/pnpm-lock.yaml x.lock decisions/diff-guard-fixture.md
expect_accept --what "excluded lockfiles and records" \
  "diff guard (401+ lines in sub/pnpm-lock.yaml, x.lock, decisions/)" \
  env -u PR_LABELS bash "$diff_guard" "$diff_base"
restore_fixture

fixture_lines 401 >> pnpm-lock.yaml
commit_fixture pnpm-lock.yaml
expect_accept --what "an excluded root lockfile" \
  --line "Changed lines (excluding lockfiles/snapshots/records): 0 (limit: 400)" \
  "diff guard (root pnpm-lock.yaml, 401 appended lines)" \
  env -u PR_LABELS bash "$diff_guard" "$diff_base"
restore_fixture

fixture_lines 401 >> pnpm-lock.yaml
node -e 'const fs = require("node:fs");
  const text = fs.readFileSync("package.json", "utf8");
  fs.writeFileSync("package.json", text.replace(/^\{\n/, "{\n  \"diffGuardFixture\": true,\n"));'
commit_fixture pnpm-lock.yaml package.json
expect_accept --what "one manifest line paired with an excluded root lockfile" \
  --line "Changed lines (excluding lockfiles/snapshots/records): 1 (limit: 400)" \
  "diff guard (root pnpm-lock.yaml + package.json, 401 + 1 added lines)" \
  env -u PR_LABELS bash "$diff_guard" "$diff_base"
restore_fixture

for fixture_path in sub/pnpm-lock.yaml __snapshots__/fixture.txt sub/__snapshots__/fixture.txt \
  fixture.snapshot sub/fixture.snapshot; do
  mkdir -p "$(dirname "$fixture_path")"
  fixture_lines 401 > "$fixture_path"
  commit_fixture "$fixture_path"
  expect_accept --what "an excluded generated file" \
    --line "Changed lines (excluding lockfiles/snapshots/records): 0 (limit: 400)" \
    "diff guard ($fixture_path, 401 added lines)" \
    env -u PR_LABELS bash "$diff_guard" "$diff_base"
  restore_fixture
done

for fixture_path in pnpm-lock.yaml.txt __snapshots__extra/fixture.txt fixture.snapshot.txt; do
  mkdir -p "$(dirname "$fixture_path")"
  fixture_lines 401 > "$fixture_path"
  commit_fixture "$fixture_path"
  expect_reject --line "Changed lines (excluding lockfiles/snapshots/records): 401 (limit: 400)" \
    "diff guard (near-miss $fixture_path, 401 added lines)" "diff limit" \
    env -u PR_LABELS bash "$diff_guard" "$diff_base"
  if [ "$rc" -ne 1 ]; then
    echo "FAIL  diff guard (near-miss $fixture_path) — expected exit 1, got $rc"
    fail=$((fail + 1))
  fi
  restore_fixture
done

missing_base="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
expect_reject --absent "Changed lines" "diff guard (unresolvable base)" "base ref '$missing_base'" \
  env -u PR_LABELS bash "$diff_guard" "$missing_base"

expect_reject "diff guard (no base argument)" "usage" \
  env -u PR_LABELS bash "$diff_guard"

awk 'prev ~ /^  max_pr_diff_lines:$/ && /^    value: / { $0 = "    value: unreadable" }
  { print; prev = $0 }' constraints.yaml > "$tmp/constraints.yaml" &&
  cat "$tmp/constraints.yaml" > constraints.yaml
expect_reject --absent "Changed lines" "diff guard (unreadable max_pr_diff_lines)" "max_pr_diff_lines" \
  env -u PR_LABELS bash "$diff_guard" "$diff_base"
restore_fixture

# A resolvable base with no merge base makes git diff itself fail; LC_ALL=C pins git's message.
unrelated_base=$(GIT_AUTHOR_NAME=guardrails GIT_AUTHOR_EMAIL=guardrails@example.invalid \
  GIT_COMMITTER_NAME=guardrails GIT_COMMITTER_EMAIL=guardrails@example.invalid \
  git commit-tree -m "guardrail unrelated base" "$(git rev-parse "HEAD^{tree}")")
expect_reject --absent "Changed lines" "diff guard (git diff fails: no merge base)" "no merge base" \
  env -u PR_LABELS LC_ALL=C bash "$diff_guard" "$unrelated_base"

if [ "$(git rev-parse HEAD)" != "$diff_base" ] || [ -n "$(git status --porcelain)" ]; then
  echo "FAIL  diff guard fixtures left the worktree off $diff_base or dirty:"
  git status --short | sed 's/^/        /'
  fail=$((fail + 1))
fi

# 9a. Lockfile guard — rejects a PR that changes pnpm-lock.yaml without package.json, honours an
# exact lockfile-refresh line in PR_LABELS, and fails closed when it cannot list the changed files
# (#49). Same harness as section 9: the repo root's script runs with the worktree as cwd, fixture
# commits use plumbing only, and every case restores the worktree to $diff_base.
lock_guard="$repo_root/scripts/check-lockfile-pairs.sh"
lock_msg="pnpm-lock.yaml changed but package.json did not."

echo "# lockfile guard fixture" >> pnpm-lock.yaml
commit_fixture pnpm-lock.yaml
expect_reject --line "::error::$lock_msg Lockfile-only changes are unreviewed dependency-resolution drift. Revert the lockfile, or add the 'lockfile-refresh' label with a justification." \
  "lockfile guard (l1: lockfile only, no label)" "lockfile-refresh" \
  env -u PR_LABELS bash "$lock_guard" "$diff_base"
expect_accept --what "an exempt lockfile-only PR" "lockfile guard (l2: lockfile only, lockfile-refresh label)" \
  env PR_LABELS=$'bug\nlockfile-refresh' bash "$lock_guard" "$diff_base"
expect_reject "lockfile guard (l3: lockfile only, near-miss label)" "$lock_msg" \
  env PR_LABELS=$'bug\nnot-lockfile-refresh' bash "$lock_guard" "$diff_base"
# A resolvable base with no merge base makes git diff itself fail; LC_ALL=C pins git's message.
# Labels are present but not exempt, so the label check must run and fall through to the diff.
expect_reject --absent "label present" "lockfile guard (l8: git diff fails: no merge base)" "no merge base" \
  env PR_LABELS=$'bug\nnot-lockfile-refresh' LC_ALL=C bash "$lock_guard" "$unrelated_base"
restore_fixture

echo "# lockfile guard fixture" >> pnpm-lock.yaml
echo "" >> package.json
commit_fixture pnpm-lock.yaml package.json
expect_accept --what "a lockfile change with its manifest" "lockfile guard (l4: lockfile + package.json)" \
  env -u PR_LABELS bash "$lock_guard" "$diff_base"
restore_fixture

echo "lockfile guard fixture" > lockfile-guard-fixture.txt
commit_fixture lockfile-guard-fixture.txt
expect_accept --what "a PR touching neither file" "lockfile guard (l5: neither changed)" \
  env -u PR_LABELS bash "$lock_guard" "$diff_base"
restore_fixture

expect_reject "lockfile guard (l6: unresolvable base)" "base ref '$missing_base'" \
  env -u PR_LABELS bash "$lock_guard" "$missing_base"

expect_reject "lockfile guard (l7: no base argument)" "usage: check-lockfile-pairs.sh <base-ref>" \
  env -u PR_LABELS bash "$lock_guard"

if [ "$(git rev-parse HEAD)" != "$diff_base" ] || [ -n "$(git status --porcelain)" ]; then
  echo "FAIL  lockfile guard fixtures left the worktree off $diff_base or dirty:"
  git status --short | sed 's/^/        /'
  fail=$((fail + 1))
fi

# 10. Residue — reap every recorded fixture group, then sweep for anything that still names the root.
reap_fixtures
strays=$(fixture_strays)
if [ -n "$strays" ]; then
  echo "FAIL  fixture processes outlived the run (escaped their recorded group):"
  printf '%s\n' "$strays" | sed 's/^/        /'
  kill_strays "$strays"
  fail=$((fail + 1))
else
  echo "PASS  no process naming the fixture root outlived the run"
  pass=$((pass + 1))
fi

echo
echo "guardrail self-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
