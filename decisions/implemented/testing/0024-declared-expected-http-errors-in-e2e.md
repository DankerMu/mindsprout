---
id: 0024
title: Declare expected HTTP errors in e2e
kind: testing
status: implemented
date: 2026-11-15
---

# Declare expected HTTP errors in e2e

## Problem

An expected non-2xx response logs a Chromium resource-load error, while browser tests must keep rejecting unexpected console errors, warnings and page errors. A global text filter would hide failures, and declaring an expected status must not prove that the request occurred.

## Decision

Tests that expect a non-2xx response declare its URL pattern and status through `e2e/support/expected-responses.ts`. The helper attaches to that page's `response` event and retains the actual URL/status observations. Its collector removes only the corresponding `Failed to load resource` console error when the message URL equals the observed response URL and the message status equals both declaration and observation.

Declarations are anchored to URL pathnames, not hostnames or arbitrary substrings. Path matching covers the complete path, so `/foo` does not match `/foobar`; query and fragment are not part of the path. This declaration convenience does not relax full URL equality for suppression: Chromium may retain a request fragment in a console location while omitting it from the response URL, so that pair remains unexpected and reports its missing counterparts. A declaration must be registered before the request it describes. A declaration that matches no observed response is reported rather than silently widening acceptance.

Every other console error or warning, every page error, and every failed load without a matching observed declaration remains visible. Suppression does not consume a response or an unrelated message. Specs with no declarations retain their current collectors; there is no global console filter.

The helper, its real-browser self-test and this record land before any existing spec adopts it. Native JSON result production and credential-safe server startup are unchanged.

## Alternatives considered

- A global `Failed to load resource` filter hides unexpected failures without correlating a declared response.
- Declaring status alone accepts a response from the wrong URL, while declaring a URL without observing its status can hide an unfulfilled expectation.
- Matching console text without page response events cannot prove that an expected request occurred or correlate browser event ordering.
- URL substring matching can suppress a sibling route. Query- or host-based declarations add ambiguity not required by the declared API consumers.
- Request interception, response rewriting and a custom Playwright reporter change the runtime or evidence being tested rather than filtering the browser's diagnostic surface.

## Consequences

A test must await both the expected page response and its corresponding Chromium resource-error console event before asserting its collector is empty. An empty collector read must also reconcile outstanding response/console ordering with a deterministic timeout, not a fixed sleep. Unexpected noise must remain visible with the unused-declaration diagnostic. The returned collector is an array of unexpected messages, including unused declarations, in observation/declaration order.

Native runtime results remain governed by [decision0020](0020-native-e2e-runtime-results.md). Database/server ownership and private credential transport remain governed by [decision0026](0026-isolated-e2e-database-and-server.md). This decision supersedes neither. Its first consumer is the signed-out session 401 self-test; future map and admin tests adopt it only for their declared responses.

Rollback removes the helper and its self-test; existing specs retain their strict collectors.
