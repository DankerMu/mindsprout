# Spec Delta

## ADDED Requirements

### Requirement: Admin page links back to the library

While `/admin` is loading the account list, showing it, reporting that it cannot be read, or refusing a non-administrator with "无权访问", the page SHALL show exactly one visible, keyboard-focusable link named 返回导图列表 targeting `/`. Following it SHALL reach the signed-in user's library without requiring browser history. The refusal state SHALL still show no account data. An expired session keeps redirecting to `/login`.

#### Scenario: Administrator returns to the library from a direct /admin visit

- **WHEN** the administrator opens `/admin` directly and keyboard-activates 返回导图列表
- **THEN** they reach `/` and their library lists their own maps

#### Scenario: Refused and failed states offer the same single exit

- **WHEN** a non-administrator opens `/admin`, or the administrator opens `/admin` while the account list cannot be read
- **THEN** the page shows "无权访问" or "无法读取用户列表" respectively, no account data, and exactly one link to `/` named 返回导图列表

#### Scenario: Loading state already offers the exit

- **WHEN** the administrator opens `/admin` and the account list has not arrived yet
- **THEN** "正在读取用户列表" and exactly one link to `/` named 返回导图列表 are shown
