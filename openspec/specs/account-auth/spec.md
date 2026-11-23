# account-auth Specification

## Purpose

People create an account with a username and password, sign in and out, and must be signed in to use MindSprout; the first account on a new installation becomes its single administrator.

## Requirements

### Requirement: Authentication forms retain early input

The sign-in and registration forms SHALL preserve usernames and passwords entered before the page becomes interactive. Hydration and editing either field SHALL NOT erase the other field. A hydrated submission SHALL send the current exact field values in the existing JSON request, without trimming or normalization. Native submission SHALL remain POST so credentials do not enter the URL.

#### Scenario: Username entered before hydration

- **WHEN** a visitor enters a username in the initial sign-in or registration form before hydration, then enters a password after hydration and submits
- **THEN** the username remains unchanged and the request contains that username and password
- **AND** valid credentials establish the matching session and the existing safe redirect applies

#### Scenario: Password entered before hydration

- **WHEN** a visitor enters a password before hydration, then edits the username after hydration and submits
- **THEN** the password remains unchanged and the request contains the exact values of both fields

#### Scenario: Submission fails after early input

- **WHEN** a hydrated submission is refused or fails on the network
- **THEN** the form retains its field values, shows the existing error, and permits another submission without changing the user's credentials

### Requirement: Open registration with a username and password

Anyone SHALL be able to register with a username and a password. A username SHALL be 1–64 characters and a password 1–256 characters, with no other format or strength rule. Usernames SHALL be stored and compared exactly as entered: no trimming, case folding or normalisation. A taken username SHALL be refused. A successful registration SHALL sign the new user in. Only a password hash SHALL ever be stored; the password SHALL never be stored, logged or returned.

#### Scenario: Register and land signed in

- **WHEN** a visitor registers as `alice` with password `pw` on `/register`
- **THEN** they are taken to `/` signed in as `alice`, and the header shows `alice`

#### Scenario: Taken username

- **WHEN** `alice` exists and a visitor registers as `alice`
- **THEN** registration is refused with "用户名已被占用" and no account is created

#### Scenario: Usernames are exact

- **WHEN** `alice` exists and a visitor registers as `Alice`
- **THEN** a separate account `Alice` is created

#### Scenario: Out-of-bounds input

- **WHEN** a registration has an empty username, a 65-character username, an empty password or a 257-character password
- **THEN** it is refused as invalid input and no account is created

#### Scenario: Password is never stored in plaintext

- **WHEN** an account is registered with password `pw`
- **THEN** the stored credential is a salted hash that does not contain `pw`, and verifying `pw` against it succeeds while verifying `px` fails

### Requirement: First account becomes the single admin

On a database with no users, the first account to complete registration SHALL become the administrator. Every later account SHALL be a regular user. There SHALL never be more than one administrator, even when registrations race.

#### Scenario: First registrant is admin

- **WHEN** the first account on an empty database registers, followed by a second account
- **THEN** the first is the administrator and the second is not

#### Scenario: Racing first registrations

- **WHEN** two registrations run concurrently against an empty database
- **THEN** both accounts exist and exactly one of them is the administrator

### Requirement: Sign in and sign out

A user SHALL sign in with their exact username and password. Any wrong username or password SHALL get the same refusal "用户名或密码错误", whichever part was wrong. A successful sign-in SHALL create a server-side session valid for 30 days from creation, referenced by an HttpOnly authentication cookie. It SHALL also set a non-HttpOnly `mindsprout_session_binding` cookie containing the base64url UTF-8 encoding of the exact username with the same lifetime, path, SameSite and production-Secure scope; this binding is not an authentication credential. Registration SHALL establish the same pair. Sign-out SHALL end that session and clear both cookies, and SHALL succeed even when there is no session.

#### Scenario: Sign in

- **WHEN** `alice` signs in with her password on `/login`
- **THEN** she is taken to `/` and her maps are listed

#### Scenario: Wrong password or unknown user

- **WHEN** someone signs in as `alice` with a wrong password, or as a username that does not exist
- **THEN** both attempts show "用户名或密码错误" and neither creates a session

#### Scenario: Sign out

- **WHEN** a signed-in user chooses 退出登录
- **THEN** they are taken to `/login`, and a request carrying the old cookie is treated as signed out

#### Scenario: Session expires after 30 days

- **WHEN** a session was created more than 30 days ago
- **THEN** requests carrying its cookie are treated as signed out

#### Scenario: Session cookie attributes

- **WHEN** a sign-in or registration succeeds
- **THEN** the authentication cookie is HttpOnly and the binding cookie is not HttpOnly; both are Path=/ and SameSite=Lax with matching 30-day lifetime, and both are Secure in production
- **WHEN** sign-out succeeds
- **THEN** both cookies are cleared with Max-Age=0 and their original scope

### Requirement: Deferred map operations remain bound to the invoking account

The first-party HTTP map repository SHALL capture the current Session binding and send it as `x-mindsprout-session-binding` on every map request. If the binding cookie is absent or empty, the default provider SHALL use an empty but present header value so the server rejects the operation instead of silently entering direct-API compatibility. The server SHALL compare a present binding with the authenticated exact username and SHALL answer 401 `unauthenticated` before map access when it differs. A missing binding header retains the existing direct-API behavior only for explicit unbound clients. The browser provider SHALL key its cached repository by the current binding so a different account receives a new adapter on the next open. Reauthenticating the same account SHALL retain the binding and pending-edit recovery; changing accounts SHALL NOT allow an older queued operation to write under the new account.

