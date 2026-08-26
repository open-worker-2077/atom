# Why

Atom 的 Graph 公开范式仍散落着 `name / detail / children / partners` 与多套关系解释。项目已裁定活跃 Graph 仅有 `thing / situation / contain / support` 四轴，并进一步确认首版 support 必须是可局部阅读的显式有向连接：每条规则都必须包含其承载 Thing，复杂作用由真实可见的枢纽 Thing/Program 承载，不得藏在线或隔壁节点的声明中。既有 primary 世界含 legacy partners 与旧 Graph ABI Program；若新运行时把活跃写入门禁直接用于存量读取，会在迁移能力可用前启动失败，因此本变更还必须提供可部署的兼容读取、全量预检和受控迁移闭环。实例数量只记录在 source revision/facts hash 绑定的 deployment evidence，不进入通用内核契约。

# What Changes

- 将活跃 Graph 统一为 `thing / situation / contain / support`，关闭旧四轴公开入口。
- `support` 是规则数组；规则只允许 `if@current:true`、`if:[根 Expr]`、`then@current:true`、`then:[thing refs]`。
- `if` 永远是前件、`then` 永远是后件；每条规则必须且只能含一个 current modifier，compiler 在递归内容前 O(1) 确定 owner 角色。
- Expr 只含 `thing` 普通端点、`thing@program` Program 端点与至少两个有序子 Expr 的 `and/or`。两种 RHS 都只是 selector；`satisfies`、内联代码及任何线载复杂作用首版稳定拒绝。
- 允许 1→N（写在起点）、N→1（写在终点）与 1→1；禁止单条原生 M→N。M→N 必须显式规范化为 `M→单枢纽→N`，复杂机制使用多个串联枢纽。
- 枢纽可为普通 `thing` 或 exact `thing@program` 节点；Program 源码仍在节点 `situation` 并使用既有 Program ABI。前件 Program 只返回 strict bool 决定规则是否成立且不得发出效果；后件 Program 由自身负责读取/计算。support 只传递是否支撑。
- 为每条 owner-local 规则建立端点查询索引，Explore 可从相关端读取声明，但 atom.json 不复制规则。
- Web 渲染真实枢纽、汇流、线干和分流；可视觉压缩，不得隐藏或伪造语义枢纽。
- 存量旧世界由版本化持久 adapter 读取；原地升级只改四个外层结构键，运行时可继续受控读写，普通 parser、Help 和所有新输入仍只接受新四轴。
- 预检一次遍历全世界并完整聚类默认备份仓、显式 test 隔离域、活跃 Program 与 legacy partners，不在首个阻断处退出。
- 旧 partners 只做外层键 `partners→support`，内部 `{verb,object}` 字符与顺序不动；受信快照 adapter 将其作为 legacy-support entry 查询/展示，但不解释为 if/then、不进入新 support 推理索引。
- 旧 Program 源码逐字保留；revision-bound manifest 以 exact path + source hash 授予内部 legacy ABI wrapper，映射旧 Graph 调用和 AtomView。源码变化、新建 Program 或 manifest/revision 漂移后不继承兼容资格。
- 迁移必须先验证 revision-bound 完整备份，再经单次原子事务提交结构编码与 manifest；回退不覆盖历史。升级后新 support 与受信 legacy relation 可同世界共存但语义索引严格隔离。
- 更新 parser、Transform、Explore、Program AtomView、投影、CLI、Web、Help、模板、错误码与回归。

# Capabilities

- `graph-four-axis-language`: 四轴、owner-local support、显式枢纽与错误契约。
- `graph-program-support`: 可见 Program 枢纽与既有 Program ABI 的边界。
- `graph-four-axis-migration`: 可恢复、保守、事务化的旧四轴迁移。
- `graph-support-spatial-visualization`: 真实枢纽的方向连接与可视化。

# Impact

影响 Graph parser/schema、持久快照兼容 reader、Atom key parser、语言 receiver/engine、Transform/Explore、Program runtime/AtomView、投影与 spatial model、Web 编辑、Help/registry、模板、预检/迁移工具和自动测试。不得修改业务 Atom/ESG，不得写共享 4784。
