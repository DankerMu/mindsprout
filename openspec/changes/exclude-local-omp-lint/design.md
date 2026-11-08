# Design

## Context

The root config already globally ignores `.claude/**`, `.agents/**` and `.codex/**`. `.omp/` is Git-ignored local tooling, not a TypeScript project. Recorded default lint errors in `.workplans/16/review/resume-03.log` are accepted evidence; do not rerun that full failure merely to confirm it.

## Goals / Non-Goals

Governing invariant: adding local root OMP tooling cannot affect project lint, and project files outside that one subtree retain the same diagnostics and failure threshold.

Non-goals: editing tooling, adding workflow globals, changing TypeScript projects, disabling rules, broad hidden-directory ignores, package-script flags, dependency updates or application behavior.

## Decisions

- Add exactly `.omp/**` to the existing global ignore block. Global scope covers both `pnpm lint` and direct ESLint; a pnpm-only override would leave direct consumers inconsistent.
- Author the process decision before changing the config, following the decision lifecycle and supersession check. Record that this is a local-tooling boundary, not permission to ignore project source.
- Keep every other ignore entry, rule, typed-check configuration and `--max-warnings 0` unchanged. No wrapper, new helper, compatibility alias or permanent source-text/wiring test.
- Parent runs a throwaway ESLint API probe: actual `.omp` hook and workflow paths must be ignored; a real project source path, `.omp-other/example.ts` and `src/.omp/example.ts` must remain in scope. The same probe is RED before the config change and GREEN after.
- Parent then runs default `pnpm lint` with the actual `.omp/` tree present and no override. For the negative sibling, lint source text through stdin with an existing project filename plus a deliberate `console.log`; require exit1 and `no-console`, not a parser crash. Do not write a probe into the source tree or execute tooling files.
- Existing recorded lint failure plus the fresh scope RED establish the defect. Tests or fixtures that merely assert the added config string are not acceptable evidence.

## Risks / Trade-offs

- An accidentally broad glob could hide project violations → scope near-miss probes and the real rule-rejection sentinel.
- A wrapper-only fix could split consumers → direct API/config proof and unchanged package scripts.
- New root `.omp/` project code would inherit the exclusion → keep this subtree tooling-only; review that policy before adopting any content as project source.

## Migration Plan

Apply the single config entry and its decision atomically. Verify default lint, negative source enforcement, typecheck, formatting, docs and decisions; review the complete scoped diff and exact-head CI. No build/UI run is needed because no application surface changes. Rollback removes the entry and restores the local-tooling failure without affecting stored application data.

Sibling surfaces: global ignore block; pnpm lint script; direct ESLint consumers; TypeScript project service; existing agent-directory exclusions; tracked source and lookalike/nested paths. Required evidence must bind to the same final config. Preserve the user's unrelated hook change and all existing stashes.
