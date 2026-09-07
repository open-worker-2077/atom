# Atom Superpowers 恢复入口

本页只提供导航。当前状态由唯一总账裁定，产品合同在规格中，步骤与证据在专项计划中；聊天与摘要不替代这些文件。

## 恢复顺序

1. 读取[唯一总账](plans/2026-09-03-atom-current-requirement-ledger.md)和[当前恢复断点](plans/2026-09-03-session-recovery-checkpoint.md)，按用户最新顺序定位工作。
2. 沿总账读取所属规格、专项计划的当前断点和未完成步骤；历史过程段不能覆盖当前段。
3. 核对计划绑定的 Git/worktree/diff、原始测试和部署证据；同一 revision 的有效证据复用，仅补当前未完成步骤所需的最小验证。
4. 使用已安装的官方 Superpowers 技能；需要实际操作 Atom 时先读 `atom.cmd --help`。官方 SDD 工作区仅保存派发、报告和恢复索引，不另立产品状态。
5. 新发现立即写回所属规格/原计划/总账，再从原任务断点继续；不因换任务或巡守重做已完成步骤。

## 统一开发边界

- `AGENTS.md`只负责把开发者和Agent引入本页，不承载产品状态、工具规则或动态统计。
- Atom规格、计划、状态和验收只进入本目录现有权威文件；Git提交与当前diff记录实现，绑定revision的新鲜证据证明完成。
- GitNexus、Code-Graph-RAG及后续同类工具都只是按需代码关系检查器，由本入口统一分派；工具输出提供候选关系，不替代源码裁定、受影响测试或真实旅程。
- GitHub Issues和Projects仅为可选协作入口；历史开发控制文件只读追溯，不提供当前指令。
- 官方Superpowers技能定义保持原位且不在仓库内复制、包裹或改写；真实Atom世界、业务事实、凭据和私密备份位置不进入版本控制。

## 产品规格

- [Web、编辑反馈与跨端配置](specs/2026-08-31-atom-web-spatial-design.md)
- [世界、Program 与槽体合同](specs/2026-08-31-atom-world-program-design.md)
- [Agent 与授权](specs/2026-08-31-atom-agent-authorization-design.md)
- [提交、投影与恢复](specs/2026-08-31-atom-runtime-projection-recovery-design.md)
- [开发运作与跨任务衔接](specs/2026-08-31-atom-acceptance-operations-design.md)

## 实施与证据入口

- [移动和来源/后续提交边界](plans/2026-09-05-transform-postcommit-boundary.md)、[整体归档](plans/2026-09-05-ancestor-discard.md)
- [手机共同配置](plans/2026-09-05-shared-presentation-settings.md)、[Web 缺陷原计划](plans/2026-09-01-atom-web-bug-patrol.md)
- [旧生成 print 迁移](plans/2026-09-05-generated-slot-print-migration.md)、[A 模式及长按修订](plans/2026-09-04-a-mode-consolidation.md)
- [CLI 反馈裁定](plans/2026-09-02-atom-cli-feedback-triage.md)、[ESG 阶段推进](plans/2026-09-01-atom-esg-stage-progression.md)、[Strut 动作](plans/2026-09-02-inline-strut-transform-actions.md)
- [最小化检查](minimality-checkpoints.md)、[代码关系检查](code-graph-rag-assistance.md)、[独立连续性门禁撤回记录](specs/2026-09-04-atom-development-continuity-gates-design.md)

这些链接提供位置，不表示任务完成或当前优先级；实际结论回到总账和专项计划。

## 历史边界

旧 GitHub/OpenSpec 与历史实施记录用于追溯，不构成活跃需求或完成权威。入口页此前混入的过期状态保留于 Git `55beaab:docs/superpowers/README.md`，不再复制进本导航页。官方技能定义保持原位，只读调用；项目文件保存 Atom 的输入、证据及用户明确约束。
