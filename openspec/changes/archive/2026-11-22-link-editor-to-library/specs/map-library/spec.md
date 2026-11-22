# Spec Delta

## ADDED Requirements

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
