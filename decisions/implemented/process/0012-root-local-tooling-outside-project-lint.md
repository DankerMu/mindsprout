---
id: 0012
title: Keep root local tooling outside project lint
kind: process
status: implemented
date: 2026-11-07
---

# Keep root local tooling outside project lint

## Problem

Root `.omp/` contains Git-ignored local hooks and workflow DSL, not project source. Linting these files produces project-service and JavaScript diagnostics that make the project gate depend on locally installed tooling.

## Decision

Exclude exactly root `.omp/**` in the existing global ignores in `eslint.config.mjs`, beside the other agent directories. Global configuration gives default `pnpm lint` and direct ESLint consumers the same boundary without invocation-specific overrides.

All other ignore entries, project-source coverage, ESLint rules, TypeScript project-service settings and package scripts remain unchanged, including `--max-warnings 0`. Lookalike `.omp-other/` and nested `src/.omp/` paths receive no new exemption.

## Alternatives considered

- **A pnpm-only `--ignore-pattern` override** leaves direct ESLint consumers scanning local tooling and splits the scope policy between entrypoints.
- **Adding workflow DSL globals or relaxing rules** treats external tooling as project code and suppresses symptoms instead of correcting file discovery.
- **Including tooling in typed projects or project service** makes the project responsible for local tool installations and does not resolve the workflow DSL boundary.

## Consequences

- Local root OMP tooling does not contribute project lint diagnostics; project violations still fail under the existing rules and zero-warning threshold.
- Root `.omp/` is reserved for local tooling. Adopting content there as project source requires revisiting this exclusion first; this decision does not authorize ignoring project code or other hidden directories.
- This development-gate boundary changes no application behavior and needs no product changeset.
