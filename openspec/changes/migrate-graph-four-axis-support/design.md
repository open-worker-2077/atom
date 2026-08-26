# Context

Graph 语法跨 parser、事务、Program、CLI/Web、投影和模板。首版需要同时满足四轴统一、局部可读、方向明确与真实机制不被偷偷塞在线上。核心不变量是：support 规则的承载 Thing 必须参与规则；复杂聚合、分发、审核、反应或计算都必须有真实节点枢纽。

# Goals / Non-Goals

## Goals

- 四轴成为唯一活跃公开范式。
- owner 角色由 current modifier O(1) 决定。
- 1→N、N→1、1→1 与显式 `M→hub→N` 可精确读写。
- Program/业务机制保留在可见节点及既有 ABI。
- 迁移可备份、回退、守恒且不误改正文。
- 未升级持久编码能先进入可诊断兼容读取，而不是在初始化阶段失败；完成事务化编码升级后同一世界继续受控读写。
- Web/CLI/Help 展示真实 if→then 与枢纽。

## Non-Goals

- 首版不支持原生 M→N、无 owner-current 规则、线载源码/`satisfies`、support@program 或隐藏语义枢纽。
- 不重设槽体相对域、窗口策略、print 计划或需求总账。

# Decisions

## 1. 四轴闭集

每个节点恰有 `thing / situation / contain / support`。类型只修饰 `thing`。旧轴只在迁移读取器中出现，活跃 parser、Help 与错误不暴露两套语法。

## 2. owner-local support

规则字段闭集为 `if@current`、`if`、`then@current`、`then`。两个 modifier 若出现必须严格为 true；每条规则必须恰有一个 modifier：

- `if@current:true`：current 是隐式前件；允许 `if` 再提供外部条件，规范根为 current AND Expr。
- `then@current:true`：current 是隐式后件；允许 `then` 再提供外部后件。

两个 modifier并存返回 `CURRENT_ENDPOINT_ON_BOTH_SIDES`；两个都缺失返回 `SUPPORT_OWNER_CURRENT_REQUIRED`。显式 selector 指回 owner 返回 `CURRENT_ENDPOINT_REQUIRES_MODIFIER` 或 `DUPLICATE_CURRENT_ENDPOINT`。角色分类只做两个 `Object.hasOwn`，不扫描 if/then。

## 3. Expr 与基数门禁

if 缺省/空或恰有一个根 Expr。Expr 只允许 `{"thing":"selector"}`、`{"thing@program":"selector"}`、`{"and":[Expr,...]}`、`{"or":[Expr,...]}`；and/or 至少两个并按序短路。then 是保序、非空或由 then@current 补足的 thing/thing@program 引用数组。

规范形统计去重后的前件与后件端点。若两侧端点计数都大于 1，返回 `NATIVE_MANY_TO_MANY_SUPPORT_UNSUPPORTED`。允许 current+外部条件→单 current 后件，以及单 current 前件→多个后件；真正 M→N 必须拆为 M→hub 与 hub→N 两条 owner-local 规则。

## 4. 显式枢纽

聚合枢纽 H 上写入：

```json
{"if":[{"and":[{"thing":"A"},{"thing":"B"},{"thing":"C"}]}],"then@current":true}
```

分发仍写在 H：

```json
{"if@current":true,"then":[{"thing":"X"},{"thing":"Y"},{"thing":"Z"}]}
```

H 是真实 Thing，可被 Explore、锁、迁移、审计和 Web 命中。compiler 不生成 H，Web 不抹除 H。

## 5. Program 边界

`thing@program` 只在 if/then 端点引用上标识目标是 exact Program；RHS 必须是 selector，源码只在目标节点 situation。if 侧 Program 使用既有 `main(arguments)` 并必须 strict 返回 bool；本次求值若登记 transform、slot_body、lock、message 或 choice，返回 `PROGRAM_SUPPORT_EFFECT_FORBIDDEN` 且不发布。then 侧 Program 不由前件执行或写入；它按自身 trigger/use_program/显式 run 读取和计算。`satisfies`、内联代码与 support@program 返回 `SUPPORT_INLINE_PROGRAM_UNSUPPORTED`。

## 6. selector、索引与循环

selector 支持 exact 与 current-domain relative；槽例 `./` 绑定当前实例且不得越域。每条规则有稳定 id；dependency/endpoint 索引覆盖所有显式端点并引用唯一 owner 声明。事件与 Explore 使用索引，不扫描世界。循环图可被索引和显示，但任何调度沿用既有 Program/事务去重，不因 support 拓扑无限执行。

## 7. 投影与 Web

投影保留 rule id、owner/current side、Expr path、then ordinal 与 hub identity。Web 对 M→hub 画有序输入分支和共享线干，对 hub→N 在约 0.5 处分流；该位置仅影响视觉。视觉压缩必须保留可选取的 hub 节点与两条规则，箭头始终 if→then。

## 8. 迁移与回退

