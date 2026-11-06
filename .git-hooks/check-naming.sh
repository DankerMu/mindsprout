#!/usr/bin/env bash
# .git-hooks/check-naming.sh
# Rejects commits that add files whose names violate code-canonicality rules.
# Wired into pre-commit via .husky/pre-commit and into Claude Code write-time via
# .claude/hooks/pre-write-naming.sh.
#
# See AGENTS.md § Code Canonicality.

set -euo pipefail

# Regex source: repo-root `constraints.yaml` (preferred) or fallback defaults.
# - Forbidden suffix patterns: `code_canonicality.forbidden_suffixes.patterns`
# - Scratchpad directories: `code_canonicality.scratchpad_directories.paths`
# - Scratchpad exemptions: `code_canonicality.scratchpad_directories.exempt_prefixes`
#   (literal repo-relative prefixes; scratch segments below a prefix are still rejected —
#   decision 0007)
#
# This hook must run on bare macOS (bash 3.2). Do not add non-default deps (e.g., yq).
DEFAULT_FORBIDDEN_SUFFIX_RE='(_v[0-9]+|_new|_old|_backup|_temp|_copy|_final|_real|_improved|_refactored|_fixed|_legacy|_deprecated|_archive|_save|V[0-9]+|New|Old|Legacy|Deprecated|Backup)(\.|/|$)'
DEFAULT_SCRATCH_DIR_RE='(^|/)(tmp|scratch|backup|_old|deprecated|archive|wip)(/|$)'
DEFAULT_SCRATCH_EXEMPT_PREFIX='openspec/changes/archive/'

# physical_pwd: the current directory as the kernel names it (getcwd). The builtin `pwd -P`
# only resolves symlinks and keeps the caller's spelling of every other component, so on
# macOS a case variant, the /System/Volumes/Data firmlink or an NFD spelling of the repo
# would not compare equal to git's toplevel (decision 0008).
physical_pwd() {
  /bin/pwd -P
}

# Canonical, like git's toplevel, so path mode can compare resolved paths (decision 0008).
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || physical_pwd)"
constraints_file="$repo_root/constraints.yaml"

yaml_get() {
  local path="${1:?yaml path required}"
  local file="${2:?yaml file required}"

  [ -f "$file" ] || return 1

  case "$path" in
    code_canonicality.forbidden_suffixes.patterns)
      sed -n '/^code_canonicality:/,/^size_limits:/p' "$file" \
        | sed -n '/^  forbidden_suffixes:/,/^  scratchpad_directories:/p' \
        | grep -E '^[[:space:]]*-[[:space:]]*' \
        | sed -E "s/^[[:space:]]*-[[:space:]]*//; s/[[:space:]]*$//; s/^[\\\"']//; s/[\\\"']$//"
      ;;
    code_canonicality.scratchpad_directories.paths | code_canonicality.scratchpad_directories.exempt_prefixes)
      local key="${path##*.}"
      sed -n '/^code_canonicality:/,/^size_limits:/p' "$file" \
        | sed -n '/^  scratchpad_directories:/,/^size_limits:/p' \
        | grep -m 1 -E "^[[:space:]]*${key}:" \
        | sed -E "s/^[[:space:]]*${key}:[[:space:]]*//; s/[[:space:]]*\$//"
      ;;
    *)
      return 1
      ;;
  esac
}

# Single-line YAML flow list -> space-separated words (brackets, quotes and commas removed).
flow_list_words() {
  printf '%s' "$1" | sed -E "s/^[[:space:]]*\\[//; s/\\][[:space:]]*$//; s/[\\\"']//g; s/,/ /g"
}

FORBIDDEN_SUFFIX_RE="$DEFAULT_FORBIDDEN_SUFFIX_RE"
SCRATCH_DIR_RE="$DEFAULT_SCRATCH_DIR_RE"
SCRATCH_EXEMPT_PREFIXES=("$DEFAULT_SCRATCH_EXEMPT_PREFIX")
forbidden_source="fallback"
scratch_source="fallback"

if [ -f "$constraints_file" ]; then
  forbidden_joined=""
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    pat="${pat%\$}"
    if [ -z "$forbidden_joined" ]; then
      forbidden_joined="$pat"
    else
      forbidden_joined="$forbidden_joined|$pat"
    fi
  done <<EOF2
