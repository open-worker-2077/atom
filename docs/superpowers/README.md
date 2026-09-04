# Atom Superpowers 恢复入口

本页只负责导航，不复制产品需求、任务状态或完成结论。日常 Session 消息持续翻译进对应规格、计划与 Git 证据；聊天正文与自动压缩摘要均不是存储或恢复依据。

## 新 Session 读取顺序

1. 先读取当前功能规格与实施计划的“恢复断点”；Superpowers 文件体系是唯一开发上下文。
2. 检查`git status --short`、`git log -5 --oneline --decorate`、计划绑定 revision、测试与部署证据；这些只作为账本证据，不另立开发上下文。
3. 只有需要操作 Atom Graph 或核对公开产品合同时才运行`atom.cmd --help`；不得把 Atom 世界当开发进度看板。
4. 重新运行计划首个未完成任务要求的最小验证，不从聊天摘要猜状态。
5. 发现账本与当前证据不一致时，先回查并立即更新 Superpowers，再从首个未完成项继续；不得把“账本过期”当成停止理由。

## 最小化检查

- **代码图辅助**：用户授权的全局Code-Graph-RAG已安装，Atom全仓离线索引和局部调用检索已验证；仅作为调试／影响分析工具，不替代Superpowers。版本、入口、覆盖与误连限制见[`code-graph-rag-assistance.md`](code-graph-rag-assistance.md)。

- **唯一框架**：Superpowers 继续独占规格、计划、TDD、调试、验证与完成裁定；Ponytail 不作为第二套框架安装或常态注入。
- **固定入口**：设计获批后、计划定稿前执行一次方案最小化；提交前执行一次差异复杂度审查。规则与冲突顺序见[`minimality-checkpoints.md`](minimality-checkpoints.md)。
- **硬边界**：不得以减少代码为由削弱用户定论、Atom 合同、安全、数据守恒、迁移回滚、持久化账本、测试或验证。

## 当前开发链

- **唯一需求总账**：[`plans/2026-09-03-atom-current-requirement-ledger.md`](plans/2026-09-03-atom-current-requirement-ledger.md)。所有用户需求、缺陷、延后项和撤回项先在该页裁定状态与优先级；专项计划的历史未勾选框不得越过总账重新制造待办。

- **当前恢复断点**：[`plans/2026-09-03-session-recovery-checkpoint.md`](plans/2026-09-03-session-recovery-checkpoint.md)；ChatGPT软件更新或 Session历史丢失后，先从该文件恢复，不依赖聊天记录或自动压缩摘要。
- **已撤回独立门禁**：[`specs/2026-09-04-atom-development-continuity-gates-design.md`](specs/2026-09-04-atom-development-continuity-gates-design.md)记录为何不为Atom另建连续性门禁；通用补充位于工作区`D:\Project\〇\AGENTS.md`，原Superpowers技能步骤保持完整。
- **当前主干状态**：ESG现场已把P0收束为`thing@program`创建链15秒超时：`work_order_catalog(...)`与仅`return True`均超时且未提交，普通14节点Graph约6秒成功；当前先按系统调试修复该链。A模式规格与实施计划已提交，隔离分支Task 1停在`b1bff98`并通过`31/31`聚焦测试，P0关闭后继续。改构前远程回退点为`pre-a-mode-consolidation-20260904`。现场反馈不得被当作擅改Graph本体定论的授权；手机与零Agent仍按总账排队。不得重新引入Strut`nodes`、Shortcut手填ID或把内部槽位身份重新投影成普通名称。
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

当前任务绑定每小时`Atom 目标巡守`（automation id：`atom-2`），状态`ACTIVE`；提示已更新为优先接收ESG生产急用功能反馈、先读唯一总账、即时入账、默认最小受影响链且禁止局部问题导致全局停工。

## Web 场景状态

以下场景的产品合同保存在[`specs/2026-08-31-atom-web-spatial-design.md`](specs/2026-08-31-atom-web-spatial-design.md)，实施前分别执行 Superpowers brainstorming；不得在当前迁窗任务中顺手修改：

- **已完成**：输入层识别同一 exact Thing 的无上限点击次数并提交统一 Transform `thing$click`动作；Strut 内嵌`if` Program按动作信封判定，三点击只是条件用例，没有独立 click 调度旁路。旧`feat/programmable-click-trigger`分支不合入。
- **手机正式域名未解决、当前不阻塞**：唯一正式入口是`https://worker.tail33a2eb.ts.net/`。2026-09-04回读确认电脑直连该域名为`200/约250ms`，MagicDNS、Serve、4785与4784均正常；同次Tailscale状态显示手机`pixel-10a`离线，因此当前请求在到达Atom前已中断。先恢复手机Tailscale在线，再从手机浏览器验收；若在线后仍失败，才继续追踪终端请求边界。`100.116.206.105:4786`只保留为内部诊断探针，不替代统一入口。
- **已完成**：Shortcut普通、未访问深层、A模式、坏链保持与渐进远端路线真实浏览器旅程`5/5 PASS`。
- **已完成—Web 即时一致性**：持续SSE按revision即时刷新；断线漏过CLI／Program提交后，EventSource重连立即核对当前路径与展开路径并一次导入同一最新revision，不依赖轮询或全世界刷新。
- **已完成—Shortcut语义编辑**：人工与Agent使用`thing.lnk.EXACT_TARGET`按语义路径改向；系统消歧、复用Graph鉴权并保持内部identity。Web只显示名称和目标路径，不要求手填ID，也不把合同JSON当正文编辑。
- **已完成—内部槽位标识隔离**：稳定身份继续保留在权威结构层，Web普通名称只投影公开语义类型。专项`13/13 PASS`；真实4784 revision 7272、投影`published`，用户可见投影中`slot-role-*`／`slot-revision-*`命中为0。
- **已完成**：A 模式双击最深目标、ASDF Strut端点贴边和CLI更新后的场景连续性已有测试、真实浏览器证据和远端提交。
- **已完成—ASDF与统一设置**：最具体节点命中、真实owner域径、默认详情模式、星轨设置与模态键盘隔离已集成并部署。后续A／S／D／F收束是新的架构方向：只保留A的Slot内嵌结构，把F沉浸融为A的可见范围动作；当前只记录，不抢占缺陷处理。
