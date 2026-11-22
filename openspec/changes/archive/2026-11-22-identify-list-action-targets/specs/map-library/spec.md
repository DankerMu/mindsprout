# Spec Delta

## ADDED Requirements

### Requirement: List mutations identify their row target

The library SHALL present a rename form or delete confirmation within the map row that initiated it, including when multiple rows have identical titles. Confirmation SHALL continue to operate on the initiating row's captured map ID and SHALL preserve the existing cancellation, focus, failure and serialization behavior. The delete confirmation SHALL continue to ask exactly 确定永久删除“<title>”吗？ using the captured target title.

#### Scenario: Same-title rows retain distinct operation targets

- **WHEN** two listed maps are both titled 新导图 and the user starts rename or delete on the second row
- **THEN** the corresponding form or confirmation appears only within that second row and its confirmation writes or deletes only that row's map ID, leaving the peer map unchanged

#### Scenario: Inline cancellation remains non-destructive

- **WHEN** a user cancels an inline rename or delete confirmation or presses Escape before confirmation
- **THEN** no map write or delete occurs, the form or confirmation closes, and the existing trigger-focus behavior is preserved
