# Tasks

## 1. Qualify and implement the read-only license gate

- [x] 1.1 Record the owner-approved scope/license IDs/exact exceptions in `decisions/implemented/process/0015-installed-dependency-license-audit.md`, with the naming/frontmatter/sections required by decisions/README.md; record acceptance before task1.3 widens the allowlist or adds exceptions. Add only the already-locked yaml2.9.1 direct dev dependency using pnpm, and author the first native CLI contract test. Establish callable semantic RED, not only a missing-command error, before implementing enforcement.
- [x] 1.2 Implement general-ID checking, then exact package/version/license exception handling and every grouped version, then fail-closed inputs through incremental RED/GREEN. Keep focused permanent CLI behavior tests and remove the intermediate inventory-only bootstrap.
- [x] 1.3 Populate constraints policy and verification metadata; wire licenses:check/test:licenses into local anti-drift and the existing CI job. Update existing stack rules and AGENTS command/verification/enforcement rows without weakening unrelated rules.
- [x] 1.4 Prove the real installed tree on macOS and Linux CI, focused tests, scoped static/docs/decision/guardrail checks, and an owned unmerged forbidden-license dependency PR rejected by the actual CI license step. Retain evidence and clean the probe; full-depth review/owner acceptance/required CI before merge.
- [x] 1.5 After merge, close #68 and sync/archive the completed fixture separately.

## Risk packs

- Public API / CLI / script entry — selected: new exit/diagnostic contract and package commands; tasks1.1–1.4 native CLI tests and CI negative probe.
- Config / project setup — selected: canonical policy and CI/local gate wiring; task1.3 mirrors and task1.4 real commands/guardrails.
- File IO / path safety / overwrite — selected: read cwd policy/inventory and temporary test/probe projects; read-only audit, shell-free subprocess, owned-temp cleanup and no canonical probe artifacts, task1.4 review.
- Schema / columns / units / field names — selected: policy groups and pnpm name/versions/license shape; exact identity, multiple versions and malformed/empty tests, task1.2.
- Auth / permissions / secrets — selected: fixture children must not inherit caller registry/authentication or lifecycle configuration. Tasks1.1–1.2 use an explicit environment allowlist, owned HOME/XDG/temp directories and empty user/global npm configs, with project-owned registry/store settings shared by every child. Native private-package preconditions prove the loopback path; never read or log user credential values. Production audit stays local/read-only, CI permissions unchanged; task1.4 full-depth review.
- Concurrency / shared state / ordering — selected: asynchronous fixture installs depend on a shared loopback registry. Tasks1.1–1.2 and design22 require registry readiness before installs, awaiting child installs before shutdown, and owned server/temp/store cleanup on success and failure. Native RED and GREEN runs must exit without orphan resources. The production audit remains synchronous/read-only with no shared cache; a dirty installation is not represented as a stable verified tree.
- Resource limits / large input / discovery — selected: full installed inventory without filtering, bounded producer output, each reported version checked; actual692-entry baseline plus multi-version test and scope disclosure, task1.4. No new pagination or registry crawler.
- Legacy compatibility / examples — selected: original allowed IDs, runtime deps/versions, existing gates and required checks unchanged; lock/manifest diff, full-depth review and CI, task1.4.
- Error handling / rollback / partial outputs — selected: unknown licenses, malformed/empty inputs and failed producer cannot pass; task1.2 CLI tests and task1.4 rejection evidence. No fallback, retry or automatic exception.
- Release / packaging / dependency compatibility — selected: direct yaml dev dependency at already-locked2.9.1 (ISC, published2026-09-11); pnpm-generated lockfile, frozen install, no upgrades, task1.4.
- Documentation / migration notes — selected: accepted decision and existing policy/command/verification mirrors, known installed-platform and metadata-only limits; docs/decisions checks and owner acceptance, tasks1.3–1.4.
