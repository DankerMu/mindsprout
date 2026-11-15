# development-navigation Specification (delta)

## ADDED Requirements

### Requirement: Browser tests declare expected HTTP errors

A browser test SHALL declare each expected non-2xx response by URL pattern and status. The shared collector SHALL suppress a `Failed to load resource` console error only when the message's URL and status match an actual observed response satisfying a declaration. It SHALL retain all other errors, warnings and page errors, report declarations never observed, and leave undeclared specs' console behavior unchanged.

#### Scenario: Matched declaration versus mismatched or unused declaration

- **WHEN** a signed-out page receives `/api/auth/session` with status 401
- **THEN** a declaration for that URL with status 401 suppresses only its corresponding resource-load error, while an undeclared response or a status-404 declaration remains reported and the unused declaration is also reported

#### Scenario: Unrelated browser error beside a declared response

- **WHEN** a page emits a `console.error` next to an observed response that satisfies its declaration
- **THEN** the collector retains the page's unrelated error
