# Spec Delta

## Purpose

Keep project lint independent of locally installed agent tooling while preserving strict diagnostics for project source and preventing broader directory exclusions.

## ADDED Requirements

### Requirement: Local OMP tooling is outside project lint

The default project lint command and direct root lint configuration SHALL exclude only the root `.omp/` subtree in addition to their existing exclusions. Project files outside that subtree SHALL retain their existing rules, type-aware checks and zero-warning threshold.

#### Scenario: Local tooling is installed

- **WHEN** the root `.omp/` contains local hooks or workflow DSL that is not part of the TypeScript project
- **THEN** default project lint does not diagnose those files and succeeds when project files conform, without an invocation-specific ignore override

#### Scenario: Project source remains enforced

- **WHEN** a project source file outside the root `.omp/` subtree violates an existing lint rule
- **THEN** lint reports that violation and fails; lookalike `.omp-other/` and nested `src/.omp/` paths receive no new exemption
