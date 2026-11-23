# Tasks

## 1. Launch-matched ownership and scheduling

- [x] 1.1 新增 graceful launch 保存性回归：真实 `launchServer` 超过原 10 秒 deadline 后释放，观察真实 late launch/ready；断言原 `launching` rejection 不变、无提前 signal、graceful child/browser cleanup 与无残留进程。引用自然 CI red，不伪造本地 pre-change red。
- [x] 1.2 先添加 forced-child-termination 红测：late real browser 在旧 reaper 中因 authoritative PID 为 null 而残留，测试自带 guaranteed cleanup 防止红测泄漏。再在现有 fixture 添加 cleanup-only verified ownership，要求 forced fallback 红→绿，且 observed schema、原 rejection/phase 与 signal refusal 不变。
- [x] 1.3 在 `native:browser:test` 加单文件 concurrency，保持全部文件/断言/deadline，更新 native guide。运行完整 serial native suite（目标 267/267）并记录与并行 265/265、约 23.5 秒相比的明确调度成本。

## 2. Qualification and falsification

- [x] 2.1 运行 format/lint/typecheck、strict OpenSpec、docs/decisions；审查 launch hook 所有失败路径均 release/reap、无 secret/raw output、无测试遗漏。自然 launching、保存性回归、forced ownership 红绿与串行实验不得表述为已证明 OS 根因。
- [x] 2.2 最终 head 至少连续两次完整 GitHub Darwin native qualification 通过，Linux 与 required checks 同步通过，才接受 contention mitigation 并关闭 #258。若再出现 launching timeout，则移除串行 flag、记录假设被证伪、保留回归与证据且保持 issue open；不得用单次 lucky rerun 或提高 deadline 通过。

最终 head `1ed67740fe06fdc7972fe9344120143759abaf84` 的 CI run `45185909462` attempts 1、2 连续两次完整全绿；Darwin/Linux/E2E 均通过，PR #269 已合并，#258 按该资格边界关闭。早期五轮和 #270 冷 root/public-create 证据保留，不作全延迟根因修复声明。
