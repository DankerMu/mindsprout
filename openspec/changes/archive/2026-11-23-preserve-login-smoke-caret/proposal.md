# Proposal: preserve-login-smoke-caret

Issue type: bugfix
Fixture level: compact
Upstream suggested level: absent (compact: isolated browser-evidence option and shared test helper; no production behavior)
Blast radius: incorrect screenshot timing could hide the hydration race, weaken console evidence or destabilize the existing M2 Scheduler regression.
Selected risk packs: Legacy compatibility; Concurrency/shared state/ordering (test-only Scheduler hold); Documentation.
Evidence floor: deterministic hydration-held red proof of transparent caret writes, green no-write proof after the option, strict console assertions, M2 regression and smoke suite, static/spec gates and required CI.

## Why

The standalone `/login` smoke screenshot still uses Playwright's default caret hiding, which can temporarily inject `caret-color: transparent` during hydration and trigger a React attribute mismatch.

## What Changes

- Reuse one extracted Scheduler-hold helper between the existing M2 proof and `/login` smoke; do not change production code.
- Record username/password caret-style writes while the SSR form is visible and hydration is held after load, then preserve the existing smoke screenshot with `caret: 'initial'`.
- Keep strict console/page-error assertions and extend the existing public-form evidence spec with the standalone hydration-held scenario.
