# A Mode Task 5：右键长按实现报告

- **任务状态**：实现完成，待控制方独立复核。
  - **基线**：`d9f98776667af82d16d8828aa42f10104d11ec11`
  - **范围**：仅新增右键长按入口、沿用共同设置字段并兼容上版完整文档、同步桌面与移动帮助；未改既有 A 导航、Graph、权限、Transform、Program、生产数据或部署。
  - **约束执行**：未运行全量 `npm test`；所有 Playwright 运行均使用唯一输出目录；未删除任何证据文件或目录。

## 实现主干

- **长按仲裁**
  - `createSecondaryClickArbiter` 改为按下时 `begin`、松开时 `release`。
  - 按下时锁定稳定目标签名和 240–800ms 阈值；默认 420ms。
  - 阈值前松开提交一次普通向内剖开；达到阈值提交一次沉浸；沉浸后的松开不再导航。
  - 同目标快速双击只保留第一次普通动作，不再升格为沉浸；空白快速双击仍只返回一层。
  - 拖移、`pointercancel`、`lostpointercapture`、失焦和修饰键变化取消当前识别，迟到定时器不能导航。

- **输入与生命周期**
  - 两个预设均以 `nodeHoldSecondary` 映射沉浸，右键双击显式解析为无沉浸意图。
  - `pointerdown` 建立候选后立即启动同一仲裁链；`pointerup` 释放该候选。
  - 移动端既有“按住后释放”虚拟右键在释放时复用相同 `begin/release` 业务链，保持其普通右键语义与单一配置来源。
  - Ctrl 关系编辑、Shift 魔杖、左键使用和中键拖拽分支未改变。

- **共同设置演进**
  - 当前完整字段集继续严格读取。
  - 仅允许旧完整字段集缺 `secondaryNavigationDelayMs`；读取时补 420，保留 revision、合法 0 和全部其他字段且不写盘。
  - 未知字段、缺其他字段、损坏新字段仍拒绝。
  - 下一次显式 CAS 更新保存当前完整字段集并递增 revision。

- **界面合同**
  - 设置标签、说明、恢复默认可访问名称改为“右键沉浸长按时长”。
  - 桌面帮助、画布可访问说明、实时状态说明同步短按/长按行为。
  - 移动控制仅保留 A 结构视图，移除 S/D/独立 F 控件与帮助文案；Z/X、详情、编辑、魔杖等既有入口保留。

## TDD 证据

### RED

- **Node RED**
  - **命令**：`node --test --test-isolation=none tests/input-config.test.js tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js tests/mobile-interaction-contract.test.js tests/atom-presentation-settings.test.mjs`
  - **输出**：`tests 63; pass 50; fail 13`。
  - **具体失败**：缺少 `begin/release` 长按生命周期；输入仍映射右键双击沉浸；旧完整设置缺新字段仍被严格字段数拒绝；界面仍显示连击和 S/D/F 旧合同。

- **Chromium RED**
  - **命令**：`npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --config=playwright.config.mjs --grep "A sustained right press|A right double-click|blank right double-click" --output=.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-red-20260906-01`
  - **输出**：`3 failed`。
  - **具体失败**：持续按住 440ms 仍停在根层；右键双击进入沉浸；空白返回旅程无法通过长按建立前置沉浸。
  - **证据**：`.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-red-20260906-01/`，含失败截图、错误上下文和 trace。

### GREEN

- **受影响 Node 链**
  - **命令**：`node --test --test-isolation=none tests/input-config.test.js tests/spatial-gesture-arbiter.test.js tests/gesture-contract.test.js tests/mobile-interaction-contract.test.js tests/atom-presentation-settings.test.mjs`
  - **输出**：`tests 63; pass 63; fail 0; duration_ms 2110.7069`。
  - **覆盖**：短按、长按一次、阈值锚定、快速同目标双按合并、不同目标独立、取消迟到定时器、pointer 生命周期、移动帮助、旧设置读取与下一次完整 CAS 保存。