$(yaml_get 'code_canonicality.forbidden_suffixes.patterns' "$constraints_file" 2>/dev/null || true)
EOF2

  if [ -n "$forbidden_joined" ]; then
    # Convert identifier-style patterns (often `$`-anchored) into a path-component check.
    FORBIDDEN_SUFFIX_RE="(${forbidden_joined})(\\.|/|$)"
    forbidden_source="constraints.yaml"
  fi

  scratch_paths_line="$(yaml_get 'code_canonicality.scratchpad_directories.paths' "$constraints_file" 2>/dev/null || true)"
  if [ -n "$scratch_paths_line" ]; then
    scratch_cleaned="$(flow_list_words "$scratch_paths_line")"
    scratch_joined=""
    for term in $scratch_cleaned; do
      term="${term#/}"
      term="${term%/}"
      [ -z "$term" ] && continue
      if [ -z "$scratch_joined" ]; then
        scratch_joined="$term"
      else
        scratch_joined="$scratch_joined|$term"
      fi
    done
    if [ -n "$scratch_joined" ]; then
      SCRATCH_DIR_RE="(^|/)(${scratch_joined})(/|$)"
      scratch_source="constraints.yaml"
    fi
  fi

  # constraints.yaml is the source of truth: present without the key means nothing is exempt.
  SCRATCH_EXEMPT_PREFIXES=()
  exempt_cleaned="$(flow_list_words "$(yaml_get 'code_canonicality.scratchpad_directories.exempt_prefixes' "$constraints_file" 2>/dev/null || true)")"
  set -f # an entry is a literal prefix; never let the split glob-expand it
  for prefix in $exempt_cleaned; do
    case "$prefix" in
      /* | *[!/])
        echo "check-naming.sh: invalid exempt prefix: $prefix" >&2
        exit 2
        ;;
    esac
    SCRATCH_EXEMPT_PREFIXES+=("$prefix")
  done
  set +f
fi

echo "check-naming.sh: FORBIDDEN_SUFFIX_RE source: $forbidden_source" >&2
echo "check-naming.sh: SCRATCH_DIR_RE source:    $scratch_source" >&2
if [ "${#SCRATCH_EXEMPT_PREFIXES[@]}" -gt 0 ]; then
  echo "check-naming.sh: scratchpad exempt prefixes: ${SCRATCH_EXEMPT_PREFIXES[*]}" >&2
else
  echo "check-naming.sh: scratchpad exempt prefixes: none" >&2
fi

# check_path <repo-relative path>: appends one entry to `violations` per rule the path breaks.
# The suffix rule sees the full path; the scratchpad rule sees only what follows a leading
# exempt prefix (compared literally), so scratch below the prefix is still caught.
violations=()
check_path() {
  local f="$1" scratch_subject="$1" prefix
  if [[ "$f" =~ $FORBIDDEN_SUFFIX_RE ]]; then
    violations+=("  forbidden naming suffix: $f")
  fi
  # ${arr[@]+...}: bash 3.2 treats an empty array as unbound under `set -u`.
  for prefix in ${SCRATCH_EXEMPT_PREFIXES[@]+"${SCRATCH_EXEMPT_PREFIXES[@]}"}; do
    if [[ "$f" == "$prefix"* ]]; then
      scratch_subject="${f:${#prefix}}"
      break
    fi
  done
  if [[ "$scratch_subject" =~ $SCRATCH_DIR_RE ]]; then
    violations+=("  scratchpad directory:    $f")
  fi
}

# physical_path <absolute path>: the deepest existing ancestor directory, resolved with
# `cd` + physical_pwd, followed by the non-existent remainder verbatim. Callers never pass a `..`
# segment: `cd` drops `..` as text while the filesystem follows a symlinked ancestor.
physical_path() {
  local dir="$1" rest="" resolved
  while [ ! -d "$dir" ]; do
    rest="/${dir##*/}$rest"
    dir="${dir%/*}"
    [ -z "$dir" ] && dir="/"
  done
  resolved="$(cd "$dir" && physical_pwd)" || return 1
  printf '%s%s\n' "${resolved%/}" "$rest"
}

# Path-argument mode (agent write-time check): validate one path directly
# instead of reading the staged index. An absolute path is resolved physically first
# (decision 0008): inside the repo it is made repo-relative, so it gets the same verdict as
# the staged check; outside the repo it can never be committed and is accepted. An absolute
# path with a `..` segment, one equal to the repo root, or one that cannot be resolved is
# checked as given. Relative paths are checked as given.
if [ "$#" -gt 0 ]; then
  f="$1"
  case "$f/" in
    */../*) ;;
    /*)
      resolved="$(physical_path "$f")" || resolved=""
      if [[ -n "$resolved" && "$resolved" == "$repo_root/"* ]]; then
        f="${resolved:$((${#repo_root} + 1))}"
      elif [ -n "$resolved" ] && [ "$resolved" != "$repo_root" ]; then
        exit 0
      fi
      ;;
  esac
  if [[ "$f" == "$repo_root/"* ]]; then
    f="${f:$((${#repo_root} + 1))}"
  fi
  check_path "$f"
  if [ "${#violations[@]}" -gt 0 ]; then
    echo "naming violation (write-time): $1 — see AGENTS.md § Code Canonicality" >&2
    exit 2
  fi
  exit 0
fi

# Read added or renamed files (cached), NUL-separated: without -z git C-quotes any path with
# non-ASCII or control bytes, and the quoted form would slip past the anchored regexes.
# Avoid `mapfile` so the script works on macOS default bash 3.2 as well as bash 4+.
while IFS= read -r -d '' f; do
  check_path "$f"
done < <(git diff --cached --name-only -z --diff-filter=AR 2>/dev/null || true)

if [ "${#violations[@]}" -gt 0 ]; then
  cat <<EOF2
Code canonicality violation — these path(s) cannot be committed:

$(printf '%s\n' "${violations[@]}")

Why: parallel versions (_v1, _v2, _new), placeholder names (_temp, _copy), and
scratchpad directories cause the codebase to bloat with duplicate logic.

What to do:
  - If you are refactoring: rename the new file over the old one and let git track the change in history.
  - If this is genuinely a separate concept: rename to something descriptive (no suffix).
  - If this is throwaway exploration: keep it outside the repo (e.g., /tmp).

See AGENTS.md § Code Canonicality for the full rule.
EOF2
  exit 1
fi

echo "check-naming.sh: staged paths conform." >&2
exit 0
