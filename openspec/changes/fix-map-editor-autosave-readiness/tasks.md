# Tasks

## 1. Synchronize the existing autosave acceptance walk

- [x] 1.1 After `map-editor-ready`, replace the initial synchronous root-text read with an awaited concrete `rf__node-root` read, then retain the original `nodeWrapper` interaction and every text, autosave, matching-key and peer assertion.
- [x] 1.2 Leave production source, `nodeWrapper`, the editor-ready contract, timeout/retry/skip settings and all unrelated tests unchanged.

## 2. Verify and review

- [x] 2.1 Run the original MapEditor test path and full `pnpm test:unit` coverage gate; record that baseline green runs are controls, not a reproduced red/green fix.
- [x] 2.2 Run formatting, lint, typecheck, dead-code, duplicate-code and strict OpenSpec validation; review the one-line test change against the CI red stack and all persistence assertions.
