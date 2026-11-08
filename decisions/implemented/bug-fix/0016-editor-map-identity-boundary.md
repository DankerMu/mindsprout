---
id: 0016
title: Reject mismatched map identity before opening an editor session
kind: bug-fix
status: implemented
date: 2026-11-08
---

# Reject mismatched map identity before opening an editor session

## Problem

A readable IndexedDB record under key A can contain a valid map whose embedded ID is B. The library opens the stored key, but autosave writes under the embedded ID. Opening that record as an editable session risks overwriting a distinct map at B; successful decoding and readable summary metadata do not establish identity.

## Decision

`StoredMap` in `src/app/maps/[id]/MapEditor.tsx` checks the successful repository read after discarding cancelled results and before entering `ready` or mounting `EditorSession`. An absent map remains not-found. A map whose ID differs from the requested route ID uses the existing unreadable error state and return-to-library link, without throwing or treating identity corruption as unavailable storage.

Rejection performs no put, repair, deletion, re-keying, migration or repository switch. Source A and any peer B remain untouched. Matching IDs retain normal editing and autosave under their own key. The guard applies to every repository supplied to the editor without changing the repository read contract.

## Alternatives considered

- **Reject inside the IndexedDB adapter:** broadens read semantics for other consumers and leaves other repository implementations unprotected at the editor boundary.
- **Validate after mounting the editor session or only at autosave:** admits a wrong-identity editing session and requires protection across its save and teardown paths rather than preventing its creation.
- **Rewrite the embedded ID, move the record or delete it:** guesses which identity is authoritative and can destroy recoverable data or overwrite a distinct peer.
- **Show not-found or switch to memory:** conceals an existing unreadable record or changes repository ownership without a storage-opening failure.

## Consequences

- A mismatched record with readable summary metadata remains listed but cannot enter an editable session. Recovery is not automatic; existing confirmed library deletion remains available.
- Cancelled and StrictMode-discarded reads cannot replace the active editor with an identity error. Missing, future-version and storage-unavailable states retain their meanings.
- Native browser coverage compares exact raw source and peer records after delayed observation and return navigation. Component coverage observes repository puts through pagehide and unmount; unchanged raw values alone cannot exclude a same-value put.
- Matching-ID browser coverage uses a real node-title edit and checks autosave at the requested key with a distinct untouched peer.
- No active decision is superseded. [Decision 0003](../architecture/0003-treeop-single-mutation-protocol.md) still owns mutation and editor-session boundaries, including library rename/delete; [decision 0011](../architecture/0011-session-storage-failure-boundaries.md) still owns session repository selection and storage failure presentation.
