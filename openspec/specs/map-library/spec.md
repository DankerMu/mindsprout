# map-library Specification

## Purpose

The home page lists the signed-in user's cloud maps and lets them create, open, rename and delete maps.

## Requirements

### Requirement: Create a map

The home page SHALL offer "新建导图"; creating SHALL call the domain factory `createMindMap` to produce a map titled "新导图" whose primary root text is "新导图", save it, and navigate to its editor.

#### Scenario: Create from the empty state

- **WHEN** there are no maps and the user clicks 新建导图
- **THEN** the editor at `/maps/<new id>` opens with a single root node titled "新导图" and the header shows the title "新导图"

### Requirement: List maps

The home page SHALL list every map of the signed-in user with its title and last-updated time (`MapSummary { id, title, updatedAt }`), most recently updated first. It SHALL never list another user's maps. An empty list SHALL show an empty-state message with the create action. The visible last-updated time SHALL use the shared Chinese `Intl.DateTimeFormat` with `dateStyle: 'medium'` and `timeStyle: 'short'` in the browser's local timezone, and SHALL NOT display the raw ISO string. The `<time dateTime>` attribute SHALL preserve the complete original `updatedAt` ISO value, and ordering SHALL continue to use the raw value rather than display text.

#### Scenario: Ordering

- **WHEN** maps A (updated 10:00) and B (updated 11:00) exist
- **THEN** the list shows B before A

#### Scenario: Only the user's own maps

- **WHEN** `alice` has map A and `bob` has map B, and `alice` opens `/`
- **THEN** the list shows A and not B

#### Scenario: Localized display preserves the machine timestamp

- **WHEN** a map's original `updatedAt` is an ISO instant that falls on different dates in UTC and the browser's local timezone
- **THEN** the visible time is the correct localized Chinese date and hour/minute without a raw `T…Z` string
- **AND** the same element's `dateTime` remains the original ISO instant and raw-value ordering is unchanged

#### Scenario: Unparseable timestamps preserve existing rendering

- **WHEN** an accepted map record has an unparseable arbitrary string as `updatedAt`
- **THEN** the library continues to render that original string as both visible text and `dateTime` without throwing
- **AND** valid sibling rows, raw-value ordering and all row actions remain available

### Requirement: Open, rename, delete

Clicking a list entry SHALL open its editor; rename SHALL update the map title and `updatedAt` through the application layer (not a TreeOp, not an undo step; the primary root text stays independent); delete SHALL ask for confirmation and then remove the map from storage.

#### Scenario: Rename from the list

- **WHEN** the user renames map A to "读书笔记"
- **THEN** the list shows "读书笔记" first (its `updatedAt` is newest) and reopening A shows that title in the editor header with the primary root text unchanged

#### Scenario: Delete with confirmation

- **WHEN** the user chooses delete on map A and confirms
- **THEN** A is no longer listed and `/maps/<A id>` shows the not-found state

#### Scenario: Cancel deletion

- **WHEN** the user chooses delete on map A and cancels confirmation
- **THEN** A remains listed and its stored record is unchanged

#### Scenario: Unsupported version in the library

- **WHEN** a readable summary belongs to a newer-version record and the user submits a rename
- **THEN** the library shows "此导图由更新版本创建" without writing the record
- **AND** the user may still explicitly confirm deletion of that record; deletion removes it without reading or migrating its content

#### Scenario: Rename target identity is invalid

- **WHEN** the selected record is missing or its embedded map ID differs from the library row ID
- **THEN** rename reports failure and writes no record, including any record named by the mismatched embedded ID

#### Scenario: Persistence failure

- **WHEN** rename or confirmed deletion fails in the repository
- **THEN** the library retains the last saved row, shows an error and permits an explicit retry without changing repositories

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

### Requirement: Matching-identity autosave verification readiness

The matching-identity autosave acceptance walk SHALL establish that the actual root node is available for interaction after the editor becomes ready and before reading or manipulating that node. Editor-level readiness alone SHALL NOT be treated as proof of node-level availability, and the acceptance walk SHALL preserve every existing rename, autosave payload, matching-key and peer-preservation outcome.

#### Scenario: Editor ready before root-node interaction

- **WHEN** the acceptance walk opens a matching-identity map and observes the editor-ready state
- **THEN** it waits for the actual root node before the original text assertion and double-click interaction
- **AND** the renamed text, debounced save payload, matching storage key and unchanged peer record are still verified without a skipped or weakened assertion

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

### Requirement: Cloud map-library purpose remains current

The `map-library` capability SHALL summarize its operations as managing the signed-in user's cloud maps, not browser-local storage.

#### Scenario: Reader inspects the capability summary

- **WHEN** a reader inspects the `map-library` Purpose
- **THEN** it states that the home page lists the signed-in user's cloud maps and lets them create, open, rename and delete maps
- **AND** no requirement or scenario is changed by that summary correction

### Requirement: Ready editor links back to the library

The normal ready editor SHALL expose a visible, keyboard-focusable link named 返回导图列表 targeting `/` in its header. Following the link SHALL navigate to the signed-in user's library without requiring browser history. Existing not-found and unreadable-map return links SHALL retain their current behavior. Navigating through the ready-editor link immediately after an edit SHALL preserve the existing unmount flush and ordered persistence behavior.

#### Scenario: Direct editor link returns to the library

- **WHEN** a signed-in user opens `/maps/<id>` directly and keyboard-activates 返回导图列表 in the ready editor header
- **THEN** they reach `/` and the library displays that map

#### Scenario: Immediate return preserves the latest edit

- **WHEN** a user edits a node and immediately follows 返回导图列表
- **THEN** the library lists the map first with its latest title and `updatedAt`, and reopening it shows the latest saved tree

#### Scenario: Status-page return links are unchanged

- **WHEN** a user opens a missing or unreadable map and follows its existing 返回导图列表 link
- **THEN** the existing status page and navigation behavior remain intact

### Requirement: List mutations identify their row target

The library SHALL present a rename form or delete confirmation within the map row that initiated it, including when multiple rows have identical titles. Confirmation SHALL continue to operate on the initiating row's captured map ID and SHALL preserve the existing cancellation, focus, failure and serialization behavior. The delete confirmation SHALL continue to ask exactly 确定永久删除“<title>”吗？ using the captured target title.

#### Scenario: Same-title rows retain distinct operation targets

- **WHEN** two listed maps are both titled 新导图 and the user starts rename or delete on the second row
- **THEN** the corresponding form or confirmation appears only within that second row and its confirmation writes or deletes only that row's map ID, leaving the peer map unchanged

#### Scenario: Inline cancellation remains non-destructive

- **WHEN** a user cancels an inline rename or delete confirmation or presses Escape before confirmation
- **THEN** no map write or delete occurs, the form or confirmation closes, and the existing trigger-focus behavior is preserved

### Requirement: Readable list presentation

The signed-in home page SHALL present maps without browser-default bullet markers, with consistent row spacing and wrapping, visually distinct timestamps and clearly styled action controls. Hiding markers SHALL NOT remove list semantics for assistive technology. Existing inline rename forms and delete confirmations SHALL remain visibly associated with the row that initiated them.

#### Scenario: Map rows and controls are visually structured

- **WHEN** a signed-in user's library contains maps
- **THEN** the list has no bullet markers, retains explicit list semantics for assistive technology, has rows with consistent spacing and wrapping, and visually distinguishable timestamps and action controls

#### Scenario: Inline mutations retain their visual target

- **WHEN** a user opens rename or delete confirmation from a map row, including one of two same-title rows
- **THEN** the form or confirmation remains within that initiating row and its controls remain visible and usable without changing the captured map target
