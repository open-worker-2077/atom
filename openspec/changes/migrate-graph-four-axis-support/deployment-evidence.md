# Primary read-only deployment evidence

## Evidence identity

- **来源**：总控提供的 primary 世界只读预检清单。
- **数据操作**：本专项未读取、写入或启动共享 4784，也未触碰正式 Atom/ESG。
- **source revision**：未随清单提供。
- **facts hash**：未随清单提供。
- **执行门禁**：`closed`。以下库存可用于评估覆盖面，不能单独授权迁移提交；排他部署前必须在同一只读快照重跑 planner，并绑定 source revision 与 facts hash。

## Reported inventory

- **节点**：11,038。
- **legacy partners**：706 条，分布于 578 个节点。
- **Program**：93 个。
- **旧 Graph ABI Program**：47 个。
  - typed default backup：5 个。
  - 调用方 exact test 分类域：36 个；新版要求逐项升级后按新 ABI 执行，不再隔离兼容。
  - 活跃非 test：6 个。

## Current upgrade gate

- **Program 规则**：5 个 typed default backup Program 可作为不可执行历史事实保留原源码；36 个 exact test 与 6 个活跃 Program 必须取得 AST 证明的一次性新四轴升级结果。manifest 不授予 Program 兼容资格，正式 runtime 无 legacy wrapper。
- **阻断规则**：动态 Graph specification/key、dict unpack、无法证明来源的旧 AtomView 属性、语法错误或升级后仍残留旧 ABI，均须按 exact path/source hash/行列列出并令 `readyToCommit=false`。
- **待重采样证据**：现有清单未含 47 个 Program 的源码与 source revision/facts hash，因此不能声称其中 42 个可自动升级，也不能形成精确 blocker 清单。
- **部署前动作**：总控排他读取 primary → 生成 revision/hash 绑定报告与逐 Program edits/blockers → 核对库存与字符守恒 → 验证备份 → 仅在门禁全绿时执行原子编码及 Program 调用升级。

## Integration-ready candidate evidence

- **大型合成预检**：1,621 节点、3,000 条 legacy relation、120 个旧 ABI Program；120 个均生成 AST 证明的 source edits，`blockedPrograms=[]`，未把任何实例数量硬编码进内核。
- **结构守恒**：旧 relation 的 source/ordinal/verb/object 字符与顺序保持；Program 注释、普通字符串、业务对象属性保持；默认备份 Program 源码 hash 不变。
- **聚焦组合**：四轴迁移、Program runtime、槽体相对域、jump/changed、window self-lock、事务与投影 157/157 通过。
- **最终迁移专项**：加入转换后旧 ABI 残留复检后，迁移与部署专项 21/21 通过。
- **Node 全量**：1,107/1,107 通过；本轮只执行一次全量。
- **变更影响**：GitNexus `detect_changes` 标记世界投影、Program worker 与事务迁移主链为 critical；上述组合与全量覆盖这些受影响链，未发现断言红灯。
- **真实 primary 结论**：当前仍为 `closed`，因为总控库存清单不含源码、revision 与 facts hash；排他预检必须返回 42 个可执行旧 ABI Program 的逐项升级结果和 `blockedPrograms=[]`，否则不得上线。
