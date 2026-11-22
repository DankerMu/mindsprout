# Spec Delta

## ADDED Requirements

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
