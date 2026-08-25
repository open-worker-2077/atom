# Context

Graph 语法跨 parser、事务、Program、CLI/Web、投影和模板。首版需要同时满足四轴统一、局部可读、方向明确与真实机制不被偷偷塞在线上。核心不变量是：support 规则的承载 Thing 必须参与规则；复杂聚合、分发、审核、反应或计算都必须有真实节点枢纽。

# Goals / Non-Goals

## Goals

- 四轴成为唯一活跃公开范式。
- owner 角色由 current modifier O(1) 决定。
- 1→N、N→1、1→1 与显式 `M→hub→N` 可精确读写。
- Program/业务机制保留在可见节点及既有 ABI。
- 迁移可备份、回退、守恒且不误改正文。
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

迁移先生成带哈希 manifest 的可恢复备份，再通过受控事务转换 name/detail/children。空 partners 转空 support；非空 partners 因 verb/object 无无损结构映射而以 `UNMAPPABLE_LEGACY_SUPPORT_RELATION` 阻断并原样报告字符、ordinal 与路径。禁止脚本直改 backing JSON、正文字符串替换或部分提交。

# Risks / Trade-offs

- 显式枢纽增加节点数量，但换取局部可读、可审计和机制归属。
- 首版拒绝原生 M→N，避免预设计；后续只能基于真实生产涌现另开变更。
- Web 需处理视觉压缩与真实节点同时存在，命中测试必须锁定身份。

# Open Questions

无。首版 owner-local 与显式枢纽边界已裁定。
