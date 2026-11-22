# Spec Delta

## ADDED Requirements

### Requirement: Explicit sign-out navigation wins over stale expiry redirects

Once an explicit sign-out succeeds and navigation to `/login` begins, an unauthorized response belonging to the outgoing page's pending library list, administrator list or administrator password reset SHALL NOT redirect that page to `/login?next=<path>` or overwrite the sign-out destination. A sign-out failure SHALL NOT establish this precedence. Without a successful explicit sign-out, a current initial-load or reset expiry SHALL retain its fresh-document redirect with the appropriate current path as `next`.

An asynchronous expiry response SHALL navigate only when its captured navigation epoch is current and the session-navigation lifecycle is active for an authenticated protected page. A sign-out SHALL leave that lifecycle inactive across any outgoing protected-page/provider remount while `/login` navigation is pending. Mounting the public sign-in or registration form SHALL establish a public-auth boundary without activating the lifecycle. Only a successful sign-in or registration, or an observed route transition from that boundary to a protected page, SHALL permit a new active lifecycle. Beginning a new lifecycle SHALL NOT reactivate an asynchronous callback captured before sign-out.

#### Scenario: Delayed list unauthorized response after sign-out

- **WHEN** a library list request is pending, the user's sign-out succeeds with 204, and that list subsequently answers 401 while the outgoing page remains mounted behind a held navigation
- **THEN** the browser reaches and remains at exactly `/login` after navigation is released, not `/login?next=%2F`, and the old session cookie is still invalid

#### Scenario: Actual initial-load expiry retains next

- **WHEN** a signed-out visitor's current library load answers 401 without a preceding successful explicit sign-out
- **THEN** the browser navigates by document to `/login?next=%2F` and the API still returns 401

#### Scenario: Failed sign-out does not suppress a real expiry

- **WHEN** the sign-out request fails or returns an error and a current list subsequently answers 401
- **THEN** no successful-sign-out navigation precedence is established, the existing sign-out failure behavior remains, and the current expiry uses its normal next redirect

#### Scenario: Administrator list and reset retain their expiry contracts

- **WHEN** an administrator list load or password-reset response answers 401 after sign-out versus during a genuine session expiry
- **THEN** the stale-after-sign-out response cannot replace `/login`, while the genuine expiry still navigates to `/login?next=%2Fadmin`

#### Scenario: New authenticated lifecycle does not inherit sign-out precedence

- **WHEN** a user signs out, the public sign-in/registration boundary and then a successful sign-in or registration occur in the same document, and a subsequent new-page list or reset answers 401
- **THEN** that genuine expiry follows its normal next redirect, while any callback captured before sign-out remains unable to navigate

#### Scenario: Outgoing protected remount stays signed out

- **WHEN** sign-out succeeds, `/login` navigation is held, the cleared account binding remounts the outgoing protected provider, and a newly started list or reset answers 401
- **THEN** the lifecycle remains inactive, that response cannot redirect to a next URL, and releasing navigation still reaches exactly `/login`
