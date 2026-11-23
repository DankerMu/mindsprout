# account-admin Specification Delta

## MODIFIED Requirements

### Requirement: Admin user list

The admin page `/admin` SHALL list every account with its username, creation time and whether it is the administrator, oldest first. It SHALL be reachable from a `管理后台` link in the header that only the administrator sees. A signed-in user who is not the administrator SHALL see "无权访问" on `/admin`, and the admin API SHALL refuse them with 403. The visible creation time SHALL use the same shared Chinese `Intl.DateTimeFormat` as the map library with `dateStyle: 'medium'` and `timeStyle: 'short'` in the browser's local timezone, and SHALL NOT display the raw ISO string. The `<time dateTime>` attribute SHALL preserve the complete original `createdAt` ISO value, and oldest-first ordering SHALL remain based on the API's raw account order.

#### Scenario: Admin sees all accounts

- **WHEN** the administrator `owner` and users `alice` and `bob` exist, registered in that order, and `owner` opens `/admin`
- **THEN** the list shows `owner` (marked 管理员), then `alice`, then `bob`, each with its creation time

#### Scenario: Regular user is refused

- **WHEN** `alice`, who is not the administrator, opens `/admin` or calls the admin user list API
- **THEN** the page shows "无权访问" and the API answers 403, and no account data is shown

#### Scenario: Admin link visibility

- **WHEN** the administrator and a regular user each view `/`
- **THEN** only the administrator's header shows 管理后台

#### Scenario: Localized account creation time preserves the machine value

- **WHEN** an account's original `createdAt` is an ISO instant that crosses a date boundary in the browser's local timezone
- **THEN** the visible time is the correct localized Chinese date and hour/minute without a raw `T…Z` string
- **AND** the same element's `dateTime` remains the original ISO instant and account order is unchanged
