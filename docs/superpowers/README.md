# Atom Superpowers 恢复入口

本页只负责导航，不复制产品需求、任务状态或完成结论。日常 Session 消息持续翻译进对应规格、计划与 Git 证据；聊天正文与自动压缩摘要均不是存储或恢复依据。

## 新 Session 读取顺序

1. 运行`atom.cmd --help`，取得当前 Atom 入口与合同。
2. 读取当前功能规格与实施计划的“恢复断点”。
3. 检查`git status --short`、`git log -5 --oneline --decorate`和计划绑定的 revision。
4. 重新运行计划首个未完成任务要求的最小验证，不从聊天摘要猜状态。
5. 从首个未取得当前证据的步骤继续；发现规格、计划、代码或真实 Graph 冲突时停止并先校正事实。

## 当前开发链

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

- **待设计实现**：输入层识别同一目标的点击次数，并允许 Program 把三点击声明为运行触发条件；不得硬编码三点击用途。
- **待手机验收**：唯一正式入口是`https://worker.tail33a2eb.ts.net/`，手机访问仍失败；服务端链已通，继续从手机 DNS/浏览器边界取证。`100.116.206.105:4786`只保留为内部诊断探针，不是用户入口、替代地址或完成方案。
- **待复修**：Shortcut 深层激活在真实 4784 再现失败；历史测试只证明远端路线进入 scoped state，未证明人工激活最终到达并选中目标。
- **已完成**：A 模式双击最深目标、ASDF Strut 端点贴边和 CLI 更新后的场景连续性已有测试、真实浏览器证据和远端提交。
