# Task 3 报告：星轨统一设置与 CapsLock 默认模式

## 交付

- **提交**：`6b4c7f1 feat(web): add unified orbital settings`
- **范围**：仅修改 Task 3 指定的页面、样式、展示设置模型、空间引擎和三类测试；未修改 Atom backing JSON、Program、锁、Graph 语义或生成浏览器产物。
- **行为**：顶部仅保留可访问名称为“设置”的星轨入口；设置窗口居中、可 Esc 关闭，并分为“游走、空间工具、映射、显示、启动与帮助”五区。
- **默认模式**：`defaultDetailMode` 仅接受 `name`、`surface`、`floating`；缺失或非法值回退 `floating`，选择值保存在既有 `graph-4d.presentation-settings.v2`。
- **恢复边界**：新会话与新域节点使用默认模式；快照已有 `detailModes` 时恢复其显式记录，避免默认值覆盖历史状态。

## TDD 与验证

- **RED**：`node --test tests/spatial-demo-model.test.js tests/demo-engine-contract.test.js`
  - 41 通过、4 失败；失败原因是缺少 `defaultDetailMode` 与 `data-ui="settings"` 统一入口。
- **GREEN（模型/合同）**：同一命令最终 45 通过、0 失败。
- **浏览器旅程**：`npx playwright test tests/browser/mapping-layout-controls.spec.mjs -g "orbital settings" --reporter=list`
  - 1 通过；验证窗口、五区、选择 `surface` 后写入本地存储、重载恢复与 Esc 关闭。
- **布局回归**：同一文件的 `S interval changes` 与 `A child shrink` 两个既有旅程分别通过（均为 1 通过、0 失败）。
- **提交前检查**：`git diff --check` 无 diff 格式错误；GitNexus `detect_changes` 报告 7 个文件、低风险、无受影响流程。

## 残余风险

- **完整套件**：本任务按批准计划运行了焦点模型、合同和浏览器旅程；全量 `npm test` 留待 Task 4 的完整验收。
- **浏览器输出**：Playwright 运行时会显示 `NO_COLOR/FORCE_COLOR` 环境警告，未出现测试失败或产品运行警告。
