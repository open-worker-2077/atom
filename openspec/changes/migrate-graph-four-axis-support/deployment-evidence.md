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

## Bound primary preflight after first integration-ready candidate

- **source revision**：`sha256:ef95262283496ebb45b367acf41dd8dabf8af9d020dd71fa465609f3faeed5b7`。
- **source file hash**：`sha256:063ec948a99bf24f4353e8aa1c688275a30a0a030ede7367ce5b25f2b83374c2`。
- **Program 门禁**：93 个 Program；47 个 legacy ABI，其中5个 default backup、42个可执行；18个已升级、24个阻断，`readyToCommit=false`，未停服、未备份、未写入。
- **阻断聚类**：以 `dynamic-graph-key` 为主，另含 `dynamic-graph-specification` 与 `unproven-retired-attribute`。逐项 exact path/source hash/行列由绑定 planner 报告保管，不进入通用 spec。
- **分类接线缺陷**：部署脚本曾将 `isolatedRoots` 传给只接收 `testRoots` 的 operation，导致36个 test 被脚本误报为 active；直接 planner 使用 `testRoots` 时分类正确。本轮须以隔离 fixture 红测修复。
- **专项修复进度**：部署脚本参数贯通和三类 AST 证明均已红绿验证；复合旧轴固定前缀、局部 Dict/List specification、推导式/For AtomView 及注册 `direct_children` 身份传播的聚焦测试共19/19通过，真正动态前缀仍阻断。真实同 revision 复验尚未执行，不能据此提前改写24项实际结论。
- **第二次绑定复验**：同一 revision/fileHash 下，增强的点式旧轴识别把 legacy ABI 完整库存从47补正为50（5 default backup + 45 executable），没有新增或复制 Program；42个 executable 已升级，3个 active 仍阻断。新增3项来自此前漏识别的点式旧轴 Program，故旧报告47与新完整报告50的差额守恒。剩余结构已定位为同一 module-level If body 的单赋值/单key消费，以及 List specification 除 For.iter 外仅用于 `len(updates)` 的只读计数；本轮已补红绿测试，等待第三次同 revision 复验。

## Integration-ready candidate evidence

- **大型合成预检**：1,621 节点、3,000 条 legacy relation、120 个旧 ABI Program；120 个均生成 AST 证明的 source edits，`blockedPrograms=[]`，未把任何实例数量硬编码进内核。
- **结构守恒**：旧 relation 的 source/ordinal/verb/object 字符与顺序保持；Program 注释、普通字符串、业务对象属性保持；默认备份 Program 源码 hash 不变。
- **聚焦组合**：四轴迁移、Program runtime、槽体相对域、jump/changed、window self-lock、事务与投影 157/157 通过。
- **最终迁移专项**：加入转换后旧 ABI 残留复检后，迁移与部署专项 21/21 通过。
- **Node 全量**：1,107/1,107 通过；本轮只执行一次全量。
- **变更影响**：GitNexus `detect_changes` 标记世界投影、Program worker 与事务迁移主链为 critical；上述组合与全量覆盖这些受影响链，未发现断言红灯。
- **真实 primary 结论**：当前仍为 `closed`，因为总控库存清单不含源码、revision 与 facts hash；排他预检必须返回 42 个可执行旧 ABI Program 的逐项升级结果和 `blockedPrograms=[]`，否则不得上线。
