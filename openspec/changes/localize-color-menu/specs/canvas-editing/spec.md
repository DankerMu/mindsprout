# Spec Delta

## MODIFIED Requirements

### Requirement: Context menu

Right-click on a node SHALL open a menu with: 添加子节点, 添加兄弟节点, 重命名, 删除, 折叠/展开, 设置颜色 (six tokens plus 无颜色), 编辑备注, 脱离为浮动节点. 添加兄弟节点 and 脱离为浮动节点 SHALL be disabled on every root (primary or floating); 删除 SHALL be disabled on the primary root only. The menu SHALL be built from a registry so later features can add items. The six color choices SHALL display 红 / 橙 / 黄 / 绿 / 蓝 / 紫 as their accessible names and include an `aria-hidden` swatch matching the corresponding node color in light and dark themes; English tokens remain internal values.

#### Scenario: Menu on the primary root

- **WHEN** the user right-clicks the primary root
- **THEN** the menu shows all eight items with 添加兄弟节点, 删除 and 脱离为浮动节点 disabled

#### Scenario: Menu on a floating root

- **WHEN** the user right-clicks floating root F
- **THEN** 添加兄弟节点 and 脱离为浮动节点 are disabled, 删除 is enabled, and choosing 删除 removes F with its subtree

#### Scenario: Set color from the menu

- **WHEN** the user picks 蓝 under 设置颜色 for node N
- **THEN** N renders with the `blue` token and one undo step was added

#### Scenario: Localized swatches match node colors

- **WHEN** the color submenu is opened in light or dark mode
- **THEN** every color choice has its Chinese accessible name and an `aria-hidden` swatch whose computed background matches the corresponding node token in that theme

#### Scenario: Clear a color from the menu

- **WHEN** node N carries `blue` and the user picks 无颜色 under 设置颜色
- **THEN** N renders without a color token, one undo step was added, and undo restores `blue`

### Requirement: Color tokens

A node's color SHALL be one of six tokens (red, orange, yellow, green, blue, purple) or unset; the token SHALL map to theme colors in light and dark mode; clearing SHALL dispatch `update_node { color: null }`. Setting or clearing a color on a multi-selection SHALL apply to every selected node as one undo step. Menu localization SHALL NOT change the token dispatched or persisted.

#### Scenario: Group color

- **WHEN** three nodes are selected and the user sets 绿
- **THEN** all three carry the `green` token and one undo removes it from all three (restoring any previous token)