- **核心 A 浏览器旅程**
  - **命令**：`npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --config=playwright.config.mjs --grep "A single right-click|A sustained right press|A right double-click|blank right double-click" --output=.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-01`
  - **输出**：`4 passed (29.2s)`。
  - **真实断言**：短按保留团外上下文；长按在松开前进入沉浸且松开不追加普通导航；双击不沉浸；深层空白双击只返回一层。
  - **证据**：`.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-01/.last-run.json`。

- **取消浏览器旅程**
  - **命令**：`npx playwright test tests/browser/atom-web-critical-journeys.spec.mjs --config=playwright.config.mjs --grep "A pending right hold cancels" --output=.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-09`
  - **输出**：`1 passed (11.1s)`。
  - **真实断言**：Playwright `page.clock` 保持产品默认 420ms，用真实鼠标/键盘事件分别执行 12px 拖移、`pointercancel`、Control 变化，再推进 421ms，三者均保持根层。
  - **证据**：`.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-09/.last-run.json`。

- **设置调值与恢复**
  - **命令**：`npx playwright test tests/browser/mobile-control-panel.spec.mjs --config=playwright.config.mjs --grep "right-click hold duration" --output=.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-10`
  - **输出**：`1 passed (7.8s)`。
  - **真实断言**：调值后重载保持，单字段恢复默认后再次重载为 420ms，其他设置不被重置。
  - **证据**：`.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-10/.last-run.json`。

- **跨端共同配置**
  - **命令**：`npx playwright test tests/browser/presentation-settings.spec.mjs --config=playwright.config.mjs --grep "inherits and updates the shared right-hold threshold" --output=.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-12`
  - **输出**：`1 passed (10.1s)`。
  - **真实断言**：桌面以 612ms 和合法 0 初始化共同配置；独立 390px 移动上下文读取同值；移动端更新为 640ms 后桌面同步，合法 0 保持。
  - **证据**：`.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-12/.last-run.json`。

- **语法与差异**
  - **命令**：`git diff --check`。
  - **输出**：退出码 0，仅 Git 的 LF→CRLF 工作区提示。
  - **命令**：`node --check input-config.js`、`node --check spatial-gesture-arbiter.js`、`node --check spatial-engine.js`、`node --check src/atom-system/spatial-experience/presentation-settings-service.mjs`、`node --check tests/browser/atom-web-critical-journeys.spec.mjs`、`node --check tests/browser/presentation-settings.spec.mjs`。
  - **输出**：全部退出码 0，无语法错误。

## 定向调试证据

- **拖移首轮失败**
  - **现象**：输出目录 `task-5-browser-green-20260906-02` 中最终路径已沉浸。
  - **逐层证据**：
    - `task-5-browser-debug-20260906-03`：分阶段断言把失败限定为拖移。
    - `task-5-browser-debug-20260906-04`：页面实际收到 button2 的 12px `pointermove`。
    - `task-5-browser-debug-20260906-05`：420ms 定时器已触发，未在触发前收到 clear。
    - `task-5-browser-debug-20260906-06`：候选和事件 pointerId 都为 1，起点 x=688、移动 x=700、阈值=6。
    - `task-5-browser-debug-20260906-07`：取消 helper 确实到达；外部 Playwright trace 显示 `mouse.down` 调用起点至 `mouse.move` 调用起点实际约 598ms，超过 420ms。
  - **结论**：失败源于测试驱动动作抵达页面晚于产品阈值，不是产品取消链缺陷。最终旅程改用统一页面时钟控制边界，并移除所有临时 engine、timer、pointer 和 console 探针。
  - **时钟夹具校正**：`task-5-browser-green-20260906-08` 首次 `pauseAt` 因 RPC 期间时钟已前进而报 `Cannot fast-forward to the past`；将暂停目标设为已读取页面时间之后 60 秒后，`task-5-browser-green-20260906-09` 通过。

