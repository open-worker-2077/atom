# 全文放大镜共用目标识别与 CLI 异步 Web 更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全文放大镜可读取已解剖团的正文；CLI确认写入后立即异步更新Web图数据并通知页面刷新。
**Architecture:** 全文放大镜直接调用中键现有对象命中函数，正文展示和相机定位由各自操作触发。运行时从来源确认处启动已有图数据更新链，继续使用同一中央事实、串行更新及SSE通知，防止旧结果覆盖新状态。
**Tech Stack:** JavaScript浏览器引擎、Node.js 24、node:test、Playwright。
**Spec:** `2026-09-03-atom-current-requirement-ledger.md` 的「2026-10-03 新目标：信息放大镜共用命中与 CLI 异步 Web 更新」（用户已确认的短设计）；关联Web规格与提交/投影/恢复规格。

## Global Constraints

- 两项均I3/U3/D2/E3，按用户顺序实施；必须部署并从公共入口回读。
- 共用节点／团识别，不另写排序；隐藏后代不泄漏；关系详情、中键定位有效。
- CLI不等待Web更新或后续Program；更新失败不否定已确认写入；不得重放业务写入。
- 私有世界、截图、业务正文不推送；不删除文件；原总账是唯一需求状态入口。
- 验证按最小受影响链→真实旅程→必要系统门禁→最终候选全量一次升级。

## Review Focus

- 团的多边形外但包围圆内：不得识别成该团。
- 小节点与团重叠：两种操作均应选同一个具体对象。
- 同一节点在不同域显示：正文和高亮必须对应当前域。
- 后续Program与无关交互一直活动：已确认来源仍应更新Web。
- 生成／写入旧图数据期间新提交到达：页面最终显示新数据，不能回退。

### Task 1: 全文放大镜共用中键对象识别

**Files:** Modify `spatial-engine.js`; Test `tests/spatial-visible-target.test.js`, `tests/render-contract.test.js`, `tests/browser/fulltext-target.spec.mjs`。
**Interfaces:** Consumes `findMiddleFrameHit(clientX, clientY)` 返回 `{item,domainContext,x,y,radius}`；Produces `currentMagnifierNode(point)` 返回 `{node,ownerPath,normalizedDistance}`，`point`为canvas局部坐标。

- [x] Step 1: 编写实际引擎函数行为测试：已解剖团命中、重叠小节点优先、团边界外拒绝、局部ownerPath、不可见后代不参与；预期字面对象ID及ownerPath。
- [x] Step 2: `node --test tests/spatial-visible-target.test.js`，Expected: 当前过滤团与不同排序导致断言失败。
- [x] Step 3: `currentMagnifierNode(point)`转换坐标后调用`findMiddleFrameHit`，从命中item取得node和ownerPath；不复制排序；保持关系与详情框分支。
- [x] Step 4: `node --test tests/spatial-visible-target.test.js tests/spatial-middle-frame-target.test.js tests/spatial-detail-magnifier-model.test.js tests/render-contract.test.js tests/view-mode-engine-contract.test.js tests/middle-label-focus-contract.test.js`，Expected: 全部通过。更换旧排除团断言为行为覆盖。
- [x] Step 5: 新增真实浏览器CapsLock三击、团空白区域全文及中键定位旅程；运行`npx playwright test --config=playwright.config.mjs tests/browser/fulltext-target.spec.mjs`，Expected: 全部通过；提交Task 1。

### Task 2: 来源确认后异步更新 Web 图数据

**Files:** Modify `src/atom-system/public/interaction-runtime.mjs`, `src/atom-system/adapters/legacy-runtime-composition.mjs`；Test `tests/atom-interaction-runtime.test.mjs`, `tests/atom-legacy-runtime-composition.test.mjs`及实际CLI/Web旅程。
**Interfaces:** Consumes 中央`onSourceReceipt`/`onCommitted`回调、`projections.publish({expectedRevision,lockState,affectedPaths})`；Produces 已确认来源启动独立Web更新，CLI回执不等待，最新revision通知现有SSE。

- [x] Step 1: 添加受控阻塞测试：来源确认后Program不返回、无关交互活动、图数据更新挂起/失败；断言CLI来源先确认且更新已启动。添加旧生成期间新事实提交的真实组合测试，断言最终Web内容为新值。
- [x] Step 2: `node --test tests/atom-interaction-runtime.test.mjs tests/atom-legacy-runtime-composition.test.mjs`，Expected: 来源确认后未启动及旧结果保护缺失的断言失败。
- [x] Step 3: 从中央来源确认回调登记更新并不等待；不受activeInteractions阻挡，不固定等待4秒；串行更新合并新revision，避免同来源结尾重复更新，保留失败回读/关闭行为；在真实图数据写入与页面通知边界落实旧结果保护。
- [x] Step 4: 同Step 2命令，Expected: 全部通过；真实CLI写入后页面接收新数据，不借手动刷新掩盖断链；提交Task 2。

## E3 收口

- [ ] 最小链通过后运行真实关键旅程与必要架构/系统门禁；提交最终候选并运行一次完整`npm test`。
- [x] 使用executing-plans一次独立整包评审；Important/Critical定向RED→GREEN修复，候选变化后全量证据重新绑定。
- [ ] 推送候选到功能分支，等待精确SHA远端终态；通过后按既有4784监督任务部署、公共Help/明确窗口回读、浏览器验证。
- [ ] 推送main并等待精确SHA远端终态；全部证据写回总账后关闭目标。

## 执行记录

用户短设计已确认，隔离分支`fix/magnifier-web-refresh-20261003`起点`8f060a8`。预检两任务无共享代码接口；共同影响仅最终Web旅程。沿用已验收产品基线fe9d8c9，不重复旧全量，新增范围先跑直接链。官方执行scratch仅记录派发/测试句柄与恢复索引，产品状态回写总账。
