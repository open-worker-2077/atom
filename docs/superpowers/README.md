# Atom Superpowers 恢复入口

本页只负责导航，不复制产品需求、任务状态或完成结论。日常 Session 消息持续翻译进对应规格、计划与 Git 证据；聊天正文与自动压缩摘要均不是存储或恢复依据。

## 新 Session 读取顺序

1. 先读取当前功能规格与实施计划的“恢复断点”；Superpowers 文件体系是唯一开发上下文。
2. 检查`git status --short`、`git log -5 --oneline --decorate`、计划绑定 revision、测试与部署证据；这些只作为账本证据，不另立开发上下文。
3. 只有需要操作 Atom Graph 或核对公开产品合同时才运行`atom.cmd --help`；不得把 Atom 世界当开发进度看板。
4. 重新运行计划首个未完成任务要求的最小验证，不从聊天摘要猜状态。
5. 发现账本与当前证据不一致时，先回查并立即更新 Superpowers，再从首个未完成项继续；不得把“账本过期”当成停止理由。

## 最小化检查

- **唯一框架**：Superpowers 继续独占规格、计划、TDD、调试、验证与完成裁定；Ponytail 不作为第二套框架安装或常态注入。
- **固定入口**：设计获批后、计划定稿前执行一次方案最小化；提交前执行一次差异复杂度审查。规则与冲突顺序见[`minimality-checkpoints.md`](minimality-checkpoints.md)。
- **硬边界**：不得以减少代码为由削弱用户定论、Atom 合同、安全、数据守恒、迁移回滚、持久化账本、测试或验证。

## 当前开发链

- **当前恢复断点**：[`plans/2026-09-03-session-recovery-checkpoint.md`](plans/2026-09-03-session-recovery-checkpoint.md)；ChatGPT软件更新或 Session历史丢失后，先从该文件恢复，不依赖聊天记录或自动压缩摘要。
- **当前最高优先级**：Strut 触发单轨化；Graph clause 已决定后项，后项自己的 Program 只声明是否响应，退役`trigger("strut", {"nodes":[...]}, ...)`中的冗余`nodes`，不得保留新旧双轨。定论与恢复入口见[`plans/2026-09-03-session-recovery-checkpoint.md`](plans/2026-09-03-session-recovery-checkpoint.md)。
- **2026-09-03 已部署**：Slot相邻层级信号、Program relocation closure、交互原子隔离、独立截止、迟到提交防护与短权威提交临界区均已合入并推送`main@ead30e2`。系统测试`226/226 PASS`；真实4784重启后 health正常，`explore 🧊manage`最终约256ms。此前“health快但命令长期挂起”的P0已关闭。

- **首要 Graph 纠偏**：Strut 判定 Program 必须内嵌在 clause `if`，取得复合前项事实与本次规范化 Transform `$` 动作信封；`$click`只是注册动作族的首个用例，CLI/Web 点击统一为 `transform {"thing$click":"EXACT路径"}`，新增动作不得修改 Strut/runtime 主干。旧外部 `thing@program` 判定与独立 click endpoint/trigger 方案均已退役。权威合同见[`specs/2026-08-31-atom-world-program-design.md`](specs/2026-08-31-atom-world-program-design.md) §3.2、§4.1；当前实施账本见[`plans/2026-09-02-inline-strut-transform-actions.md`](plans/2026-09-02-inline-strut-transform-actions.md)。

- **已完成热态**：[`plans/2026-09-02-atom-startup-hot-state.md`](plans/2026-09-02-atom-startup-hot-state.md)已合入当前`main`；真实4784不再以旧的7—14秒数据作为现状。
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

- **已完成**：输入层识别同一 exact Thing 的无上限点击次数并提交统一 Transform `thing$click`动作；Strut 内嵌`if` Program按动作信封判定，三点击只是条件用例，没有独立 click 调度旁路。旧`feat/programmable-click-trigger`分支不合入。
- **待手机验收**：唯一正式入口是`https://worker.tail33a2eb.ts.net/`，手机访问仍失败；服务端链已通，继续从手机 DNS/浏览器边界取证。`100.116.206.105:4786`只保留为内部诊断探针，不是用户入口、替代地址或完成方案。
- **待复修**：Shortcut 深层激活在真实 4784 再现失败；历史测试只证明远端路线进入 scoped state，未证明人工激活最终到达并选中目标。
- **待修—Web 即时一致性**：无论改动来自 Web 还是 CLI，Transform提交成功后当前局部视图仍可能保留旧节点名称、正文或结构，约两分钟后才一致。须修复权威 revision发布→最小受影响路径缓存失效→局部投影刷新→Web对账闭环；轮询最终收敛不算完成。
- **待修—Shortcut语义编辑**：创建/修改接受当前目标、唯一语义路径或查询，由系统消歧并固化 stable id；不要求人工或 Agent手填ID，也不把合同JSON当正文编辑。
- **即时收件**：普通名称视图偶发泄漏 `@slot-role-<内部ID>`；稳定身份继续保留，但必须与用户语义名称分层，不做表面截断。
- **已完成**：A 模式双击最深目标、ASDF Strut端点贴边和CLI更新后的场景连续性已有测试、真实浏览器证据和远端提交。
- **待集成—ASDF与统一设置**：`fix/asdf-navigation-settings`已完成最具体节点命中和真实owner域径实现；星轨设置已有实现，但评审仍有“默认详情模式未实际应用”和“伪模态未阻断后台键盘交互”两个缺口。该分支尚未集成`main`。
