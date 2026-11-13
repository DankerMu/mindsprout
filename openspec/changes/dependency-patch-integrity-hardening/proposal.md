# Proposal

## Why

Issue #138 records two hardening gaps in the dependency-patch mechanism (decision 0022). Neither has a check that would catch it.

1. **Native override integrity is unguarded.** Decision 0021 (`decisions/implemented/bug-fix/0021-native-hmr-registration-maintenance.md:21`) requires the exact-version `@next/swc-*` tarball overrides to install "with integrity verification". During #119 the implementer reported that re-resolving the lockfile against a store that already held both native tarballs dropped their `integrity`. Nothing in the repo reads `integrity` from the root `pnpm-lock.yaml`. The only integrity read, `scripts/native-install.test.mjs:121-131`, reads a fixture project's lockfile. The empty-store caveat lives only in `docs/engineering/dependency-patches.md:16`, behind a condition. The other regeneration instructions do not carry it: `:23`, `:24-25`, `:29`, `docs/engineering/native-hmr.md:69` and decision 0022 `:39`.
2. **The Stryker patch regression is weaker than claimed.** `scripts/stryker-vitest-runner-patch.test.mjs:199-212` has no `String`-convertible object that also carries a string `name`/`message`. A regenerated util patch that formats `name: message` before trying `String()` would pass the whole suite. The util realpath assertion (`:149-154`) covers only the copy the vitest-runner imports. A partial Stryker update could give core and instrumenter an unpatched util without triggering `ERR_PNPM_UNUSED_PATCH`.

## What Changes

- **Retest the warm-store loss once** in a scratch copy and record the command, pnpm version and resulting diff, or the non-reproduction, in the PR.
- **Add a lockfile integrity guard** as a `node:test` file run by a new `pnpm test:native-lockfile` script and a CI layer4 step. It reads the root `pnpm-lock.yaml`. For every `overrides` value that points at this repository's `releases/download/native-next-` assets, it requires a `packages` entry `<name>@<url>` whose `resolution.tarball` equals that URL and whose `resolution.integrity` is a `sha512-` SRI string. Fixture lockfiles prove that the check fails when an entry's integrity is removed or malformed, or when the entry is missing.
- **Write the empty-store caveat once**, in a "Regenerate the lockfile" section of `docs/engineering/dependency-patches.md`. Every other regeneration instruction links to that section instead of copying it.
- **Strengthen `scripts/stryker-vitest-runner-patch.test.mjs`.** Add `{ name: 'E', message: 'm' }` → `'[object Object]'`, and show it is red against a "header-first" variant of the patch. Assert that the `@stryker-mutator/util` that core and instrumenter resolve has the same realpath as the patched entry the runner imports.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- development-navigation: the existing "Temporary native repair is reproducibly installed" requirement gains a committed-lockfile integrity check (MODIFIED; no second requirement for the same fact).

## Impact

- **New:** `scripts/native-lockfile-integrity.test.mjs`, a `package.json` script, a step in `.github/workflows/ci.yml` (critical path: full cross-review plus `pnpm test:guardrails`), and a merge of the `AGENTS.md` command-table row into the existing dependency-patch row.
- **Changed:**
  - tests: `scripts/stryker-vitest-runner-patch.test.mjs`;
  - docs: `docs/engineering/dependency-patches.md`, `docs/engineering/native-hmr.md`;
  - decision 0022, link only.
- **Unchanged:** `pnpm-lock.yaml` is read-only here. No dependency, patch, manifest, product or application behavior changes. No changeset. No new decision record: the guard enforces decision 0021's existing integrity requirement, and the PR states this.

## Fixture triage

```text
Issue type: hardening / dev-tooling guard + test strength + docs
Fixture level: expanded
Upstream suggested level: absent; expanded because it adds a lockfile reader, wires a new CI gate (.github/workflows critical path) and changes release/packaging integrity evidence.
Blast radius: the guard passes vacuously (selector drift, no matching overrides) or false-fails a valid lockfile; the strengthened tests stay green against the regressions they target; docs drift into duplicated caveats.
Selected risk packs: Config / project setup; Public API / CLI / script entry; Schema / columns / units / field names; Resource limits / large input / discovery (discovery only); Test strength; Error handling / rollback / partial outputs; Release / packaging; Legacy compatibility / examples; Documentation / migration notes.
Evidence floor: warm-store retest record; guard GREEN on the repo lockfile and RED on each fixture mutation; new util case RED against the header-first variant and GREEN on the restored patch (installed file sha256 restored); core and instrumenter realpath assertions GREEN; pnpm test:stryker-patch, test:native-lockfile, test:guardrails, lint, fmt:check, docs:check, decisions:check, dead-code; exact-head CI.
```
