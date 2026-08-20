## Why

Atom 当前只在进入交互窗口时显示 `boundary~preview`；普通 `explore` 沿坐标移动后只返回已展开节点，调用方无法区分“路径已结束”和“视野之外仍有节点”。这会使沿路寻找在中途失去边界感知，并把局部未见误判为全局不存在。

## What Changes

- 每个成功且唯一命中的普通 `explore` 查询项都返回与当前锚点和本轮坐标范围对应的边界预览。
- 边界预览按 `up`、`down`、`left`、`right` 给出未返回的可见节点数、预计字符数和 `hasMore`。
- 视野外方向包含受保护节点时，不以零冒充不存在；该方向明确标记为 `protected`，并且不泄露受保护节点的名称、正文或精确数量。
- CLI Graph-JSON 和 Web 原始查询回执投影同一份查询层边界数据；`explore()` 的既有匹配节点内容及 Program 列表返回保持兼容。
- Help 说明边界回执会随每次 `explore` 更新，沿路寻找不需要其他函数发明游走语法。

## Capabilities

### New Capabilities

- `explore-boundary-preview`: 普通 Explore 在每次坐标扩展后提供安全、可更新的视野外节点与字符预估。

### Modified Capabilities

无。仓库目前没有已归档的主规格；本变更以新的 Explore 边界能力描述增量。

## Impact

- `work-engine/atom-language/query-capability.mjs` 的查询结果契约与坐标边界计算。
- `work-engine/atom-language/cli.mjs` 的 Graph-JSON Explore 投影及 Help。
- CLI、查询引擎、访问保护和 Program Explore 兼容测试。
