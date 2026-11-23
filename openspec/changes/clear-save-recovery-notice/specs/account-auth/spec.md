# account-auth Specification Delta

## MODIFIED Requirements

### Requirement: Session expiry while editing keeps pending edits

When a save is refused because the session has ended, the editor SHALL stay open and keep the unsaved edits pending. It SHALL show the notice "登录已过期，请在新标签页重新登录后继续编辑" with a `重新登录` link that opens `/login?next=%2F` in a new tab, so signing in there lands on the library and never opens a second editor of the same map. After the user signs in again, the next edit or flush SHALL save the pending map. When the current stable map saves successfully and no newer edit is pending, the editor SHALL clear the session-expiry notice and its re-login link. A successful older write SHALL NOT clear a notice caused by a newer failed edit. When a page's initial load is refused because there is no session, the page SHALL redirect to `/login?next=<current path>` instead.

#### Scenario: Edit after the session ended

- **WHEN** a user's session is ended (signed out in another tab) and they then rename a node
- **THEN** the notice "登录已过期，请在新标签页重新登录后继续编辑" and the 重新登录 link appear, and the rename stays on the canvas

#### Scenario: Pending edits saved after signing in again

- **WHEN** the user from the previous scenario signs in again in another tab, returns and makes another edit
- **THEN** reloading the editor shows both the earlier rename and the new edit

#### Scenario: Re-login does not open a second editor

- **WHEN** the user from "Edit after the session ended" follows the 重新登录 link and signs in on the new tab
- **THEN** the new tab shows `/`, not the editor, and the original tab's next edit saves both the earlier rename and that edit

#### Scenario: Expired session on page load

- **WHEN** a visitor whose session cookie is no longer valid opens `/`
- **THEN** they are taken to `/login?next=%2F`

#### Scenario: Successful recovery clears the session warning

- **WHEN** the current stable map saves successfully after a session-expiry refusal and no newer edit is pending
- **THEN** the session-expiry notice and re-login link disappear without a manual close action
- **AND** an older write succeeding after a newer edit was refused leaves the newer failure notice visible
