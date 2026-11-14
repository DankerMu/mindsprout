# account-admin Specification

## Purpose

The single administrator can see who has an account and reset a user's forgotten password, without being able to read anyone's maps.

## ADDED Requirements

### Requirement: Admin user list

The admin page `/admin` SHALL list every account with its username, creation time and whether it is the administrator, oldest first. It SHALL be reachable from a `管理后台` link in the header that only the administrator sees. A signed-in user who is not the administrator SHALL see "无权访问" on `/admin`, and the admin API SHALL refuse them with 403.

#### Scenario: Admin sees all accounts

- **WHEN** the administrator `owner` and users `alice` and `bob` exist, registered in that order, and `owner` opens `/admin`
- **THEN** the list shows `owner` (marked 管理员), then `alice`, then `bob`, each with its creation time

#### Scenario: Regular user is refused

- **WHEN** `alice`, who is not the administrator, opens `/admin` or calls the admin user list API
- **THEN** the page shows "无权访问" and the API answers 403, and no account data is shown

#### Scenario: Admin link visibility

- **WHEN** the administrator and a regular user each view `/`
- **THEN** only the administrator's header shows 管理后台

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
