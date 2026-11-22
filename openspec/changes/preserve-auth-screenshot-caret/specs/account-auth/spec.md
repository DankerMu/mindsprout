# Spec Delta

## ADDED Requirements

### Requirement: Public form evidence does not mutate input state

When browser evidence captures the public sign-in or registration form during navigation, the capture SHALL preserve the current input caret state and the existing form-switch behavior. Evidence collection SHALL NOT require suppressing hydration errors or weakening unexpected console-error assertions.

#### Scenario: Form-switch screenshots preserve input state

- **WHEN** the browser switches between sign-in and registration using the existing `next` links and captures each public form before entering credentials
- **THEN** both screenshots are retained without a screenshot-induced caret-style change, the forms still accept the entered credentials, no login/registration request or session is created, and unexpected console errors remain absent
