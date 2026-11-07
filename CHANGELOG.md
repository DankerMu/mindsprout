# mindsprout

## 0.2.0

### Minor Changes

- 46ba57c: Delete selected canvas subtrees with Delete or Backspace as one undo step. The primary root stays protected while selected descendants and floating roots remain deletable; selecting the primary root shows “主根不能删除”. Undo restores complete subtrees, their order and floating positions. Text editing, composition and modified keys retain their native behavior.
- 74fe7fb: Select canvas nodes with click, Shift+click, or an enclosing drag rectangle. Use Ctrl/Cmd+A to select visible nodes, Escape to clear selection, and arrow keys to navigate from the last-clicked primary node. Text focus and composition keep their native shortcuts; panning preserves selection. Selection is session-only and does not save or alter the map.
  
  Space panning preserves selection even when focus is outside the canvas and resets on window blur. Drag rectangles accept only the primary left mouse pointer; touch gestures remain available for panning.
- 1106400: Undo and redo map edits with Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z or the canvas buttons 撤销 and 重做. Button availability follows session history, which is cleared on reload without losing saved map content.
  
  Text editing and IME keep native keyboard behavior. A toolbar pointer gesture that starts while naming a node only finishes that editor; it does not also consume map history. Cancelling an unnamed creation preserves earlier edits and redo entries, and the next idle activation works normally.
- b76d32b: Drag selected top-most subtrees together, preserving their relative positions when detaching to the canvas and appending them in visual order when attaching to a node. Each accepted drop is one undo step. Primary-root, self and descendant refusals reset the entire group without changing history or saving the map. Native cancellation stops all previews and edge autopan; a fresh gesture remains available after map, layout or editing changes.
- d077e3f: Rename existing nodes by double-clicking or pressing F2 on the canvas. F2 edits only the last-clicked primary node and preserves a multi-selection. Enter saves, Escape discards, and leaving the input saves without moving focus away from its destination.
  
  Titles accept any length, including 200 characters, and nonempty text is saved verbatim. Blank or unchanged titles leave the existing title and history untouched. Input composition and native text shortcuts do not trigger canvas actions; IME confirmation marked by keyCode 229 keeps the title draft open even after composition ends. Hidden or deleted edit targets discard their drafts. Committed renames use the existing undo history and browser autosave.
- f1ccd22: Create nodes from a single canvas selection: Tab adds the last child; Enter inserts the next sibling, or a child on a primary or floating root. The new node is selected and its title input receives focus once visible. Collapsed parents expand for naming.
  
  Naming and creation form one history entry. Empty or whitespace-only titles and Escape discard the creation, restore the prior selection and re-collapse its parent. Provisional nodes are not saved; named nodes use browser autosave. Modified or repeated keys, text entry and IME confirmation do not create nodes. Undo buttons and keyboard shortcuts are not introduced by this change.
- 5e3fdcc: Open a stored map at `/maps/<id>`: the editor shows the map title and the canvas, and saves pending edits when the page is hidden or left. An unknown id shows "找不到这张导图", a map from a newer version shows "此导图由更新版本创建", and an unreadable map shows "无法打开这张导图", each with a link back to the library. Opening a map never changes it.
- 3329da6: Browse saved maps on `/` with titles and last-updated times, newest first, and open a map from its list entry. An empty library offers 新建导图, which saves a map titled 新导图 with one root of the same name before opening its editor. Creation accepts only one pending attempt; a failed save keeps the library visible and permits an explicit retry. Loading and read failures have distinct states rather than appearing as an empty library.
  
  Leaving the library or switching its repository suppresses late create navigation and error UI without cancelling the save; a committed map remains available on the next visit.
- db4d0ef: Right-click a node to add a child or sibling, rename, delete, collapse or expand, or detach its subtree in place. Delete uses the selected set when the target is selected; other actions use only the target. Root restrictions protect the primary root, and undo restores each completed action. Menus support keyboard navigation and preserve selection when dismissed. Color and note actions are not included.
- 84f0593: Keep editing when browser storage cannot open by sharing one in-memory repository across library creation and editor navigation. The editor shows a persistent 未保存到浏览器 banner; fallback maps last only until the document is reloaded. Unavailable reads show the banner and an error rather than pretending the map does not exist.
  
  Show the current editor notice, including 保存失败 after a failed write, with explicit dismissal. Failed saves retain edited text; generic write failures do not switch repositories. Notices have no automatic dismissal timer, so a replacement message is not cleared by an older notice.
- a6b5de3: Drag one node onto another to append its subtree, or onto empty canvas to detach or reposition a floating subtree. Placement preserves the pointer's grab offset, and one undo restores the original tree and position. Self, descendant and primary-root drops snap back without saving or adding history. Editing, pan gestures and multiple selections do not move nodes; group drag is not supported.

### Patch Changes

- fae3473: Show the persistent 未保存到浏览器 banner in the map library when browser storage cannot open. Session maps remain available through library creation and editor navigation, including named child nodes; reloading an editor URL clears the session and shows not-found with the banner.
