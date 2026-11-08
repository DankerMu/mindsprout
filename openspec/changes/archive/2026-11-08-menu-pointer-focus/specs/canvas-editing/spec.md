# Spec Delta

## ADDED Requirements

### Requirement: Context menu pointer focus

Pointer presses on disabled items or non-button padding in an open node context menu SHALL preserve usable keyboard focus inside the menu. Arrow navigation and Escape dismissal SHALL remain available without refocusing or reloading. Such presses SHALL NOT change the map, selection or undo history. Enabled menu actions SHALL still activate exactly once and close the menu; title inputs outside the menu SHALL retain their native focus and context-menu behavior.

#### Scenario: Press the disabled primary-root Delete item

- **WHEN** the primary-root menu is open and the user presses the center of disabled 删除 with the mouse
- **THEN** focus remains usable inside the menu, ArrowDown navigates to an enabled item, and Escape closes the menu and restores canvas focus without changing the map or history

#### Scenario: Press menu padding

- **WHEN** the primary-root menu is open and the user presses its non-button padding with the mouse
- **THEN** focus remains usable inside the menu, ArrowDown navigates and Escape closes it without changing selection, map or history

#### Scenario: Activate an enabled menu action

- **WHEN** the user clicks an enabled mutating menu action
- **THEN** exactly one intended map change occurs, the menu closes, and one undo restores the prior map

#### Scenario: Right-click an inline title input

- **WHEN** the user right-clicks a focused inline title input containing a draft
- **THEN** the native contextmenu event is not cancelled, the input retains focus and draft, and no custom node menu opens
