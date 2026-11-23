# account-auth Specification Delta

## MODIFIED Requirements

### Requirement: Public form evidence does not mutate input state

When browser evidence captures the public sign-in or registration form during navigation or standalone route smoke, the capture SHALL preserve the current input caret state and the existing form-switch behavior. It SHALL NOT inject `caret-color: transparent` during SSR-to-hydration overlap and SHALL NOT require suppressing hydration errors or weakening unexpected console-error assertions.

#### Scenario: Form-switch screenshots preserve input state

- **WHEN** the browser switches between sign-in and registration using the existing `next` links and captures each public form before entering credentials
- **THEN** both screenshots are retained without a screenshot-induced caret-style change, the forms still accept the entered credentials, no login/registration request or session is created, and unexpected console errors remain absent

#### Scenario: Standalone login smoke preserves caret during hydration

- **WHEN** the `/login` SSR form is visible while React Scheduler wakeups are deliberately held after load and the standalone smoke captures its screenshot
- **THEN** neither credential input receives `caret-color: transparent`, the screenshot is retained, and unexpected console/page errors remain absent after hydration is released
- **AND** production form behavior and all other route screenshot contracts remain unchanged
