# Proposal

## Why

A readable record under key A can contain map.id B. Opening route A then editing can autosave through B and replace a distinct peer record. Issue94 requires rejection before an autosave-capable editor mounts, while preserving both stored records.

## What Changes

- Require a loaded map's ID to equal the requested editor route ID before entering the ready state.
- Reuse the existing unreadable/error presentation; do not repair, delete, re-key, rename or switch repositories.
- Add native seeded-IndexedDB rejection and normal-save coverage plus component no-write/stale-result regression coverage.
- Ship a patch changeset and bug-fix decision0016.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-library`: the existing unreadable-map route contract includes mismatched embedded identities and preserves matching-ID editing/autosave.

## Impact

`src/app/maps/[id]/MapEditor.tsx`, its existing component tests, `e2e/map-editor.spec.ts`, changeset and decision record. No repository port/adapter, schema, library rename/delete, autosave algorithm, dependency or CI changes.

## Triage

- Issue type: bugfix.
- Fixture level: expanded.
- Upstream suggested level: absent; expanded for the persisted-data identity boundary and possible wrong-target writes.
- Blast radius: editor load acceptance and existing asynchronous load states; no storage mutation on rejection.
- Selected risk packs: Public API / CLI / script entry; File IO / path safety / overwrite; Schema / columns / units / field names; Concurrency / shared state / ordering; Legacy compatibility / examples; Error handling / rollback / partial outputs; Documentation / migration notes.
- Evidence floor: native real-IndexedDB counterexample and matching-ID autosave, no-put component proof, unchanged raw A/B records, screenshots/noise checks, scoped verification, full-depth four-seat review and owner functional acceptance.
