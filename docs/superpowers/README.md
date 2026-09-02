# Atom Superpowers 恢复入口

本页只负责导航，不复制产品需求、任务状态或完成结论。日常 Session 消息持续翻译进对应规格、计划与 Git 证据；聊天正文与自动压缩摘要均不是存储或恢复依据。

## 新 Session 读取顺序

1. 运行`atom.cmd --help`，取得当前 Atom 入口与合同。
2. 读取当前功能规格与实施计划的“恢复断点”。
3. 检查`git status --short`、`git log -5 --oneline --decorate`和计划绑定的 revision。
4. 重新运行计划首个未完成任务要求的最小验证，不从聊天摘要猜状态。
5. 从首个未取得当前证据的步骤继续；发现规格、计划、代码或真实 Graph 冲突时停止并先校正事实。

## 当前开发链

- **当前恢复断点**：[`plans/2026-09-03-session-recovery-checkpoint.md`](plans/2026-09-03-session-recovery-checkpoint.md)；ChatGPT软件更新或 Session历史丢失后，先从该文件恢复，不依赖聊天记录或自动压缩摘要。
- **当前最高优先级**：[`specs/2026-09-03-atom-slot-signal-design.md`](specs/2026-09-03-atom-slot-signal-design.md)；沿现有 Slot直接父子层级以`slot({"to":"up|down","labels":[...]})`传导瞬时信号，由接收节点自己的`trigger("slot",...)`与`signal()`处理。Slot完成后修复已复现的4784命令队列失活；Strut context的旧值/新值缺口另行设计。

- **首要 Graph 纠偏**：Strut 判定 Program 必须内嵌在 clause `if`，取得复合前项事实与本次规范化 Transform `$` 动作信封；`$click`只是注册动作族的首个用例，CLI/Web 点击统一为 `transform {"thing$click":"EXACT路径"}`，新增动作不得修改 Strut/runtime 主干。旧外部 `thing@program` 判定与独立 click endpoint/trigger 方案均已退役。权威合同见[`specs/2026-08-31-atom-world-program-design.md`](specs/2026-08-31-atom-world-program-design.md) §3.2、§4.1；当前实施账本见[`plans/2026-09-02-inline-strut-transform-actions.md`](plans/2026-09-02-inline-strut-transform-actions.md)。

- **首要热修**：[`plans/2026-09-02-atom-startup-hot-state.md`](plans/2026-09-02-atom-startup-hot-state.md)；恢复 OpenSpec 迁移时被弱化的启动全局热态合同，当前真实 4784 的 health 为 7—13 秒、局部 state 约 14 秒，修复前不得以 `ok:true` 代替 ready。
- **当前规格**：[`specs/2026-08-31-atom-web-spatial-design.md`](specs/2026-08-31-atom-web-spatial-design.md)
- **当前计划**：[`plans/2026-09-01-atom-web-bug-patrol.md`](plans/2026-09-01-atom-web-bug-patrol.md)
- **并行裁定账本**：[`plans/2026-09-02-atom-cli-feedback-triage.md`](plans/2026-09-02-atom-cli-feedback-triage.md)；45 条 CLI `submit` 已逐条登记，但只有重新取得当前复现证据的条目才进入修复链。
- **最近完成**：[`plans/2026-09-01-atom-esg-stage-progression.md`](plans/2026-09-01-atom-esg-stage-progression.md)；隔离测试世界已跑通五阶段连续解锁与四次自动迁窗，真实 ESG 初态也已部署并回读。真实业务`✅`只影响生产数据观察，不再作为软件功能验收阻塞。
- **跨 Session 规则**：[`specs/2026-08-31-atom-acceptance-operations-design.md`](specs/2026-08-31-atom-acceptance-operations-design.md)
- **相关世界合同**：[`specs/2026-08-31-atom-world-program-design.md`](specs/2026-08-31-atom-world-program-design.md)
- **相关授权合同**：[`specs/2026-08-31-atom-agent-authorization-design.md`](specs/2026-08-31-atom-agent-authorization-design.md)

当前任务绑定 15 分钟增量巡守`Atom 开发巡守`（automation id：`atom-2`，状态由 Codex App 的 Scheduled/Automation 记录为准）。每次巡守仍从本页和当前计划恢复；Atom CLI `submit`只作反馈线索，必须重新对照用户定论、产品规格和可复现证据裁定。

## Web 场景状态

以下场景的产品合同保存在[`specs/2026-08-31-atom-web-spatial-design.md`](specs/2026-08-31-atom-web-spatial-design.md)，实施前分别执行 Superpowers brainstorming；不得在当前迁窗任务中顺手修改：

- **待设计实现**：输入层识别同一 exact Thing 的无上限点击次数并提交统一 Transform `thing$click`动作；Strut 内嵌 `if` Program按动作信封判定，三点击只是一个条件用例，不得硬编码用途或建立独立 click 调度旁路。
- **待手机验收**：唯一正式入口是`https://worker.tail33a2eb.ts.net/`，手机访问仍失败；服务端链已通，继续从手机 DNS/浏览器边界取证。`100.116.206.105:4786`只保留为内部诊断探针，不是用户入口、替代地址或完成方案。
- **待复修**：Shortcut 深层激活在真实 4784 再现失败；历史测试只证明远端路线进入 scoped state，未证明人工激活最终到达并选中目标。
- **即时收件**：Web 改名成功后域进出仍读旧快照、约两分钟才一致，须修复提交 revision→缓存失效→权威对账闭环；Shortcut 创建/修改应接受语义目标并由系统固化 stable id，不要求人工或 Agent 手填 ID，也不把合同 JSON 当正文编辑。
- **即时收件**：普通名称视图偶发泄漏 `@slot-role-<内部ID>`；稳定身份继续保留，但必须与用户语义名称分层，不做表面截断。
- **已完成**：A 模式双击最深目标、ASDF Strut 端点贴边和 CLI 更新后的场景连续性已有测试、真实浏览器证据和远端提交。
