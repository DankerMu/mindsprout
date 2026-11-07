---
id: 0010
title: Allow one deprecated keyCode read for WebKit IME confirmation
kind: bug-fix
status: implemented
date: 2026-11-06
---

# Allow one deprecated keyCode read for WebKit IME confirmation

## Problem

[WebKit report 324380, comment 2](https://bugs.webkit.org/show_bug.cgi?id=324380#c2) describes `compositionend` preceding an Enter `keydown` with `isComposing: false` and `keyCode: 229`. At that point, neither the composition ref nor `isComposing` identifies the confirmation key. Treating it as ordinary Enter commits and closes the title draft prematurely. The report is configuration-dependent, not a claim about every Safari configuration or Escape ordering.

## Decision

The shared `isCompositionKey` guard in `src/components/canvas/selection-input.tsx` checks `isComposing` and `keyCode === 229`. Inline title terminal keys and canvas creation keys use it alongside their composition refs. Confirmation leaves native behavior intact without committing a draft or creating a node; an ordinary Enter with keyCode 13 can act immediately.

Authorize exactly one `@typescript-eslint/no-deprecated` suppression, immediately above that deprecated property read, with a reference to this record. All other deprecated accesses remain subject to the rule. No lint configuration, threshold, browser matrix, timer, or post-composition grace state changes are authorized.

## Alternatives considered

- **Composition ref and `isComposing` only:** both are false for the reported confirmation event, so they admit a premature commit.
- **Timer or post-composition grace period:** guesses intent from elapsed time and can swallow an ordinary Enter after composition ends.
- **Reflection, dynamic property access, or a cast hiding deprecation:** retains the same deprecated dependency while concealing it from the checker and reviewers.
- **Suppress the rule for the file or project:** permits unrelated deprecated API use beyond this compatibility requirement.

## Consequences

- The real-store DOM regression simulates the reported Enter sequence and requires the draft to remain open without dispatch or history changes, followed by exactly one undoable commit on ordinary Enter. Existing active-composition Escape behavior remains covered.
- Canvas creation uses the same guard, so a composition-ending Enter cannot start a sibling creation after the composition signals have cleared.
- Synthetic events do not verify actual Safari OS IME behavior or establish Safari Escape ordering.
- Remove the keyCode fallback and its suppression when every supported WebKit version has a verified fix for this ordering and real OS IME checks demonstrate that the remaining composition signals protect confirmation without delaying ordinary Enter.
- No active decision is superseded; this is a local compatibility exception.
