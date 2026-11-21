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
