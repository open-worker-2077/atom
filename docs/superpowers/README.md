# Atom Superpowers 恢复入口

本页只负责导航，不复制产品需求、任务状态或完成结论。日常 Session 消息持续翻译进对应规格、计划与 Git 证据；聊天正文与自动压缩摘要均不是存储或恢复依据。

## 新 Session 读取顺序

1. 运行`atom.cmd --help`，取得当前 Atom 入口与合同。
2. 读取当前功能规格与实施计划的“恢复断点”。
3. 检查`git status --short`、`git log -5 --oneline --decorate`和计划绑定的 revision。
4. 重新运行计划首个未完成任务要求的最小验证，不从聊天摘要猜状态。
5. 从首个未取得当前证据的步骤继续；发现规格、计划、代码或真实 Graph 冲突时停止并先校正事实。

## 当前开发链

- **当前规格**：[`specs/2026-09-01-atom-esg-stage-progression-design.md`](specs/2026-09-01-atom-esg-stage-progression-design.md)
- **当前计划**：[`plans/2026-09-01-atom-esg-stage-progression.md`](plans/2026-09-01-atom-esg-stage-progression.md)
- **跨 Session 规则**：[`specs/2026-08-31-atom-acceptance-operations-design.md`](specs/2026-08-31-atom-acceptance-operations-design.md)
- **相关世界合同**：[`specs/2026-08-31-atom-world-program-design.md`](specs/2026-08-31-atom-world-program-design.md)
- **相关授权合同**：[`specs/2026-08-31-atom-agent-authorization-design.md`](specs/2026-08-31-atom-agent-authorization-design.md)

当前任务绑定 15 分钟增量巡守`Atom 开发巡守`（automation id：`atom-2`，状态由 Codex App 的 Scheduled/Automation 记录为准）。每次巡守仍从本页和当前计划恢复；Atom CLI `submit`只作反馈线索，必须重新对照用户定论、产品规格和可复现证据裁定。

## 已收件但未进入实现的 Web 场景

以下场景的产品合同保存在[`specs/2026-08-31-atom-web-spatial-design.md`](specs/2026-08-31-atom-web-spatial-design.md)，实施前分别执行 Superpowers brainstorming；不得在当前迁窗任务中顺手修改：

- 输入层识别同一目标的点击次数，并允许 Program 把三点击声明为运行触发条件；不得硬编码三点击用途。
- A 模式展开后双击子节点却激活外部上级节点。
- ASDF 模式推支线端点未贴合关联节点边界。
- CLI 改变 Graph 后，Web 相机、焦点、展开或布局出现紊乱。
- Shortcut 激活后仍进入原节点，没有到达目标节点。
