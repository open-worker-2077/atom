# Task 2 Report: 真实 owner 域径与原子游走提交

- **提交**：`477db34 fix(web): enter immersive domains from real owner routes`。
- **实现**：F 模式以可见节点的真实 `ownerPath` 恢复已知域径，再追加该节点 lineage；`commitDomainRoute` 在发布视图前同步替换 `domainStack`、`currentPath`、`depth`、`crumbs` 与 `nodes`。快捷入口继续使用完整路线并进入同一提交边界。

## 验证记录

- **浏览器 RED**：
  - `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --grep "F-mode enters a visible nested node through its real owner route" --reporter=line`
  - 预期 `root/1eloam2/9dvkyl`，实际 `root/9dvkyl`；证明旧实现错误地从活动总览路径拼接。
- **模型与合同 GREEN**：
  - `node --test tests/spatial-view-mode-model.test.js tests/view-mode-engine-contract.test.js`
  - 48 项通过，0 项失败。
- **浏览器 GREEN**：
  - 同一 Playwright journey 连续运行两次，均为 `1 passed`；覆盖真实路径、子节点加载及“上层”返回真实 owner 父域。
- **范围检查**：
  - `git diff --cached --check` 无输出、退出码 0。
  - GitNexus `detect_changes` 报告 Task 2 暂存影响为 low，未识别受影响执行流。

## 残余风险

- **完整回归**：本任务按计划只运行了模型、引擎合同和定向浏览器旅程；完整 `npm test` 留给 Task 4 的全量验收。
- **动画交互**：浏览器旅程在确认“上层”已启用后以强制点击跨过画布动画层；路径断言仍验证了实际返回结果。后续 UI 收敛可单独评估动画期间的按钮命中层。

## Follow-up: foreign owner route validation

- **提交**：`8b672e4 fix(web): reject invalid immersive owner routes`；仅包含 `spatial-view-mode-model.js` 与其模型测试。
- **模型 RED**：新用例在旧实现下证明空 foreign route 被接受为 `depth: 0`，终点路径错位和 depth/crumbs 错位也被接受。
- **验证**：
  - `node --test tests/spatial-view-mode-model.test.js tests/view-mode-engine-contract.test.js`：51 项通过，0 项失败。
  - `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --grep "F-mode enters a visible nested node through its real owner route" --reporter=line`：`1 passed`。
- **保护**：foreign route 现在必须覆盖 ownerPath 的完整 root 相对深度，且每段 route entry 与对应 path、depth、crumbs、nodeLabel 一致；不合格路线在引擎提交前返回 `null`，活动域状态保持原样。

## Follow-up: route segment identity proof

- **提交**：`245efe0 fix(web): verify immersive owner route identities`；仅包含路线模型、引擎 resolver 注入及对应模型/合同测试。
- **RED**：结构、path、depth 与 crumbs 均正确但 `nodeId` 被伪造的 foreign route 仍被旧实现接受。
- **保护**：模型对每个 route entry 调用显式 `ownerSegmentForNode(nodeId)`；引擎传入与 `childPathFor()` 相同的 `hashText(nodeId).toString(36)` 规则。任何 segment 与 node identity 不同源的路线会在提交前拒绝。
- **验证**：
  - `node --test tests/spatial-view-mode-model.test.js tests/view-mode-engine-contract.test.js`：52 项通过，0 项失败。
  - `npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --grep "F-mode enters a visible nested node through its real owner route" --reporter=line`：`1 passed`。
