# graph-four-axis-language Specification

## Purpose

建立唯一四轴与 owner-local 的有向 support 语言。

## ADDED Requirements

### Requirement: Graph 只有四轴
活跃 Graph 节点 MUST 恰有 thing、situation、contain、support。name、detail、children、partners MUST NOT 作为活跃轴；类型只修饰 thing。

#### Scenario: 旧轴进入活跃入口
- **WHEN** parser、CLI 或 Program Transform 收到任一旧轴
- **THEN** 返回 `RETIRED_GRAPH_AXIS` 且不写入

### Requirement: 每条规则恰有一个 current owner
support rule MAY 只含 if@current、if、then@current、then。if@current/then@current 若存在 MUST 严格为 boolean true。每条 rule MUST 恰有一个 current modifier。

#### Scenario: current 起点 1→N
- **WHEN** A 声明 `{"if@current":true,"then":[{"thing":"B"},{"thing":"C"}]}`
- **THEN** 建立 A→B/C 且保持 then 顺序

#### Scenario: N→current 终点
- **WHEN** H 声明 `{"if":[{"and":[{"thing":"A"},{"thing":"B"}]}],"then@current":true}`
- **THEN** 建立 (A∧B)→H

#### Scenario: owner 缺失
- **WHEN** rule 同时缺少 if@current 与 then@current
- **THEN** 返回 `SUPPORT_OWNER_CURRENT_REQUIRED`

#### Scenario: owner 在两侧
- **WHEN** rule 同时含 if@current 与 then@current
- **THEN** 返回 `CURRENT_ENDPOINT_ON_BOTH_SIDES`

### Requirement: owner 角色 O(1) 建立
compiler MUST 在访问 if/then 内容前只用两个 modifier 确定 current side，不得扫描 Expr、then、`.`、短名或位置推断 owner。

#### Scenario: 大型内容不参与分类
- **WHEN** Proxy 在读取 if/then 时抛错但暴露一个 current modifier
- **THEN** owner 分类成功且不访问内容

### Requirement: Expr 与结果闭集
if MUST 缺省/空或恰有一个根 Expr。Expr MUST 精确为 thing endpoint、thing@program endpoint、and 或 or；and/or MUST 至少两个有序子项并按序短路。then MUST 为保序 thing/thing@program 引用数组。两种 RHS 都 MUST 是 exact/current-domain selector；槽例 relative 不得跨实例。

#### Scenario: 线载源码被拒绝
- **WHEN** thing@program RHS 含 satisfies/代码而不是 selector，或使用 support@program
- **THEN** 返回 `SUPPORT_INLINE_PROGRAM_UNSUPPORTED`

#### Scenario: 复合顺序
- **WHEN** Expr 为 A and (B or C)
- **THEN** 保持嵌套和 ordinal，并按序短路

### Requirement: 首版禁止原生 M→N
规范形前件与后件端点数若同时大于一，MUST 返回 `NATIVE_MANY_TO_MANY_SUPPORT_UNSUPPORTED`。系统 MUST NOT 自动生成、隐藏或猜测枢纽。

#### Scenario: 3→3 被拒绝
- **WHEN** X 上尝试声明 (A∧B∧C)→(X,Y,Z)
- **THEN** 拒绝并建议显式 `M→hub→N`

#### Scenario: 显式枢纽通过
- **WHEN** H 上分别声明 (A∧B∧C)→H 与 H→(X,Y,Z)
- **THEN** 两条 owner-local rule 均通过且 H 是真实可查询 Thing

### Requirement: current 不得靠 selector 偷渡
显式 selector 指回 owner MUST 被拒绝并要求对应 modifier；current 不得重复或落入两侧。

#### Scenario: 点 selector 偷渡
- **WHEN** if/then 内使用 `{"thing":"."}` 指回 owner
- **THEN** 返回 `CURRENT_ENDPOINT_REQUIRES_MODIFIER`

### Requirement: 明确方向且不推导逆命题
公开 Graph/Help/错误 MUST NOT 使用 reverse、reversed、converse、incoming、inbound 或 consequent modifier。P→Q MUST NOT 自动产生 Q→P。

#### Scenario: 双向事实
- **WHEN** P→Q 与 Q→P 都成立
- **THEN** 分别在 P、Q 持久化两条 if@current rule

### Requirement: 单份 owner 声明与查询索引
每条 rule MUST 只持久化在 owner 的 support 中。compiler SHALL 建 endpointRef→ruleId/side 索引，使相关端 Explore 可找到同一 rule id，但不得复制 atom.json 声明。

#### Scenario: 从外部端查询
- **WHEN** 从 A 或 H Explore A→H 的规则
- **THEN** 两端命中同一 owner rule id 且持久数据只有 H 上一份声明

### Requirement: 所有消费者共享契约
Transform、Explore、Program AtomView、投影、CLI/Web、Help、Form、工单与槽体 SHALL 使用同一四轴、owner、Expr、selector 与错误契约；既有窗口锁、trigger 和加载能力不得静默删除。

#### Scenario: CLI round-trip
- **WHEN** CLI 写入并回读显式 hub 两条规则
- **THEN** current modifier、and/or 与数组顺序逐字符结构等价
