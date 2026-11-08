# Tasks

## 1. Correct generated-file path matching

- [x] 1.1 Extend existing native guardrail fixtures with exact root lockfile-only/paired-manifest counts, root/nested snapshot and lockfile siblings and ordinary near-miss control; parent records RED before production edits.
- [x] 1.2 Apply glob magic to the three affected exclusion patterns only; add bug-fix decision after lifecycle check. Parent records full guardrail GREEN and historical1684/exit1 smoke, retaining401 ordinary rejection and all prior error/label cases.
- [x] 1.3 Run scoped checks and four-seat full-depth review; satisfy genuine exact-head CI, merge, sync spec and archive separately. Include gate-behavior evidence in the final consolidated EPIC acceptance, as explicitly requested by the owner; do not request per-issue functional acceptance.

## Risk packs

- Public API / CLI / script entry — selected: actual script exit/count tests in1.1–1.2, unchanged usage/errors.
- Config / project setup — selected:400 threshold and workflow/labels remain unchanged; existing boundary/exemption tests in1.2 and review in1.3.
- File IO / path safety / overwrite — selected:path matching across root/nested siblings and ordinary near-misses in1.1; existing temporary-fixture cleanup must remain.
- Schema / columns / units / field names — selected:counting units and exclusions, not data schema; exact counts and historical smoke in1.2; no regex change.
- Auth / permissions / secrets — not selected:no permissions/secrets/input authority change; normal protected merge remains required.
- Concurrency / shared state / ordering — not selected:no live-label lookup or trigger changes; existing tests and read-only workflow review preserve behavior.
- Resource limits / large input / discovery — selected:generated401+line inputs excluded, real401 retained;1.1–1.2.
- Legacy compatibility / examples — selected:historical ad97d5b count and existing guardrail cases;1.2.
- Error handling / rollback / partial outputs — selected:existing usage/base/limit/diff failure cases retained and run;1.2; no fail-open fallback.
- Release / packaging / dependency compatibility — not selected:no package/dependency/release change; real root lockfile untouched.
- Documentation / migration notes — selected:decision and canonical delta in1.2–1.3; no migration or application changeset required.
