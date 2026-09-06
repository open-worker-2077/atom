# ASDF 视角退役与恢复清单

## 退役边界

- **当前状态**：S 外围、D 层级、独立 F 沉浸及节点右键双击沉浸已从活动输入合同退役；当前结构视角只保留 A。
- **能力保留**：退役的是独立入口和重复模式。普通向内剖开、沉浸进入、真实 owner route、domain frame 与 A 子层缩小仍在当前实现中。
- **恢复锚点**：带注释标签 `pre-a-mode-consolidation-20260904` 指向提交 `f2d2fd083329e0c145248988f16fb722a1b4c085`；标签对象本身为 `1981102d559645f21f0d1a8ea9d78983f6894b5f`。
- **封存含义**：清单提供可查看、可分支恢复的历史坐标，不代表删除历史文件，也不授权覆盖当前工作树。

## 入口替代

- **S 外围**：基线提交 `d1ba5c58a1721f5903b7efc9bcc033e3f8547c93` 中，`KeyS → setPeripheralView → peripheral` 是独立外围模式；`b1bff98fe016c6a4edab63813eb77bea5078a3d8` 将结构视角收敛为 A。当前由 A 节点右键短按触发 `applyInwardView`，在普通向内剖开时保留团外上下文。
- **D 层级**：同一基线中的 `KeyD → setHierarchyView → hierarchy` 是独立层级投影；`b1bff98fe016c6a4edab63813eb77bea5078a3d8` 退役该入口。当前层级由 A 的嵌套节点团与域路径表达，不再维护另一套投影模式。
- **独立 F**：基线中的 `KeyF → setImmersiveView → immersive` 是独立沉浸模式；`6f6f833793528b73e4f4316cc44d88e76f36c0e2` 加入沉浸子域 framing，`22aca26196eeffafa4033d5f9c03f4ea90d0fcb6` 修正真实 owner route，`b1329628b89b721380ef326e9f16d1341d432d52` 将能力并入 A 导航。
  - **当前手势**：`a38d73974f10be0795b4807bc8aaa534119ff950` 以 A 节点右键长按提供沉浸；`d2c02345096a7bb5a6ac2d744d304d00978cc686` 修正延迟计时器达到阈值后先松键的边界。
- **旧双击**：`07b55b591423870845835e06726600922146c889` 曾用右键双击仲裁 A 入口；长按提交 `a38d739` 与 `d2c0234` 取代节点双击沉浸。当前节点右键双击只按短按序列处理，不晋升沉浸；空白右键双击仍只返回一层。

## 保留合同

- **路由所有权**：`spatial-engine.js` 的 `buildDirectDomainRoute`、`buildImmersiveDomainRoute` 继续从可见节点的真实 owner path 构造目标域；不得因函数名含 `Immersive` 而删除。
- **域内构图**：`spatial-view-mode-model.js` 的 `clusterDomainFrame` 与 `immersiveDomainFrame` 继续分别支持 A 普通剖开和长按进入后的相机构图。
- **子层缩小**：`spatial-cluster-field.js` 的 `peripheralDepthShrinkPercent` 是沿用的历史变量名，当前仍驱动 A 子层缩小；`index.html` 将它作为 A 设置展示，不能按旧 S 名称误判为废代码。
- **长按设置**：`input-config.js` 的 `nodeHoldSecondary → applyImmersiveInwardView` 与共同设置 `secondaryNavigationDelayMs` 是当前桌面、移动端共用的有效合同。
- **其余边界**：Graph 事实、Transform 动作、Program 执行与权限边界不因视角入口收敛而改变。

## 源码坐标

- **标签查看**：旧输入映射位于标签版本的 `input-config.js`，旧模式集合位于 `spatial-view-mode-model.js`，旧 dispatch 与导航实现在 `spatial-engine.js`，旧帮助与设置入口位于 `index.html`。
- **当前实现**：活动入口位于 `input-config.js`；A 普通剖开、长按沉浸与 owner route 位于 `spatial-engine.js`；相机 framing 位于 `spatial-view-mode-model.js`；子层几何位于 `spatial-cluster-field.js`。
- **测试坐标**：`tests/browser/atom-web-critical-journeys.spec.mjs` 通过真实右键短按、长按、空白返回保存关键旅程；`tests/browser/presentation-settings.spec.mjs` 通过真实输入保留普通剖开的边界描画、共同设置继承与合法零值持久化。

## 安全恢复

- **只读核对**：运行 `git show pre-a-mode-consolidation-20260904:input-config.js` 或 `git show --stat pre-a-mode-consolidation-20260904` 查看历史，不改变当前分支。
- **建立分支**：运行 `git branch recover/asdf-modes pre-a-mode-consolidation-20260904` 从标签建立恢复分支；不得用 `git reset` 覆盖当前工作树。
- **隔离检出**：需要运行历史版本时，在安全的新目录执行 `git worktree add <new-worktree-path> recover/asdf-modes`，使恢复实验与当前候选隔离。
- **恢复评审**：恢复旧入口时同时评估 A 当前短按/长按合同、共同阈值设置、owner route 与 domain frame；不得仅复制旧按键 dispatch。

## 验收状态

- **候选范围**：本清单随 A 模式整合候选提交，记录的是代码候选状态；最终 Node 全量与正式公共入口浏览器回读由后续任务完成。
- **证据原则**：Task5 同 revision 的短按、长按、阈值松开、空白单层返回、共同设置与移动控制面板证据可复用；Task6 只补充旧 F 准备迁移后的互补旅程。
- **保全要求**：旧旅程的视口、移动回执、权威事实、F5、回滚、边界描画及合法零值结果不得因输入替换而放宽。
