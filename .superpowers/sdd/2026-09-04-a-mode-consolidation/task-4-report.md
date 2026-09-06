# Task 4 实施报告

- **目标**：实现唯一 A 的普通向内剖开、沉浸进入与空白单层返回；旧 S、D、独立 F 不再参与运行时结构选择。
- **基线**：`d9df3bb`；实现工作树 `D:\Project\〇\subprojects\atom\.worktrees\a-mode-consolidation`。

## 结果主干

- **普通剖开**：`applyInwardView` 只以 `nested` 打开真实 owner 下的 child domain；展开不再自动聚焦子团，因此当前域与团外节点继续留在画面。
- **沉浸剖开**：`applyImmersiveInwardView` 复用 `enterNode(node, true)` 和既有 owner route，进入点击团并隐藏上级背景。
- **父层返回**：`applyParentView` 继续通过真实 domain route 一次退一层；修正 `returnClusterToDepth` 引用未声明 `options` 的运行时缺陷。
- **模式归一**：快照、已展开分支、批量、递归、PageUp/PageDown 和演示路径统一归一为 `nested`；清退旧 S/D/F dispatch、循环和外围 reveal 分支。
- **保留能力**：`peripheralDepthShrink` 仍由 nested 几何路径消费，未因旧命名移除；owner route、历史、详情、编辑、魔杖与左键路径保留。

## TDD 证据

- **既有浏览器 RED**：控制方在 `4ebb181` 已取得 3 项真实失败；本任务复用该证据。普通右击缺少内层团，双击路径停在 `root`，返回旅程阻在首次沉浸前提。
- **新增单元 RED**：
  - 命令：`node --test --test-isolation=none --test-name-pattern 'every batch A action|recursive A planning|A navigation dispatch' tests/cluster-engine-contract.test.js tests/spatial-view-mode-model.test.js`
  - 输出：3/3 失败；缺少 `applyInwardView` dispatch，`immersive` 输入把 batch 缩为 clicked，并把 recursive expansion 缩为空。
- **单元 GREEN**：
  - 命令：`node --test --test-isolation=none tests/cluster-engine-contract.test.js tests/gesture-contract.test.js tests/spatial-view-mode-model.test.js`
  - 输出：77/77 通过，0 失败。
- **浏览器 GREEN**：
  - 命令：`npx playwright test --config=playwright.config.mjs tests/browser/atom-web-critical-journeys.spec.mjs --grep "A single right-click|A double right-click|blank right double-click|ordinary inward click|A key does not"`
  - 输出：5/5 通过，覆盖普通剖开保留团外上下文、精确沉浸、空白双击只退一层、普通剖开解除沉浸、A 键不作为退出旁路。

## 浏览器定位与时序

- **真实双击**：使用 Playwright `mouse.dblclick` 在同一目标坐标发出完整鼠标事件序列，产品默认 `420ms` 未改。
- **导航等待**：A fixture 改为等待 `domcontentloaded` 后再等待真实交互目标；此前整组负载下曾出现 `page.goto` 超过默认 30 秒，与产品断言无关。
- **残留服务**：最终检查 4796 无监听进程，Playwright WebServer 已随命令退出。

## 文件

- **运行时**：`spatial-engine.js`、`spatial-view-mode-model.js`。
- **单元测试**：`tests/cluster-engine-contract.test.js`、`tests/spatial-view-mode-model.test.js`；`tests/gesture-contract.test.js` 作为聚焦回归运行但无需修改。
- **浏览器测试**：`tests/browser/atom-web-critical-journeys.spec.mjs`。

## 自审与疑点

- **范围**：未修改 Graph、权限、世界、后台、`index.html` 或 `spatial-input-config.js`；控制方的规格和总账改动未暂存。
- **风险**：GitNexus 将历史恢复、批量与核心调度评为 HIGH/CRITICAL；修改只做 mode 归一和普通展开相机所有权收束，77 项聚焦单元及 5 条真实旅程均通过。
- **变更检测**：提交前 `detect_changes(scope: staged)` 报告 27 个触及符号、12 条受影响执行流、风险 high；执行流集中在 Web 空间导航与演示链，未出现 Graph、权限或后台流。
- **疑点**：帮助面板仍显示 S/D/F 属 Task 5；本任务按边界未修改。浏览器测试曾受本地 WebServer 加载时限影响，最终候选以 `domcontentloaded` 后真实状态收口。
