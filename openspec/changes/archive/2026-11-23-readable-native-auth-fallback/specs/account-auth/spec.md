# account-auth Specification Delta

## MODIFIED Requirements

### Requirement: Sign-in is required except on public surfaces

Every page and API route SHALL require a signed-in session, except `/login`, `/register`, `/native-auth/*`, `/api/auth/*` and `/api/healthz`. The `/native-auth/` namespace SHALL expose only the documented non-mutating redirect or 404; invalid modes and child paths SHALL return 404, while near misses outside that namespace SHALL remain protected. A signed-out visit to a page SHALL redirect to `/login?next=<the requested path and query>`. After signing in or registering from that page, the user SHALL land on the `next` path. A `next` value that is not a same-site path SHALL be ignored in favour of `/`. API routes SHALL answer a missing or invalid session with 401 and never redirect. Every API route SHALL verify the session itself; the redirect is a convenience, not the protection.

#### Scenario: Signed-out visit returns after sign-in

- **WHEN** a signed-out visitor opens `/maps/abc` and then signs in
- **THEN** they are first redirected to `/login?next=%2Fmaps%2Fabc` and land on `/maps/abc` after signing in

#### Scenario: Foreign redirect target is ignored

- **WHEN** a visitor signs in from `/login?next=//evil.example/x` or `/login?next=https://evil.example`
- **THEN** they land on `/`

#### Scenario: Public surfaces need no session

- **WHEN** a signed-out client requests `/login`, `/register` or `GET /api/healthz`
- **THEN** each is served without a redirect or a 401

#### Scenario: Native fallback namespace fails closed without protected content

- **WHEN** a signed-out client posts to `/native-auth/other` or requests `/native-auth/login/child`
- **THEN** the response is 404 without account/session side effects
- **AND** a request to `/native-auth-extra` still receives the ordinary protected-page login redirect

#### Scenario: API without a session

- **WHEN** a request without a valid session calls any map or admin API route, including one that carries a stale or forged cookie
- **THEN** it receives 401 and no data

## ADDED Requirements

### Requirement: Native pre-hydration submission fails readably without authentication

Before hydration, the sign-in and registration forms SHALL submit with POST to the public non-API endpoint `/native-auth/{login|register}` so usernames and passwords do not enter request or final-page URLs. That endpoint SHALL NOT read the credential request body or create an account/session, and SHALL return 303 to the corresponding form with a readable Chinese retry notice and a link back to the form. It SHALL preserve only a sanitized same-site `next`, SHALL use a relative same-origin redirect target, and SHALL reject any other mode with 404. Direct form-encoded POSTs to `/api/auth/login` and `/api/auth/register` SHALL continue to return 415 before account/session side effects. Native authentication success remains unsupported; hydrated JSON authentication and safe-next behavior SHALL remain unchanged.

#### Scenario: Native submission returns to a readable form

- **WHEN** a visitor submits either login or registration by button or Enter with JavaScript disabled or hydration scripts blocked
- **THEN** the navigation request is a credential-free POST to `/native-auth/{login|register}`, followed by 303 to the corresponding readable Chinese form with a retry notice and return link
- **AND** neither username nor password appears in any request URL or final-page URL, and `/api/auth/session` remains 401

#### Scenario: JSON-only auth APIs are unchanged by the native fallback

- **WHEN** a form-encoded body is posted directly to `/api/auth/login` or `/api/auth/register`
- **THEN** the response remains 415 with `unsupported-media-type`, no account or session is created, and the native non-API endpoint does not read that body

#### Scenario: Native fallback preserves a safe return path

- **WHEN** the native action carries a same-site `next`, or an external/unsafe `next`
- **THEN** the 303 Location preserves the sanitized same-site path and query for the subsequent hydrated submission, replaces an unsafe value with `/`, and never names an external origin
