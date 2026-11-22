# Spec Delta

## ADDED Requirements

### Requirement: Password reset identifies the account

Every password-reset control in the administrator user list SHALL have an accessible name containing its account username. Its confirmation SHALL name that account and SHALL contain the exact sentence 重置后该用户的所有登录将失效. Confirmation SHALL reset only the selected account; cancellation SHALL issue no reset request.

#### Scenario: Administrator identifies the reset account

- **WHEN** the administrator chooses 重置密码 alice from alice's row
- **THEN** the confirmation names alice and contains 重置后该用户的所有登录将失效, and accepting it requests a reset only for alice's account ID

#### Scenario: Named reset is cancelled

- **WHEN** the administrator cancels the confirmation naming alice
- **THEN** no reset request is sent and alice's password and sessions remain unchanged
