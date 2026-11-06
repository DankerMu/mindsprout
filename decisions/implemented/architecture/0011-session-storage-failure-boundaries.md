---
id: 0011
title: Keep storage fallback session-scoped and notices explicitly dismissed
kind: architecture
status: implemented
date: 2026-11-06
---

# Keep storage fallback session-scoped and notices explicitly dismissed

## Problem

A storage failure must not discard edits, imply persistence, or split the library and editor across repositories. The editor has one notice slot; an old dismissal timer could clear a replacement notice.

## Decision

The composition root chooses the repository once per document session, falling back only when opening throws `StorageUnavailableError`. Readers and autosave report later failures without replacing it. Shared props-driven components render the unavailable banner and current notice; dismissing the notice calls the store's existing `clearNotice()` without a timer.

## Alternatives considered

- Switching to memory on any operation failure loses access to previously stored maps and conflates quota failures with unavailable storage.
- An automatic dismissal timer needs notice identity or timer cancellation to avoid clearing a newer message. Explicit dismissal needs neither a second notice channel nor a store API change.

## Consequences

- A full reload loses fallback maps; reopening their URLs shows not-found with the unavailable banner. Recovery does not switch repositories during the session.
- A later successful save does not dismiss the current notice. A replacement notice occupies the same slot until explicitly dismissed or replaced again.
- The library can reuse the banner without importing composition-root code; rendering it on the homepage is a separate library change.
- No active decision is superseded.
