---
id: 0031
title: Keep public-create evidence separate from readiness
kind: testing
status: implemented
date: 2026-11-17
---

# Keep public-create evidence separate from readiness

## Problem

A readiness timeout with observed RSC or map requests does not establish whether the application received, parsed or rendered its data. A later diagnostic event cannot establish readiness inside the original deadline. Retaining request identities or raw payloads would also violate safe-publication constraints.

## Decision

Extend the existing opt-in observer and safe-summary publisher, rather than adding a second network observer. Attribute one attempt to the original collector start, deadline, action settlement and readiness outcome. Keep request IDs private for redirect correlation; publish fixed request classes, bounded local hop ordinals and separate numeric clock domains. The [native guide](../../../docs/engineering/native-hmr.md#public-create-evidence) owns field interpretation and failure-tail behavior.

Capture an original failure once. Passive evidence may continue through existing failure capture, but cannot renew its deadline or qualify it retroactively. Fence successful attempts before subsequent navigation, and finalize failed attempts on closure or publication. Project every publication field explicitly, including compact output; unavailable observations remain partial.

Register attempt termination before asynchronous observation begins. Treat binding acquisition and sampler installation as distinct owned resources: acknowledgement delay or failed installation must not bypass cleanup, while foreign globals and later documents remain outside that ownership.

## Alternatives considered

- **Infer data readiness from API completion or SPA history.** Network delivery and URL changes do not establish application promise resolution, a React commit or visible readiness.
- **Extend the assertion deadline or wait for late evidence.** That changes the measured qualification and can turn a failed attempt into an apparent success.
- **Replace a request row when CDP reuses its ID.** A redirect's response belongs to the preceding hop. Excluded or over-cap replacements must terminate attribution rather than overwrite earlier evidence.
- **Upload raw event records.** URLs, identifiers, headers, bodies and error strings are not safe diagnostic fields; raw fallback also defeats bounded publication.
- **Gate cleanup solely on successful sampler installation.** A binding can already exist when its acknowledgement times out or installation fails. Ownership must survive that gap without requiring late page work to occur.

## Consequences

Observation remains non-authoritative: absent events do not prove server non-response, and a successful diagnostic invocation does not repair or qualify another invocation. Resource and output bounds can make evidence partial without changing the functional result.

No active decision is superseded. [Decision 0030](0030-native-navigation-diagnostic-profiling.md) retains profiling, signal ownership, publication safety and CI eligibility; this record owns only public-create attribution. This is diagnostic tooling, with no product behavior or package changeset.
