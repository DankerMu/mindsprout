# Spec Delta

## Purpose

Publish topic generation as one authenticated, stateless HTTP endpoint that streams validated TreeOps to the editor as server-sent events.

## ADDED Requirements

### Requirement: Generate requires a signed-in session

`POST /api/ai/generate` SHALL verify the session itself before any other work. Without a valid session it SHALL answer 401 with error code `unauthenticated` and SHALL NOT call any provider. A present Session binding that differs from the session's user SHALL also answer 401.

#### Scenario: Signed out

- **WHEN** a request without a session cookie posts a valid body
- **THEN** the response is 401 `unauthenticated` JSON and no provider is called

### Requirement: Request body is validated before streaming

The body SHALL be a JSON object with exactly `topic` and `rootId`. `topic` SHALL be a string of 1–200 UTF-16 code units that is not blank after trimming, and `rootId` SHALL be a non-empty string. Any other body SHALL answer 400 `invalid-input` JSON without calling a provider.

#### Scenario: Blank topic

- **WHEN** a signed-in user posts `{"topic":"   ","rootId":"r1"}`
- **THEN** the response is 400 `invalid-input`

#### Scenario: Oversized topic

- **WHEN** the topic is 201 code units long
- **THEN** the response is 400 `invalid-input`

#### Scenario: Unknown field

- **WHEN** the body carries an extra field
- **THEN** the response is 400 `invalid-input`

### Requirement: Unconfigured AI answers 503

When no provider is configured, a signed-in request with a valid body SHALL answer 503 with error code `ai-unavailable` as JSON.

#### Scenario: AI disabled

- **WHEN** `AI_PROVIDER` is unset and a signed-in user posts a valid body
- **THEN** the response is 503 `ai-unavailable`

### Requirement: Success streams op events and exactly one terminal event

A valid, authenticated request with a configured provider SHALL answer 200 with content type `text/event-stream` and `cache-control: no-store`. The stream SHALL carry zero or more `op` events, each whose data is one TreeOp. It SHALL end with exactly one terminal event: `done` with data `{}`, or `error` with data `{"code","message"}` where code is one of `timeout`, `provider-error`, `invalid-output` or `refused`. The route SHALL NOT read or write any stored map.

#### Scenario: Mock generation streams to done

- **WHEN** a signed-in user posts a valid topic with the mock provider configured
- **THEN** the response streams 5 `op` events followed by one `done` event

#### Scenario: Error after partial output

- **WHEN** the mock provider is asked for `mock:error-after-2`
- **THEN** the stream carries 2 `op` events and then one `error` event with code `provider-error` and no `done`

#### Scenario: Stateless

- **WHEN** a generation completes
- **THEN** no map row has been read, created or modified by the request

### Requirement: Client disconnect aborts the provider call

When the client disconnects before the terminal event, the server SHALL abort the provider call and stop producing events.

#### Scenario: Browser stops the request

- **WHEN** the client aborts its request after the first op event
- **THEN** the provider call observes the abort and no further provider work is done

### Requirement: Published contract matches

`schemas/openapi.yaml` SHALL describe `/api/ai/generate` with its request body, its JSON error responses (400, 401, 503) and its event-stream response. `smoke/api.hurl` SHALL exercise the 401, 400 and mock-provider 200 cases. The key-route inventory SHALL mark the route as covered.

#### Scenario: Contract snapshot

- **WHEN** the contract tests run
- **THEN** the published OpenAPI snapshot includes `/api/ai/generate` and matches the document
