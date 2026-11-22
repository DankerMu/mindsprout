# Spec Delta

## MODIFIED Requirements

### Requirement: Authentication forms retain early input

The sign-in and registration forms SHALL preserve usernames and passwords entered before the page becomes interactive. Hydration and editing either field SHALL NOT erase the other field. A hydrated submission SHALL send the current exact field values in the existing JSON request, without trimming or normalization. Native submission SHALL remain POST to the mode-specific public non-API endpoint `/login/native` or `/register/native` so credentials do not enter the URL. That handler SHALL NOT read the credentials body, issue a session or create an account; it SHALL redirect with 303 to the same readable form with a safe next path and a failure marker. The returned form SHALL display "页面尚未加载完成，请重试" and retain the form as the return entry. Direct form-encoded POST to `/api/auth/login` or `/api/auth/register` SHALL continue to receive 415 before any side effect, rather than a successful authentication or a redirect.

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

#### Scenario: Native submission returns to a readable form

- **WHEN** a visitor submits either login or registration by button or Enter before hydration, including with JavaScript disabled or hydration scripts blocked
- **THEN** the credentials remain out of every request and final URL, the public form POST is redirected with 303 to the same readable form, and that form displays "页面尚未加载完成，请重试" without establishing a session or creating an account

#### Scenario: Native fallback does not trust next or read credentials

- **WHEN** a public form POST includes credentials in its body and a foreign or control-character next query
- **THEN** the handler leaves its body unread, issues no session cookie or account write, and redirects with 303 only to the safe local form target rather than the supplied foreign target

#### Scenario: Form-encoded API authentication remains refused

- **WHEN** a client directly POSTs form-encoded credentials to `/api/auth/login` or `/api/auth/register`
- **THEN** the API answers 415 with the existing unsupported-media-type error, without creating a session or account
