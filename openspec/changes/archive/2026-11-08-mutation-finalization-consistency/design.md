# Design

## Context

The finalizer writes finalization.log, exit-status.json, then accepted-completion.json. A catch changes status and removes acceptance but leaves the earlier success log. Decision0018 already owns the intended fail-closed evidence contract.

## Goals / Non-Goals

- Governing invariant: caught finalization failure is nonzero with no accepted marker; retained terminal log/metadata cannot describe it as complete.
- Sibling surfaces: finalization.log, exit-status.json, accepted-completion.json, shell exit and always-upload artifact consumer.
- Preserve successful marker-last ordering, native nonzero precedence, prior error list, diagnostics, sampler cleanup, full plan coverage and all canonical mutation controls.
- Do not redesign the artifact schema, create a parallel finalizer, fix unrelated dependency errors, or broaden recovery beyond these three outputs.

## Decisions

1. Correct the existing catch in place. Remove the stale success log before attempting a failure-log rewrite so a second write failure cannot leave the old complete text. Record the original caught error and diagnostics-only outcome when recovery writes are available.
2. Prefer this local synchronization over a new transaction/state-file abstraction. Update decision0018's existing obligation; no new decision is needed for correcting its implementation.
3. Load the production Node finalizer directly from the YAML execution block at test runtime; execute its exact bytes through Node stdin with controlled input arguments. No hand-maintained copy, altered finalizer body or substitute implementation. Preserve source SHA-256 provenance.
4. A disposable preload may control the filesystem boundary, but must cause a real native filesystem error: after successful finalization.log write, create a directory at the next target path so the original fs.writeFileSync raises EISDIR, then remove that directory once. Do not merely throw a mock error. Fault each target independently: first exit-status.json write; accepted-completion.json write.
5. On the same oracle, require baseline RED for stale complete logs and fixed GREEN for both faults. Audit all three outputs, original error/code/path, nonzero exit, absent accepted marker and diagnostics-only nonzero metadata. Positive control requires zero exit and complete log/metadata/marker, with trace proving marker is the last of the three published outputs.
6. Also force the failure-log rewrite to fail after a late-write fault. Require nonzero exit, no accepted marker and no retained stale complete log; do not promise writable diagnostics under persistent I/O failure. Preserve available original error evidence and unaffected files.
7. Reuse the existing 23-case Linux protocol harness and execute against the changed production block; retain native initialization/deadline, status, sampler/canary and completeness oracles. Probe branches never merge. Final exact-head full hosted mutation remains required before merge.

## Risks / Trade-offs

Filesystem fault injection can accidentally test the injector. Record the real EISDIR code/path, one-shot count, filesystem setup/removal and delegated native call; positive control must exercise identical production bytes without injection. Read-only reviewers inspect the harness and outcomes, not just its pass count.

## Migration Plan

No data or artifact-schema migration. Revert the isolated catch/documentation correction if needed. Parent runs scoped checks, four-seat review and genuine protected merge, then separately syncs/archives the fixture. No per-issue owner acceptance prompt.
