## Context

现有 Graph parser 已产生 `supportClauses`、事实端点 `antecedentPaths`、唤醒依赖 `dependencyPaths`、`then`、稳定 clause id 与 Program 判定结果；Spatial state 也已携带这些派生元数据。当前合同只投影单 clause 的 N→1 与 1→N；多入多出由 N→H 与 H→M 两项 clause 通过真实 H 组合，不生成原生 N→M 几何。参见 `proposal.md` 与 `specs/compound-push-projection/spec.md`。

## Goals / Non-Goals

**Goals:**

- 将 clause 规范化为可独立测试的事实端点、判定 Program、共享干线和有序分支计划。
- 用纯几何函数生成 1→1、N→1、1→N 的结点与分段，再由 Canvas 消费；N→H→M 由两项 clause 通过真实 H 连续呈现。
- 保留 clause identity、方向和当前可见团局部性。

**Non-Goals:**

- 不增加 Atom 轴、持久节点、边表、视觉坐标或应用默认值。
- 不改变 Program 的 strict-bool 执行合同，也不让普通端点提供 bool。
- 不允许原生 N→M，不隐藏或虚化真实枢纽 H。
- 不做关系驱动的全世界自动布局或通用 Canvas 重构。

## Decisions

### 使用 clause 角色而非名称或新事实分组

规范化器直接消费 `antecedentPaths` 作为普通事实前项，以 `dependencyPaths - antecedentPaths` 和 `root` 角色识别 `thing@program` 判定依赖；后项直接使用 `then` 及 `thenOrdinal`。这避免从布尔树反猜事实端点、避免名称猜组，也避免建立第二关系存储。替代方案是新增“复合推支 Thing”或第五轴，但会复制 clause 身份并违反最新合同。

### 将几何计算从 Canvas 绘制中分离

纯函数接收一个规范化 bundle 和当前可见端点屏幕坐标，返回 junction 与有向 segment：1→1 直连；N→1 在 0.5 汇合后直达真实 H 或普通后项；1→N 从真实 H 或普通前项直达 0.5 分叉。N→H→M 是两项独立几何，共享同一个真实 H 端点，不创造跨 clause 的隐藏干线。Canvas 只负责绘制、标签和命中身份。

### 显式 H 保持两段 50% 几何与两项身份

N→H 的 merge 与 H→M 的 split 分别记录 `ratio: 0.5`。两项 clause 在真实 H 处相接，H 继续显示并可选择；不得通过屏幕空间偏移伪造一个跨 clause trunk，也不得把两项 clause 合并为一个 identity。

### 只消费当前已渲染端点

`drawConnections` 先以当前 `renderedByGraphPath` 过滤 bundle；任一事实端点不可见即不计算该 clause。判定 Program 路径保留在 bundle metadata，但不要求作为视觉端点出现。该路径不会调用世界读取、Atom 写入或全域投影。

## Risks / Trade-offs

- **[复合表达中缺少普通前项]** → 对这种 clause 保留既有二元兼容路径或跳过复合几何，不伪造事实端点。
- **[显式 H 两侧几何重叠]** → 保持两项 clause 的身份和真实 H 命中优先级，不以隐藏 H 的方式消除重叠。
- **[重复绘制普通 supportRelations]** → 以 clause 派生的事实端点对屏蔽同一 bundle 的展开二元边，仅保留一项复合投影。
- **[浏览器测试被权威 state 覆盖]** → Chromium 用例拦截只读 state，以稳定脱敏 clause 和节点 ID 进入真实桥接/Canvas 链，并断言最终绘制快照而非内部常量。

## Migration Plan

无需事实迁移。部署后 Web 从同一 `supportClauses` 生成新派生几何；回退代码即可恢复旧绘制，Atom 事实和 revision 不变。
