---
id: 0019
title: Incident-scoped Hurl download recovery
kind: process
status: implemented
date: 2026-11-08
---

# Incident-scoped Hurl download recovery

## Problem

The hosted API smoke job downloads Hurl from GitHub Releases. Its existing `curl --retry 3` exhausted four HTTP 504 responses in separate runs; another run reported curl exit 56. Installation failure skipped API smoke and failed `All checks passed`. Successful unchanged-installer runs and same-head recoveries establish an intermittent transport boundary, not an invalid URL, a 404, or a proven GitHub/CDN/proxy root cause.

The [incident evidence](https://github.com/DankerMu/mindsprout/issues/110) records this UTC timeline on 2026-11-08; times identify integration-job starts, not individual HTTP responses:

| Run                                                                            | Attempt | Start               | Hurl installation / API smoke / aggregate                                     |
| ------------------------------------------------------------------------------ | ------- | ------------------- | ----------------------------------------------------------------------------- |
| [42464124743](https://github.com/DankerMu/mindsprout/actions/runs/42464124743) | 1       | 08:44:56            | failed / skipped / failed; HTTP 504                                           |
| [42464235529](https://github.com/DankerMu/mindsprout/actions/runs/42464235529) | 1       | 08:46:47            | passed / passed / passed                                                      |
| [42466732831](https://github.com/DankerMu/mindsprout/actions/runs/42466732831) | 1 → 2   | 09:21:45 → 09:28:11 | failed / skipped / failed → all passed on the same head                       |
| [42471325983](https://github.com/DankerMu/mindsprout/actions/runs/42471325983) | 1 → 2   | 10:26:10 → 10:42:00 | failed / skipped / failed → all passed on the same head                       |
| [42472899440](https://github.com/DankerMu/mindsprout/actions/runs/42472899440) | 1 → 2   | 10:49:20 → 11:05:37 | failed / skipped / failed → all passed on the same head; initial curl exit 56 |

## Decision

- Retain the current Hurl download/install step, `--retry 3`, job budget and fail-closed API smoke/aggregate checks. Do not add automatic job retries or a second installer without new evidence and a separate decision.
- Classify the actual failing step before recovery. Only a confirmed download-transport failure qualifies for incident-scoped failed-job recovery; installation, database, application smoke, assertions, permissions and other failure classes require their own diagnosis. A recovery success does not establish the transport root cause.
- Require recorded owner authorization identifying the incident and retry scope. The owner's instruction “这次github问题，可以多次重试” permits repeated recoveries for this queue's confirmed incident, not permanent authorization for later incidents. Run one `gh run rerun <run-id> --failed` at a time on the unchanged expected head; inspect and retain each new attempt before deciding whether another remains within that authorization. Do not use an unattended retry-until-green loop.
- Record run, attempt, head, first actionable error, affected steps and recovery result. A changed head, changed failure class, expired authorization or persistent failure stops recovery and returns to diagnosis/escalation. Do not hide earlier failures or retry passing jobs unnecessarily.
- Require actual Hurl installation and API smoke success plus all genuine source-bound required checks before merge. Local checks supplement diagnosis; they cannot replace GitHub Actions results or authorize fabricated statuses, protection changes or admin bypass.

No active decision is superseded. Required-check source ownership remains in [decision 0013](0013-pin-required-checks-to-github-actions.md).

## Alternatives considered

- **Increase curl retries or job deadlines** — not selected: successful unchanged runs do not establish a useful new bound, and longer retries can only delay an unresolved outage.
- **Cache, vendor, mirror or replace the installer** — not selected: introduces artifact provenance, freshness and platform obligations without evidence selecting one. Reconsider in a separately scoped change if the observed availability cost warrants it.
- **Treat local smoke as required-CI success, skip smoke or tolerate download failure** — rejected: removes the independent API verification gate.
- **Leave recovery implicit** — rejected: repeated incidents otherwise invite unbounded retries and accidental expansion into application-test failures.

## Consequences

Transport outages may still delay merges. This decision completes the recovery-policy evaluation, not a network root-cause fix or availability guarantee. Future recurrence is diagnosed against its own evidence and authorization.

The existing installer exit, skipped-smoke handling, aggregate failure and source-bound branch protection are the mechanical guards. A new lint rule cannot verify an external server's availability; no additional static guard is introduced for the repeated transport incident. Owner authorization and attempt review remain explicit operational obligations.
