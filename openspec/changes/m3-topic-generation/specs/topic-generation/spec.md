# Spec Delta

## Purpose

Let a user turn an empty map into a streamed skeleton from one topic, applied through the map reducer as a single undoable AI session.

## ADDED Requirements

### Requirement: Topic input appears only on an empty map

The editor SHALL show a topic input with a Generate action exactly when the map is empty: the primary root has no children and the map has no floating roots. The input SHALL disappear as soon as the map is no longer empty. When the server reports `ai-unavailable`, the editor SHALL show `AI 未配置` and SHALL NOT offer Generate again during that page session. Manual editing of an empty map SHALL remain available alongside the input.

#### Scenario: New map

- **WHEN** a user opens a newly created map
- **THEN** the topic input and Generate action are visible

#### Scenario: Non-empty map

- **WHEN** the primary root has a child or a floating root exists
- **THEN** no topic input is shown

#### Scenario: AI unavailable

- **WHEN** the user submits a topic and the server answers 503 `ai-unavailable`
- **THEN** the editor shows `AI 未配置`, the map is unchanged and no undo entry exists

### Requirement: Streamed nodes apply through the reducer as they arrive

Submitting a topic SHALL set the primary root's text to the topic. Each streamed op SHALL then be dispatched through the map reducer as it arrives, so nodes appear progressively. If the map title is still `新导图`, it SHALL become the topic as map metadata, not as an undo step.

#### Scenario: Progressive appearance

- **WHEN** the mock provider streams with a delay between ops
- **THEN** first-level nodes are visible on the canvas before the stream has ended

#### Scenario: Root text and title

- **WHEN** a user generates `学习 TypeScript` on a map titled `新导图`
- **THEN** the root text and the title both read `学习 TypeScript`

#### Scenario: Custom title kept

- **WHEN** the map was renamed to `我的计划` before generating
- **THEN** the title stays `我的计划` and only the root text changes

### Requirement: A generation is one undo step

Everything a generation changes in the tree, including the root text, SHALL form one undo step. One undo SHALL restore the tree to its exact pre-generation state, and redo SHALL reapply it. This holds for a completed, stopped or failed generation.

#### Scenario: Undo completed generation

- **WHEN** a generation completes and the user presses Cmd/Ctrl+Z once
- **THEN** the map has only the primary root with its pre-generation text

#### Scenario: Undo partial generation

- **WHEN** a generation stopped after two ops and the user undoes once
- **THEN** the map returns to its pre-generation state

### Requirement: Tree editing is locked while generating

While a generation runs, the editor SHALL refuse every tree change other than the generation's own ops: creating, deleting, moving, recolouring, editing text or notes, undo and redo. The controls that would invoke them SHALL be disabled. Panning, zooming and selection SHALL remain available. A Stop control SHALL be visible.

#### Scenario: Shortcut ignored during generation

- **WHEN** the user presses Tab or Cmd/Ctrl+Z while a generation runs
- **THEN** the tree does not change except by streamed ops

#### Scenario: Pan during generation

- **WHEN** the user pans the canvas while a generation runs
- **THEN** the viewport moves and the generation continues

### Requirement: Stop, failure and leaving keep partial results

Stop SHALL abort the request and keep every op already applied, closing the generation as one undo step without a notice. A stream error, a premature end or a failed request after the generation began SHALL keep applied ops and show the notice `生成中断：` followed by the error's fixed message. Leaving the editor while generating, by unmount or pagehide, SHALL abort the request, close the generation like Stop and save through the normal save path. After any of these, editing SHALL be unlocked.

#### Scenario: Stop

- **WHEN** the user presses Stop after two first-level nodes have appeared
- **THEN** the stream ends, the two nodes remain, editing is unlocked and no notice is shown

#### Scenario: Mid-stream error

- **WHEN** the server ends the stream with `provider-error` after two ops
- **THEN** the two nodes remain and the notice starts with `生成中断：`

#### Scenario: Leaving saves partial result

- **WHEN** the user navigates to the library while a generation runs
- **THEN** the request is aborted and the map reopened later contains the nodes applied before leaving

### Requirement: Generated content is saved by autosave

Autosave SHALL NOT save the map while a generation is running. When the generation ends, the map SHALL be saved through the existing autosave path.

#### Scenario: Saved after completion

- **WHEN** a generation completes and the user reloads after the save settles
- **THEN** the reloaded map contains the generated nodes
