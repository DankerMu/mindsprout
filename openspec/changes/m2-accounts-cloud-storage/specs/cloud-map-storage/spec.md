# cloud-map-storage Specification

## Purpose

Each signed-in user's maps are stored on the server, isolated from every other user by the database itself, so the same maps open from any browser where that user signs in.

## ADDED Requirements

### Requirement: Maps follow the user across browsers

A map saved by a signed-in user SHALL be listed and opened, with identical content, in any other browser session where the same user signs in.

#### Scenario: Open on a second device

- **WHEN** `alice` creates a map in browser context A, adds three child nodes and waits for the save, then signs in as `alice` in a separate browser context B
- **THEN** context B lists the map, and opening it shows the same title, the three nodes with the same text and order, and any floating root at its saved position

### Requirement: Storage is isolated per user by the database

Map rows SHALL be readable and writable only by their owner. This SHALL be enforced by database row-level security, evaluated against the user identity set for the current transaction. The application SHALL access user data through a role that owns no table, is not a superuser and cannot bypass row-level security. A query that runs without a user identity SHALL see no map rows.

#### Scenario: Another user's map is invisible

- **WHEN** `bob` lists maps, or requests, overwrites or deletes the id of `alice`'s map
- **THEN** his list omits it, the request answers 404 (delete answers 204), and alice's map is unchanged

#### Scenario: Application role cannot bypass isolation

- **WHEN** the application's database role is inspected
- **THEN** it is not a superuser, does not have the bypass-RLS attribute and owns none of the tables

#### Scenario: Query without a user identity

- **WHEN** a query on maps runs through the application role without a user identity set
- **THEN** it returns no rows, and an insert is refused

### Requirement: Map store keeps the repository contract

The server map store, and the browser's access to it, SHALL satisfy the existing `MapRepository` contract:

- `put` stores a map exactly as given and `get` returns it deep-equal.
- `list` returns `{ id, title, updatedAt }` summaries, most recently updated first, with ties broken by id ascending in code-unit order.
- `get` of an absent id reports absence, not an error.
- `delete` of an absent id succeeds.
- `put` of an existing id replaces it.

#### Scenario: Contract over HTTP and over the database

- **WHEN** the shared repository contract suite runs against the browser adapter and against the per-user database store
- **THEN** every contract case passes for both, unchanged

### Requirement: Saved maps are validated

The server SHALL accept a map only when:

- it is a well-formed MindMap with at least one root;
- the primary root has no position, every floating root has a finite position, and no other node has a position;
- node ids are unique and colours are colour tokens;
- the envelope `schemaVersion` is 1;
- its embedded id equals the id in the request path.

Anything else SHALL be refused with 400 `invalid-map` and nothing written. A request body larger than 1 MiB SHALL be refused with 413 and nothing written.

#### Scenario: Floating root without a position

- **WHEN** a map whose second root has no position is saved
- **THEN** the save answers 400 `invalid-map` and the stored map, if any, is unchanged

#### Scenario: Embedded id differs from the path

- **WHEN** a map whose id is `B` is saved to `/api/maps/A`
- **THEN** the save answers 400 and neither `A` nor `B` is written

#### Scenario: Duplicate node ids

- **WHEN** a map containing two nodes with the same id is saved
- **THEN** the save answers 400 `invalid-map`

#### Scenario: Oversized body

- **WHEN** a save request body exceeds 1 MiB
- **THEN** it answers 413 and nothing is written

#### Scenario: Valid 500-node map

- **WHEN** a generated 500-node map with floating roots, notes, colours and collapsed nodes is saved and read back
- **THEN** the save succeeds and the read returns it deep-equal

### Requirement: Map API contract

The map API SHALL be:

- `GET /api/maps` → 200 summaries.
- `GET /api/maps/{id}` → 200 `{ schemaVersion, map }`, or 404 `not-found` when the map is absent or belongs to another user.
- `PUT /api/maps/{id}` with `{ schemaVersion, map }` → 204.
- `DELETE /api/maps/{id}` → 204.

Error bodies SHALL be `{ "error": "<code>" }`, and a request without a session SHALL get 401 on every route. Every route SHALL be registered in the published OpenAPI document and exercised by the API smoke test.

#### Scenario: Round trip through the API

- **WHEN** a signed-in client puts a map, gets it, lists maps and deletes it
- **THEN** the responses are 204, 200 with the identical envelope, 200 with its summary first, and 204, and a following get answers 404

#### Scenario: Published contract matches

- **WHEN** the OpenAPI contract test and the API smoke test run
- **THEN** every map, auth and admin route is present in the published document and the smoke test passes against a running server

### Requirement: Schema is managed by ordered migrations

The database schema SHALL be created and changed only by numbered SQL migrations, applied in order by one command under the owner role. Each migration SHALL run in its own transaction and be recorded once applied. Re-running the command SHALL apply nothing new. A failing migration SHALL leave no partial change and exit non-zero.

#### Scenario: Fresh database

- **WHEN** the migrate command runs against an empty database
- **THEN** all migrations apply in name order and each is recorded

#### Scenario: Re-run is a no-op

- **WHEN** the migrate command runs again with no new migration files
- **THEN** nothing is applied and it exits zero

#### Scenario: Failing migration

- **WHEN** a migration file contains an error
- **THEN** none of its statements remain applied, it is not recorded, later files are not applied, and the command exits non-zero
