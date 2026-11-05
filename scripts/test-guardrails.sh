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

expect_reject() {
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
  else
    echo "PASS  $name — guard rejected the violation and named it (exit $rc)"
    pass=$((pass + 1))
  fi
}

skip() {
  echo "SKIP  $1 — $2 (a skipped guard is a readiness gap, not a pass)"
}

expect_accept() {
  name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $name — guard accepts the clean tree"
    pass=$((pass + 1))
  else
    echo "FAIL  $name — guard REJECTED the clean tree (always-failing guard or broken setup)"
    fail=$((fail + 1))
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
# test files are exempt from it (decision 0006).
# depcruise reads the worktree's committed .dependency-cruiser.cjs and must resolve the
# probed packages. A symlink to the root node_modules would resolve to real paths
# outside the worktree (matching no rule path), so mirror only zod, react and vitest into the
# worktree, keeping pnpm's .pnpm/<pkg>@<ver>/node_modules/<pkg> layout when present.
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
if [ ! -x "$depcruise_bin" ] || [ ! -f .dependency-cruiser.cjs ]; then
  skip "boundaries guard" "depcruise not installed at $depcruise_bin or no .dependency-cruiser.cjs"
elif ! mirror_package zod || ! mirror_package react || ! mirror_package vitest; then
  skip "boundaries guard" "could not mirror zod/react/vitest from $repo_root/node_modules"
else
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
  rm -f src/contexts/map/domain/zod-probe.ts src/contexts/map/domain/zod-probe.test.ts \
    src/contexts/map/domain/react-probe.ts
fi
rm -rf "$wt/node_modules"

# 8. Commit-message guard — non-conventional message (commitlint needs node_modules → run from repo root).
badmsg="$tmp/badmsg"
echo "bad message" > "$badmsg"
if [ -f "$repo_root/commitlint.config.cjs" ]; then
  expect_reject "commit-msg guard (\"bad message\")" "may not be empty" \
    sh -c "cd '$repo_root' && pnpm exec commitlint --edit '$badmsg'"
else
  skip "commit-msg guard" "no commitlint config found"
fi

# 9. Residue — reap every recorded fixture group, then sweep for anything that still names the root.
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
