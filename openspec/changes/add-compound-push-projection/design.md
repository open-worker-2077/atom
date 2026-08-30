## Context

现有 Graph parser 已产生 `supportClauses`、事实端点 `antecedentPaths`、唤醒依赖 `dependencyPaths`、`then`、稳定 clause id 与 Program 判定结果；Spatial state 也已携带这些派生元数据。缺口位于 Web 规范化和 Canvas 几何：当前实现仍从布尔表达树生成嵌套结点，并用固定的双结点小段近似所有复合形态，不能精确区分 N→1、1→N 和 N→M。参见 `proposal.md` 与 `specs/compound-push-projection/spec.md`。

## Goals / Non-Goals

**Goals:**

- 将 clause 规范化为可独立测试的事实端点、判定 Program、共享干线和有序分支计划。
- 用纯几何函数生成 1→1、N→1、1→N、N→M 的结点与分段，再由 Canvas 消费。
- 保留 clause identity、方向和当前可见团局部性。

**Non-Goals:**

- 不增加 Atom 轴、持久节点、边表、视觉坐标或应用默认值。
- 不改变 Program 的 strict-bool 执行合同，也不让普通端点提供 bool。
- 不做关系驱动的全世界自动布局或通用 Canvas 重构。

## Decisions

### 使用 clause 角色而非名称或新事实分组

规范化器直接消费 `antecedentPaths` 作为普通事实前项，以 `dependencyPaths - antecedentPaths` 和 `root` 角色识别 `thing@program` 判定依赖；后项直接使用 `then` 及 `thenOrdinal`。这避免从布尔树反猜事实端点、避免名称猜组，也避免建立第二关系存储。替代方案是新增“复合推支 Thing”或第五轴，但会复制 clause 身份并违反最新合同。

### 将几何计算从 Canvas 绘制中分离

纯函数接收一个规范化 bundle 和当前可见端点屏幕坐标，返回 junction 与有向 segment：1→1 直连；N→1 在 0.5 汇合后直达后项；1→N 从前项直达 0.5 分叉；N→M 的汇合点和分叉点都以 0.5 作为归一化语义位置，共享干线仅通过对称的屏幕空间偏移保持可见。Canvas 只负责绘制、标签和命中身份。替代方案是在 `drawConnections` 内继续分支计算，但难以用手算坐标验证且容易把内部模型测试成假绿。

### N→M 的两个 junction 都锚定 50%

N→M 的 merge 与 split 均记录 `ratio: 0.5`，不得用 0.4/0.6 改写默认 50% 合同。为避免二者落在同一像素而令共享干线消失，渲染几何沿输入中心到输出中心的方向，在 0.5 中心两侧施加对称、受线长约束的最小屏幕像素偏移；该偏移不进入事实、clause 或归一化语义。N→1 与 1→N 的单一 junction 同样精确记录 0.5。

### 只消费当前已渲染端点

`drawConnections` 先以当前 `renderedByGraphPath` 过滤 bundle；任一事实端点不可见即不计算该 clause。判定 Program 路径保留在 bundle metadata，但不要求作为视觉端点出现。该路径不会调用世界读取、Atom 写入或全域投影。

## Risks / Trade-offs

- **[复合表达中缺少普通前项]** → 对这种 clause 保留既有二元兼容路径或跳过复合几何，不伪造事实端点。
- **[N→M 端点中心重合导致零长度]** → 使用确定性的最小轴向退化处理，保证共享干线仍可辨。
- **[重复绘制普通 supportRelations]** → 以 clause 派生的事实端点对屏蔽同一 bundle 的展开二元边，仅保留一项复合投影。
- **[浏览器测试被权威 state 覆盖]** → Chromium 用例拦截只读 state，以稳定脱敏 clause 和节点 ID 进入真实桥接/Canvas 链，并断言最终绘制快照而非内部常量。

## Migration Plan

无需事实迁移。部署后 Web 从同一 `supportClauses` 生成新派生几何；回退代码即可恢复旧绘制，Atom 事实和 revision 不变。
