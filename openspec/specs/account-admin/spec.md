# account-admin Specification

## Purpose

The single administrator can see who has an account and reset a user's forgotten password, without being able to read anyone's maps.

## Requirements

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

### Requirement: Admin password reset

The administrator SHALL be able to reset any account's password after confirming "重置后该用户的所有登录将失效". A reset SHALL set a new random temporary password and end every session of that account. The temporary password SHALL be shown to the administrator exactly once and never stored in readable form or logged. The account's old password SHALL stop working. Resetting an account that does not exist SHALL report not found. There is no other way to change a password (decision 0023).

#### Scenario: Reset signs the user out and issues a temporary password

- **WHEN** `alice` is signed in on two devices and the administrator resets her password and confirms
- **THEN** the administrator is shown a temporary password once, both of alice's devices are treated as signed out, her old password is refused, and the temporary password signs her in

#### Scenario: Reset completes before pending sign-in issues a session

- **WHEN** sign-in has captured the old password hash, a reset completes, and the old-password verification then succeeds
- **THEN** session issuance is refused, sign-in reports invalid credentials, and no new session authenticates that account

#### Scenario: Reset follows completed session issuance

- **WHEN** session issuance completes before a concurrent password reset
- **THEN** the reset ends that session and its token no longer authenticates the account

#### Scenario: Reset interrupts registration sign-in

- **WHEN** registration has created an account and a reset changes its credential before the initial session is issued
- **THEN** registration returns no authenticated success or cookie, and the account remains with the replacement credential

#### Scenario: Cancel the reset

- **WHEN** the administrator chooses 重置密码 for `alice` and cancels the confirmation
- **THEN** alice's password and sessions are unchanged

#### Scenario: Temporary password is shown once

- **WHEN** the administrator closes the dialog showing alice's temporary password and opens `/admin` again
- **THEN** the temporary password is not displayed anywhere

#### Scenario: Reset of an unknown account

- **WHEN** the reset API is called for an account id that does not exist
- **THEN** it answers 404 and nothing changes

### Requirement: Administrators cannot read users' maps

Administrator rights SHALL cover only the user list and password reset. An administrator's map access SHALL be the same as any user's: only their own maps.

#### Scenario: Admin opens another user's map

- **WHEN** the administrator opens `/maps/<id of alice's map>` or requests it from the map API
- **THEN** they get the not-found state or a 404, exactly as for a missing map

### Requirement: Password reset identifies the account

Every password-reset control in the administrator user list SHALL have an accessible name containing its account username. Its confirmation SHALL name that account and SHALL contain the exact sentence 重置后该用户的所有登录将失效. Confirmation SHALL reset only the selected account; cancellation SHALL issue no reset request.

#### Scenario: Administrator identifies the reset account

- **WHEN** the administrator chooses 重置密码 alice from alice's row
- **THEN** the confirmation names alice and contains 重置后该用户的所有登录将失效, and accepting it requests a reset only for alice's account ID

#### Scenario: Named reset is cancelled

- **WHEN** the administrator cancels the confirmation naming alice
- **THEN** no reset request is sent and alice's password and sessions remain unchanged

### Requirement: Readable list presentation

The admin page SHALL present accounts without browser-default bullet markers, with consistent row spacing and wrapping, visually distinct creation times and clearly styled reset controls. Hiding markers SHALL NOT remove list semantics for assistive technology. Every reset control SHALL retain its existing account-specific accessible name and confirmation behavior.

#### Scenario: Account rows and reset controls are visually structured

- **WHEN** the administrator opens `/admin` and accounts exist
- **THEN** the list has no bullet markers, retains explicit list semantics for assistive technology, has rows with consistent spacing and wrapping, and visually distinguishable creation times and reset controls
- **AND** each reset control still identifies its account and preserves the existing confirmation and cancellation behavior