- **旧 F 旅程边界**
  - **命令**：`npx playwright test tests/browser/presentation-settings.spec.mjs --config=playwright.config.mjs --grep "independent mobile context inherits host settings" --output=.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-11`
  - **输出**：`1 failed`；失败位于旧 `applyViewMode` 应打开 `clusterFieldOpen` 的断言。
  - **结论**：该断言属于 Task 6 已登记的 S/D/F 旧合同清理。它发生在共同设置继承断言之后，与本任务长按字段和服务演进无关；本任务未改该旧旅程控制流，另以具名共同字段旅程获得 GREEN。
  - **证据**：`.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-browser-green-20260906-11/`，含失败截图、错误上下文和 trace。

## GitNexus

- **索引**
  - **命令**：`npx gitnexus analyze --index-only`。
  - **输出**：完成；7,333 nodes、20,315 edges、622 clusters、300 flows，耗时 36.3s。

- **修改前 impact**
  - **LOW**：`createSecondaryClickArbiter`、`resolvePointer`、`describeGroups`、`commitPointerCandidate`、`releasePointer`、presentation service `read`、浏览器 helper `rightClickTarget`。
  - **CRITICAL**：`updateSelectionUI`，43 个直接调用者、82 个总影响符号、3 个流程、9 个模块。实际修改仅两条静态帮助文本；自审确认无控制流或状态改变，并以真实 UI 行为验证。
  - **HIGH**：无。

- **提交前 detect_changes**
  - **第一次 all scope**：21 changed symbols、1 affected process、risk `medium`；唯一受影响流程是 `ExecuteDemoStep → AtomDisplayName` 的 `updateSelectionUI` 步骤。输出同时包含控制方正在编辑、不会进入本提交的计划文件，故提交前再以 staged scope 复核本任务文件。
  - **最终 staged scope**：17 changed symbols、1 affected process、14 changed files、risk `medium`；受影响流程仍仅为 `ExecuteDemoStep → AtomDisplayName` 的 `updateSelectionUI` 静态提示步骤，控制方计划文件不在 staged 集合。

## 修改文件

- **产品代码**
  - `index.html`
  - `input-config.js`
  - `spatial-engine.js`
  - `spatial-gesture-arbiter.js`
  - `src/atom-system/spatial-experience/presentation-settings-service.mjs`

- **自动化测试**
  - `tests/input-config.test.js`
  - `tests/spatial-gesture-arbiter.test.js`
  - `tests/gesture-contract.test.js`
  - `tests/mobile-interaction-contract.test.js`
  - `tests/atom-presentation-settings.test.mjs`
  - `tests/browser/atom-web-critical-journeys.spec.mjs`
  - `tests/browser/mobile-control-panel.spec.mjs`
  - `tests/browser/presentation-settings.spec.mjs`

- **任务报告**
  - `.superpowers/sdd/2026-09-04-a-mode-consolidation/task-5-longpress-report.md`

## 自审结论

- **行为守恒**：普通/沉浸导航仍调用既有意图与状态机；只替换右键进入沉浸的识别入口。
- **稳定锚点**：长按动作捕获按下时候选、Thing、domain context、目标签名和阈值；设置在按下后改变不会影响该次动作。
- **单次提交**：timer 回调只提交一次 hold；release 在 hold 后只清理；取消通过 token 阻止迟到回调。
- **配置严格性**：兼容分支只容许恰好缺一个指定字段，字段验证仍拒绝未知、缺失和损坏值；GET 不写盘，显式 CAS 写回完整字段集。
- **UI 一致性**：可访问名称、设置、桌面/移动帮助和实时提示均使用短按/长按合同；S/D/F 活跃入口已移除。
- **遗留边界**：全量测试、旧 F 浏览器断言清理、部署和正式入口回读属于 Task 6/7，未在本任务扩展。
