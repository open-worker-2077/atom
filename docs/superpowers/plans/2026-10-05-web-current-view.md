# 固定原文开关、Web 当前正文更新与刷新恢复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认隐藏左侧选中节点原文，外部写入后当前正文自动更新，F5恢复当前浏览视图。
**Architecture:** 左侧 field-readout 是固定选择信息栏，正文开关独立于悬浮详情亮度；现有 Web 变更通知和视图合同优先复用，先以隔离旅程确定故障边界再修复。
**Tech Stack:** Browser JavaScript、Node.js、node:test、Playwright。
**Spec:** 本计划中的用户已确认主干；沿用 ../specs/2026-08-31-atom-web-spatial-design.md 和提交投影恢复规格；唯一状态见2026-09-03-atom-current-requirement-ledger.md。

## Global Constraints

- I3/U3/D2/E3；问题研讨→持久化与备份→目标模式执行；不修改正式业务世界用于验证。
- 左侧原文不是悬浮详情框。不得通过详情亮度关闭它，也不得隐藏节点名称或操作提示。
- Web更新不阻断CLI，维持当前位置、展开结构、相机；F5不要求用户重新下钻。
- 安全备份 backup/atom-web-live-view-before-repair-20261005 已推送精确4e8c532b06753ca4369ec76c10701fb79f72810f；该提交原main检查37230085591成功，本次仅作为实施前备份。
- Superpowers6.4.2基线已核对；用户明确修改全局using-superpowers核心流程，优先于此前只读约定，原文归档在工作区docs/file-management/2026-10-05-superpowers-entry；不建立第二个Skill。

## 已确认与待验证

- 左侧来自 index.html selectionCopy / spatial-engine.js updateSelectionUI，将 selected.description 直接放进固定 DOM 信息栏，与浮框绘制独立；撤回先前详情亮度归因。
- 正式世界只读和4784/state均返回表格起始的新正文，截图显示旧正文；数据已更新，客户端更新断点仍待隔离复现。
- 放大镜缓存键包含正文且每帧更新；不能将故障归因为缓存键没有正文或鼠标没动。
- 初次页面只pull当前root，importKnowledge不消费knowledge.view；F5视图恢复链待验证。

## Review Focus

1. 默认隐藏仅影响固定原文，开关可用且刷新后保持选择。
2. 复杂Markdown外部写入在已展开深层团的放大镜自动显示。
3. 更新到达拉取期间、后台页面返回或连接恢复不会永久遗失通知。
4. 刷新恢复当前域、展开结构和相机；无效旧位置安全回到可用祖先。
5. 浏览状态不写入业务事实，不泄露真实Situation到Git。

### Task 1：固定原文控制

**Files:** index.html、spatial-engine.js、spatial.css；tests/browser/fulltext-target.spec.mjs及必要独立旅程。
**Interfaces:** 既有selectionCopy固定正文和展示设置路径；采用独立显示偏好，具体位置以现有同类控制验证。
- [ ] 隔离旅程复现默认固定原文可见，形成RED。
- [ ] 添加正文独立开关、默认关闭和持久化，验证右侧渲染及名称提示。
- [ ] 定向GREEN并阶段提交、更新本计划。

### Task 2：外部正文更新与刷新恢复

**Files:** spatial-browser-bridge.js、spatial-engine.js；tests/browser/cli-web-refresh.spec.mjs、tests/browser-bridge-contract.test.js及必要恢复模型。
**Interfaces:** 既有changes SSE、pullKnowledge/importKnowledge、exportField/knowledge.view及visualSnapshot；不另建Graph存储。
- [ ] 外部写入+深层展开+放大镜隔离旅程，定位客户端断点；分别验证丢通知、缓存旧节点和重载未恢复假设。
- [ ] 为已确认缺陷形成真实RED后实现最小修复；已有有效旅程不重复开发。
- [ ] 验证正文自动更新、相机和展开不变；F5恢复位置，记录GREEN并提交。

### Task 3：E3收口

- [ ] 受影响链与真实关键旅程通过，fresh独立整体评审，修复实际问题。
- [ ] 最终候选必要全量一次；推送精确revision并等待远端终态。
- [ ] 正式部署并公共入口回读，证据写回本计划与总账；所有验收完成后关闭目标。