#### Scenario: Same-document account switch rejects a queued save

- **WHEN** Alice has a queued map PUT behind an unsettled request, signs out, signs in as Bob in the same document, and the predecessor then settles
- **THEN** Alice's queued PUT is rejected by the binding comparison, nothing from Alice enters Bob's store, and Bob's own adapter can save and read maps

#### Scenario: New-tab account switch rejects the original tab's queued save

- **WHEN** Alice has a queued map PUT in an original editor tab, Bob signs in through another tab sharing the browser cookie jar, and the predecessor then settles
- **THEN** the original tab's queued PUT is rejected by the binding comparison and nothing from Alice enters Bob's store

#### Scenario: Credential-only legacy session fails closed before recovery

- **WHEN** Alice has a valid authentication session but no binding cookie and the default provider attempts a map operation
- **THEN** the request carries an empty but present binding header, receives 401 before map access, and same-account reauthentication establishes the binding before normal editing resumes

#### Scenario: Same-account re-login preserves pending recovery

- **WHEN** Alice signs in again and receives a new authentication session for the same exact username
- **THEN** the Session binding remains equal and her pending map operations retain the existing recovery behavior

### Requirement: Sign-in is required except on public surfaces

Every page and API route SHALL require a signed-in session, except `/login`, `/register`, `/api/auth/*` and `/api/healthz`. A signed-out visit to a page SHALL redirect to `/login?next=<the requested path and query>`. After signing in or registering from that page, the user SHALL land on the `next` path. A `next` value that is not a same-site path SHALL be ignored in favour of `/`. API routes SHALL answer a missing or invalid session with 401 and never redirect. Every API route SHALL verify the session itself; the redirect is a convenience, not the protection.

#### Scenario: Signed-out visit returns after sign-in

- **WHEN** a signed-out visitor opens `/maps/abc` and then signs in
- **THEN** they are first redirected to `/login?next=%2Fmaps%2Fabc` and land on `/maps/abc` after signing in

#### Scenario: Foreign redirect target is ignored

- **WHEN** a visitor signs in from `/login?next=//evil.example/x` or `/login?next=https://evil.example`
- **THEN** they land on `/`

#### Scenario: Public surfaces need no session

- **WHEN** a signed-out client requests `/login`, `/register` or `GET /api/healthz`
- **THEN** each is served without a redirect or a 401

#### Scenario: API without a session

- **WHEN** a request without a valid session calls any map or admin API route, including one that carries a stale or forged cookie
- **THEN** it receives 401 and no data

### Requirement: Mutating API requests are JSON

Every non-GET API route SHALL accept only `Content-Type: application/json` and SHALL refuse any other content type with 415, before any side effect.

#### Scenario: Cross-site form post

- **WHEN** a `POST /api/auth/logout` or `PUT /api/maps/{id}` arrives with a form-encoded body
- **THEN** it is refused with 415 and nothing changes

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

### Requirement: Public authentication forms link to each other

The sign-in form SHALL expose a link named 注册 to `/register`, and the registration form SHALL expose a link named 登录 to `/login`. When the current form has a valid same-site `next`, the link SHALL carry that path and query in its encoded `next` query parameter. Without `next`, the link SHALL omit that parameter. A foreign or unsafe `next` SHALL be replaced by `/` before link construction, so no foreign target appears in the link URL. Following either link SHALL NOT submit credentials or create a session.

#### Scenario: Sign-in page links to registration with a return path

- **WHEN** a signed-out visitor opens `/login?next=%2Fmaps%2Fabc`
- **THEN** the 注册 link has `href="/register?next=%2Fmaps%2Fabc"`

#### Scenario: Registration page links back to sign-in

- **WHEN** a visitor opens `/register?next=%2Fmaps%2Fabc`
- **THEN** the 登录 link has `href="/login?next=%2Fmaps%2Fabc"`

#### Scenario: Missing or unsafe return path

- **WHEN** `/login` has no `next`, or its `next` is `//evil.example`, `https://evil.example`, or `/\evil`
- **THEN** the 注册 link respectively has `href="/register"` or `href="/register?next=%2F"`, and the foreign value is absent

#### Scenario: Registration entered from sign-in returns to the requested page

- **WHEN** a signed-out visitor requests `/maps/abc`, follows 注册 on the resulting sign-in page, and completes registration
- **THEN** registration establishes the session and lands on `/maps/abc`

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

#### Scenario: A competing protected route interrupts sign-out navigation

- **WHEN** sign-out succeeds and a different protected pathname commits before `/login` is reached
- **THEN** the lifecycle remains inactive and navigation is reissued to exactly `/login`, without `next`

### Requirement: Public form evidence does not mutate input state

When browser evidence captures the public sign-in or registration form during navigation, the capture SHALL preserve the current input caret state and the existing form-switch behavior. Evidence collection SHALL NOT require suppressing hydration errors or weakening unexpected console-error assertions.

#### Scenario: Form-switch screenshots preserve input state

- **WHEN** the browser switches between sign-in and registration using the existing `next` links and captures each public form before entering credentials
- **THEN** both screenshots are retained without a screenshot-induced caret-style change, the forms still accept the entered credentials, no login/registration request or session is created, and unexpected console errors remain absent
