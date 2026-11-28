# Spec Delta

## Purpose

Let a user turn an empty map into a streamed skeleton from one topic, applied through the map reducer as a single undoable AI session.

## ADDED Requirements

### Requirement: Topic input appears only on an empty map

The editor SHALL show a topic input with a Generate action while the map is empty: the primary root has no children and the map has no floating roots. Generate SHALL be enabled only when the trimmed topic is 1–200 UTF-16 code units long and no generation is running. While a generation runs, the input SHALL be read-only and Generate SHALL NOT be offered. The form SHALL disappear as soon as the map is no longer empty. A Stop control, separate from the form, SHALL be visible for the whole generation, including after the first op. Manual editing of an empty map SHALL remain available while no generation runs.

#### Scenario: New map

- **WHEN** a user opens a newly created map
- **THEN** the topic input and Generate action are visible

#### Scenario: Non-empty map

- **WHEN** the primary root has a child or a floating root exists
- **THEN** no topic input is shown

#### Scenario: Invalid topic cannot be submitted

- **WHEN** the input is blank or its trimmed text exceeds 200 code units
- **THEN** Generate is disabled and no request is sent

#### Scenario: Double submit

- **WHEN** the user submits a topic and submits again before the first op arrives
- **THEN** exactly one request is sent

### Requirement: Nothing changes before the first op

Submitting SHALL change neither the tree nor the title until the first op arrives. When the first op arrives, the primary root's text SHALL become the trimmed topic. If the title is still `新导图`, the title SHALL become the trimmed topic as map metadata, not as an undo step. Then the op SHALL be applied, and every later op SHALL be dispatched through the map reducer as it arrives. A generation that ends before its first op, by error, Stop or a stream that completes without ops, SHALL leave the map, title and undo history unchanged.

#### Scenario: Progressive appearance

- **WHEN** the mock provider streams with a delay between ops
- **THEN** the 4 first-level nodes are visible on the canvas before the stream has ended

#### Scenario: Root text and title

- **WHEN** a user generates `学习 TypeScript` on a map titled `新导图`
- **THEN** the root text and the title both read `学习 TypeScript`

#### Scenario: Custom title kept

- **WHEN** the map was renamed to `我的计划` before generating
- **THEN** the title stays `我的计划` and only the root text changes

#### Scenario: Failure before the first op

- **WHEN** the server answers `invalid-output` before any op
- **THEN** the root text, title and undo history are unchanged and the notice reads `生成失败：AI 返回的内容无法使用，请重试`

### Requirement: A generation is one undo step

Everything a generation changes in the tree, including the root text, SHALL form one undo step. One undo SHALL restore the tree to its exact pre-generation state, and redo SHALL reapply it. This holds for a generation that completed, or that was stopped or interrupted after its first op.

#### Scenario: Undo completed generation

- **WHEN** a generation completes and the user presses Cmd/Ctrl+Z once
- **THEN** the map has only the primary root with its pre-generation text

#### Scenario: Undo partial generation

- **WHEN** a generation stopped after two ops and the user undoes once
- **THEN** the map returns to its pre-generation state

### Requirement: Tree editing is locked while generating

While a generation runs, the editor SHALL refuse every tree change other than the generation's own ops: creating, deleting, moving, recolouring, editing text or notes, undo and redo. Shortcuts, menus, drag and toolbar controls SHALL do nothing and raise no error. Panning, zooming and selection SHALL remain available.

#### Scenario: Shortcut ignored during generation

- **WHEN** the user presses Tab or Cmd/Ctrl+Z while a generation runs
- **THEN** the tree changes only by streamed ops and no console error is logged

#### Scenario: Pan during generation

- **WHEN** the user pans the canvas while a generation runs
- **THEN** the viewport moves and the generation continues

### Requirement: Failure notices use fixed texts

Generation failures SHALL show a notice built from this table:

| code             | text                              |
| ---------------- | --------------------------------- |
| `timeout`        | `生成超时，请重试`                |
| `provider-error` | `AI 服务出错，请稍后重试`         |
| `invalid-output` | `AI 返回的内容无法使用，请重试`   |
| `refused`        | `AI 拒绝了这个主题，请换一个主题` |
| `network`        | `网络连接失败，请检查网络后重试`  |

The prefix SHALL be `生成失败：` when no op was applied and `生成中断：` when ops were applied. When the server reports `ai-unavailable`, the form SHALL show `AI 未配置` for the rest of the editor visit (until the user leaves the editor). When the server reports `unauthenticated`, the editor SHALL show the session-expiry notice `登录已过期，请在新标签页重新登录后继续编辑` without navigating. In both of these cases the map SHALL be unchanged.

#### Scenario: AI unavailable

- **WHEN** the user submits a topic and the server answers 503 `ai-unavailable`
- **THEN** the editor shows `AI 未配置`, the map is unchanged and no undo entry exists

#### Scenario: Session expired at submit

- **WHEN** the user submits a topic and the server answers 401
- **THEN** the session-expiry notice appears, the page does not navigate and the map is unchanged

#### Scenario: Network failure

- **WHEN** the request fails before any response
- **THEN** the notice reads `生成失败：网络连接失败，请检查网络后重试`

### Requirement: Stop, interruption and leaving keep partial results

Stop SHALL abort the request and keep every op already applied, closing the generation as one undo step without a notice. A stream error or a stream ending without a terminal event, after ops were applied, SHALL keep them and show `生成中断：` with the code's text. Leaving the editor while generating, by unmount or pagehide, SHALL abort the request, close the generation like Stop, and save through the normal save path. After any of these, editing SHALL be unlocked.

#### Scenario: Stop

- **WHEN** the user presses Stop after the first op (4 first-level nodes) has been applied
- **THEN** the stream ends, the 4 nodes remain, editing is unlocked and no notice is shown

#### Scenario: Mid-stream error

- **WHEN** the server ends the stream with `provider-error` after two ops
- **THEN** the 7 nodes from those ops remain and the notice reads `生成中断：AI 服务出错，请稍后重试`

#### Scenario: Leaving saves partial result

- **WHEN** the user navigates to the library after the first op has been applied while a generation runs
- **THEN** the request is aborted and the map reopened later contains the nodes applied before leaving

### Requirement: A rejected streamed op reverts the whole generation

If the map reducer rejects a streamed op, the editor SHALL do all of the following:

- restore the tree to its pre-generation state with no undo entry;
- restore the title if the generation changed it;
- abort the request and unlock editing;
- show `生成失败：AI 返回的内容无法使用，请重试`.

#### Scenario: Reducer rejection

- **WHEN** a streamed op targets a node that does not exist in the map
- **THEN** the map and title return to their pre-generation state, undo has nothing new to undo, and the failure notice is shown

### Requirement: Generated content is saved by autosave

Autosave SHALL NOT save the map while a generation is running. When the generation ends, the map SHALL be saved through the existing autosave path.

#### Scenario: Saved after completion

- **WHEN** a generation completes and the user reloads after the save settles
- **THEN** the reloaded map contains the generated nodes
