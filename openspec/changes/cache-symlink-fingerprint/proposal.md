# Cache symlink fingerprint

## Why

A valid warm Next development cache can contain directory symlinks. The native runner currently passes those links to `readFileSync`, so cache preflight fails with `EISDIR` before the browser probe starts.

## What Changes

- Record symlinks as terminal cache entries using their link text; never read, stat, or traverse their targets.
- Preserve regular-file path, size, content SHA-256, deterministic ordering, absent-cache behavior, and native runner cleanup.
- Make link entries distinguishable from regular files in identity output and aggregate hashing.
- Add warm-cache and real native consumer regression evidence; document the identity and no-follow contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `development-navigation`: native warm-cache identity supports symbolic links without incorporating target contents.

## Impact

Touches the existing cache traversal in `scripts/native-hmr-observation.mjs`, its paired tests, native runner preflight evidence, and the native HMR guide. No product runtime, cache layout, dependency, native binary, retry, timeout, or CI gate changes.

## Triage

Issue type: bugfix
Fixture level: expanded
Upstream suggested level: absent; expanded for filesystem/path safety and the identity evidence schema.
Blast radius: following links can read arbitrary external trees, loop, or make qualification depend on target contents.
Selected risk packs: script entry, file IO/path safety, schema/units, resource bounds, compatibility, error/cleanup, documentation.
Evidence floor: semantic RED→GREEN tests, external-sentinel/no-follow cases, real warm-cache preflight through probe startup and cleanup, scoped checks, independent review.
