# map-library Specification (delta)

## MODIFIED Requirements

### Requirement: List maps

The home page SHALL list every map of the signed-in user with its title and last-updated time (`MapSummary { id, title, updatedAt }`), most recently updated first. It SHALL never list another user's maps. An empty list SHALL show an empty-state message with the create action.

#### Scenario: Ordering

- **WHEN** maps A (updated 10:00) and B (updated 11:00) exist
- **THEN** the list shows B before A

#### Scenario: Only the user's own maps

- **WHEN** `alice` has map A and `bob` has map B, and `alice` opens `/`
- **THEN** the list shows A and not B

### Requirement: Unknown map id

Opening `/maps/<id>` SHALL show a not-found state with a link back to the library, not an error page, both for an id that does not exist and for a map that belongs to another user. The two cases SHALL be indistinguishable.

#### Scenario: Stale link

- **WHEN** the user opens `/maps/does-not-exist`
- **THEN** the page shows "找不到这张导图" and a link to `/`

#### Scenario: Another user's map

- **WHEN** `bob` opens the URL of `alice`'s map
- **THEN** the page shows "找不到这张导图" and a link to `/`, and alice's map is unchanged

### Requirement: Unreadable map shows an error state

Opening `/maps/<id>` SHALL show an error state with a link back to the library when the store returns a map that cannot be read or rendered. It SHALL never show the not-found state or a blank page, and SHALL modify nothing. A returned map whose embedded ID differs from the requested route ID SHALL be rejected before an autosave-capable editor mounts. The rejection SHALL issue no put and SHALL modify neither the requested map nor any map named by the embedded ID. Maps whose IDs match SHALL keep normal editing and autosave behaviour. These guards apply to every repository (decision 0016), even though the cloud store refuses to save such maps (cloud-map-storage "Saved maps are validated").

#### Scenario: Corrupt record

- **WHEN** the store returns, for `/maps/<id>`, a map holding a floating root without a position
- **THEN** the page shows "无法打开这张导图" and a link to `/`, and not "找不到这张导图"

#### Scenario: Mismatched stored map identity

- **WHEN** the store returns, for id A, a renderable map whose embedded ID is B, a distinct map B exists, and the user opens `/maps/A`
- **THEN** the page shows the existing error state and back link without mounting a ready editor, issuing a put, repairing or deleting either map
- **AND** the maps held for A and B are exactly unchanged after the rejection and after leaving the route

#### Scenario: Matching identity preserves normal persistence

- **WHEN** a map's embedded ID matches its requested route ID and the user edits a node title
- **THEN** the editor opens normally and autosaves the change under that same ID, without changing any other map

### Requirement: Published canvas limitations

The README SHALL disclose at least the following among the entries under `## Known Limitations`; other entries that are still true MAY remain:

- no AI;
- editing one map on two devices at once keeps the last save;
- 500 ms trailing-debounce autosave, with possible loss of all pending changes since the last successful save on immediate reload. Continuous editing restarts the timer, so pending edits can be older than 500 ms;
- LR-only layout;
- no export;
- no password change or self-service recovery: only the administrator can reset a password, and a forgotten administrator password cannot be recovered;
- no sign-in throttling.

The documentation gate SHALL require this section without a README allowlist or matching constraints exemption.

#### Scenario: M1 documentation closure

- **WHEN** the shipped canvas documentation is checked
- **THEN** TECH section 7 describes the implemented module locations, and the documentation and guardrail checks pass without a README exemption

#### Scenario: M2 documentation closure

- **WHEN** the shipped documentation is checked after this change
- **THEN** the README lists all seven limitations and no longer claims browser-only storage, TECH section 7 describes the implemented module locations including the account context, and the documentation and guardrail checks pass without a README exemption

#### Scenario: Missing limitations are rejected

- **WHEN** the README lacks `## Known Limitations` and its exemptions have been removed
- **THEN** the documentation gate rejects the README and reports the missing required section

## REMOVED Requirements

### Requirement: Library works without storage

**Reason**: Browser storage and its in-memory fallback are retired (decision 0023). The library reads the signed-in user's cloud store, and a page whose initial load is refused for lack of a session redirects to sign-in (account-auth).

**Migration**: None for users. `e2e/storage-fallback.spec.ts` and the banner are deleted (design D10).