迁移先生成与 source revision/facts hash 绑定的可恢复备份，再通过受控事务改四个外层结构键：`name→thing`、`detail→situation`、`children→contain`、`partners→support`，并提交已由 AST 证明的 Program 结构 token edits。partners 数组整体原样搬入 support，绝不改写 `{verb,object}`、生成业务节点或猜作 if/then。节点数量、路径、contain 拓扑、类型后缀、非 Program situation bytes、Program 普通源码片段与业务计算、relation source/ordinal/字符/顺序必须全量守恒。

同一原子提交写入升级后的事实和内核拥有的 migration manifest。manifest 记录 source/target revision、facts hash 与 legacy-support 所在 exact path/ordinal；Program 升级审计留在 migration plan/receipt，不进入运行时授权 manifest。manifest 不是 Atom 业务节点。回退通过事务历史恢复事实、Program 原源码与对应 manifest 版本，不直接改 backing JSON。

manifest 不永久钉死迁移 revision。中央事务在每次事实提交时同步推进 `currentWorldRevision`：legacy-support 用迁移数组内容指纹与授权出现次数验证并延续，因此节点改名/移动不丢 provenance，显式 support 替换会减少资格。manifest 不含 Program ABI 授权；重启若 manifest revision 与事实不一致，legacy relation provenance fail closed，但 Program 始终只有新 ABI。

## 9. 存量读取与写入隔离

公开 parser 继续严格拒绝旧轴及 `{verb,object}` support item。仅持久 adapter 可在读取权威旧快照或 revision-bound manifest 命中的升级快照时识别 legacy 编码；兼容资格由存储来源授予，应用 JSON 形状本身不能伪造。

adapter 将旧外层键规范化为内核四轴，同时把受信 legacy-support entries 标注到不可枚举 provenance。查询/投影可呈现 verb/object 旧关系；support compiler/index 只消费 if/then clause。普通新四轴写入可修改 situation/contain/其他节点并保留 provenance；对某节点显式全文替换 support 才由应用动作清除该节点的 legacy entries。提交前 adapter 生成目标持久编码并由事务层计算/核对权威 revision，因此不会长期锁世界只读，也不会让第一笔写入暗中执行全世界迁移。

## 10. Program 聚类与一次性结构升级

typed `thing@backup@default` 只通过结构事实自动识别，其下 Program 从编译、调度、trigger 与显式 run/use_program 全部排除，并作为历史事实保留原源码字符。test 根仅由迁移调用方提供 exact selector 并绑定源修订；它用于报告分类而非永久隔离，域内可执行 Program 与活跃 Program 一样必须升级。

Python AST 先定位 Graph API 调用和 AtomView 数据来源，再生成只覆盖结构 token 的 source edits：`explore/transform` 首个 literal dict 的旧轴 key 映射为新轴；仅对可证明源自 `explore` 或 `current_atom` 的 AtomView 属性访问映射旧属性。普通字符串、注释、标识符、业务表达式和其他对象属性保持原字节。动态 key、字典展开、无法证明来源的旧属性访问或其他不能唯一等价转换的形态必须以 exact path/source hash/行列/原因阻断，不能猜测。

预检输出每个 Program 的 before/after source hash、逐项 edit 与 blocker。`readyToCommit` 仅在所有非备份可执行旧 ABI Program 都具有唯一升级结果且升级后 AST 复检不含旧 Graph ABI 时成立。升级源码与四轴外层结构在同一 revision-bound 事务提交，备份和 rollback 覆盖原源码。提交后 worker、Program runtime 与 manifest 均无 legacy ABI wrapper/授权；所有可执行 Program 只走新 ABI。

## 11. 全量预检与提交门禁

预检一次 DFS 同时产出世界结构计数、partner 完整清单、Program 调用清单、报告分类、目标编码守恒摘要和问题集合，不以异常实现首错退出。`readyToCommit` 只有在所有节点/路径/contain/relation 守恒、普通 situation 字节守恒、默认备份 Program 源码守恒、每个非备份旧 Program 均已唯一升级并复检为新 ABI、备份端口可用且 source revision 未漂移时为 true。任一 blocker 都携带 exact Program path/source hash/行列并关闭上线门禁。

apply 顺序固定为：只读预检 → 创建源 revision/facts hash 绑定备份 → 回读验证备份 → 再次核对 revision → 单次原子 commit → 四轴全量回读 → 记录 rollback target。任一步失败均不提交；rollback 仍走事务历史创建新审计修订。

# Risks / Trade-offs

- 显式枢纽增加节点数量，但换取局部可读、可审计和机制归属。
- 首版拒绝原生 M→N，避免预设计；后续只能基于真实生产涌现另开变更。
- Web 需处理视觉压缩与真实节点同时存在，命中测试必须锁定身份。
- 一次性 Program source upgrader 需要保守数据流证明；宁可精确阻断少量歧义 Program，也不在正式内核保留双 ABI 或猜测业务语义。
- legacy-support 可与新 clause 共存，查询展示需区分两类关系；索引测试必须证明 legacy entry 永不进入推理。

# Open Questions

无。首版 owner-local 与显式枢纽边界已裁定。
