# Design

## Context

MapLibrary 已用 MutationSession 捕获 lifetime、ID、标题与 trigger；RenameForm/DeleteConfirmation 只是位于列表前。AdminUserList 的按钮和 window.confirm 已捕获正确 ID，但没有目标用户名。二者保留现有状态与请求边界。

## Goals / Non-Goals

**Goals:** 目标行内呈现；同名行不歧义；管理员按钮和确认点名账号；现有状态机兼容。
**Non-Goals:** 不新增权限或 API，不改变时间/样式/排序，不强制唯一标题，不引入设计系统或撤销。

## Decisions

- 将现有 mutation components 作为 LibraryRows 的行内容传入，以 activeSession.id 选择所属行，而不是按标题匹配。只有匹配的 `<li>` 挂载对应组件；同一时刻仍只有一个 session。
- 保留 MutationSession 的捕获 ID/lifetime/trigger 和原有 save/delete handlers，避免把 DOM 行身份变成持久化身份来源。
- AdminUserList 从当前 account row 同时传 ID 和 username；可访问名为 `重置密码 <username>`，确认以 `确定重置 <username> 的密码吗？` 起句并逐字接原失效文案。不在文案或日志输出密码。
- 不将 `<dialog open>` 改成新 modal 机制；行内现有 dialog 的 Escape、取消和失败行为直接复用。

## Risks / Trade-offs

- 行移动后 trigger 引用仍指向原按钮；沿用现有 after-save/delete focus policy，不新增自动选择焦点。
- 同名按钮仍可有相同可访问名称；真实验收以具体 row 定位，并同时断言 peer 记录未改变。

Change surface: MapLibrary.tsx, AdminUserList.tsx 及其组件测试，map-library/account-admin e2e，两个 spec deltas，patch changeset。
Must preserve: 捕获 ID、删除确认逐字 `确定永久删除“<title>”吗？`（使用捕获标题）、按 updatedAt 排序、根文本独立、取消零写入、失败重试、pending 串行化、重置后会话全部失效与临时密码一次显示。
Must add/change: 行内操作呈现和账号点名文案，无状态/存储/API 格式变化。
Governing invariant: 可见操作目标、所选 DOM 行和实际写入的捕获 ID 始终指同一记录，同名 peer 永不成为替代目标。
Sibling surfaces: rename/delete/get guards、failure/retry/cancel/focus、reset confirmation/lock/secret dialog。
Seams under test: 组件 DOM + repository/fetch mock；真实浏览器的行级操作及持久化记录。
Required evidence: 两行同名的第二行 rename/delete 只改变其 ID；取消零请求；管理员取消点名确认零请求；成功仍走原 reset API；截图与零 console error。
Review focus: 行选择不用标题作身份；无跨行重复控件；旧并发/焦点/失败语义；原规格整句保留；时间样式子项不夹带。
