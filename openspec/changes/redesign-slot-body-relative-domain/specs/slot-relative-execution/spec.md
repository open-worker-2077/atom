## Purpose

让同一份槽模 Program 以当前域相对角色读取和改变候选槽模或任一槽例，并把 support 事件精确路由到所属槽例，避免绝对实例路径、全实例扫描和跨域串料。

## ADDED Requirements

### Requirement: Program 使用当前域相对选择器
相对域 Program SHALL 以 `name:"."` 选择当前 `scope_root`，以 `name:"./段/段"` 从 `scope_root` 逐层选择直接下级；每段 SHALL exact 匹配且不得包含空段、`.`、`..`、反斜线或绝对路径。研发态运行 SHALL 将候选槽模绑定为 `scope_root`，实例态运行 SHALL 将本次槽例根绑定为 `scope_root`，因此同一 Program 源码无需路径转换。

#### Scenario: 同一源码在研发态与实例态读取对应槽
- **WHEN** 候选槽模 Program 和封装后的共享 Program 都执行 `explore({"name":"./客户","detail$full":true})`
- **THEN** 研发态返回候选槽模的 `客户`，实例态返回当前槽例的 `客户`，Program 源码保持逐字相同

#### Scenario: scope 未绑定时拒绝相对选择
- **WHEN** 相对域 Program 执行时无法确定候选槽模或所属槽例
- **THEN** 系统返回 `SLOT_SCOPE_ROOT_UNBOUND`，不回退到名称全局搜索

#### Scenario: 绝对实例路径不替代相对域
- **WHEN** 已绑定 scope 的 Program 以绝对路径读取或改造槽数据
- **THEN** 系统返回 `SLOT_RELATIVE_SELECTOR_REQUIRED`，不允许借绝对实例路径越过当前域

### Requirement: 相对解析遵守 contain 与嵌套槽体边界
相对选择 SHALL 沿当前域内真实 contain 逐段解析，普通嵌套槽不形成额外边界；若路径进入另一个已封装槽体的槽例根，系统 SHALL 把该根视为嵌套域边界并拒绝继续向内。每段零命中 SHALL 返回 `SLOT_RELATIVE_TARGET_NOT_FOUND`，同一父项下多命中 SHALL 返回 `SLOT_RELATIVE_TARGET_AMBIGUOUS`，越界 SHALL 返回 `SLOT_SCOPE_BOUNDARY_CROSSING`。

#### Scenario: 普通嵌套槽可以相对访问
- **WHEN** 当前槽例包含 `./客户/地址/城市` 的普通 contain 链且每段唯一
- **THEN** 系统精确返回当前槽例内的城市槽，不查询其他槽例中的同名城市

#### Scenario: 嵌套槽体内部不可穿透
- **WHEN** 相对路径抵达当前域内另一个槽体的槽例根后仍请求其下级
- **THEN** 系统返回 `SLOT_SCOPE_BOUNDARY_CROSSING`，调用方必须由该嵌套槽例自己的执行上下文运行其 Program

#### Scenario: 同名歧义不择一执行
- **WHEN** 任一相对路径段在同一 contain 父项下命中多个同名节点
- **THEN** 系统返回 `SLOT_RELATIVE_TARGET_AMBIGUOUS` 并列出域内候选相对路径，不按遍历顺序任选一个

### Requirement: support 事件只触发所属槽例计算
封装 SHALL 把槽模局部 support 推线编译为以相对槽角色索引的触发计划。实例节点发生事件时，系统 SHALL 先通过局部路径索引定位唯一所属槽例，再求事件源的相对角色，只查询该槽体当前修订的局部 support 计划；仅当 support 来源、目标 Program 和条件均命中时，系统 SHALL 以该槽例为 `scope_root` 运行目标共享 Program。

#### Scenario: 一个实例事件只改变本实例
- **WHEN** 两个槽例具有相同角色结构而其中一个槽例的来源槽发生命中 support 的事件
- **THEN** 系统只运行一次共享目标 Program，读写均绑定事件所属槽例，另一个槽例和无关世界保持不变

#### Scenario: 未命中 support 条件不执行 Program
- **WHEN** 事件节点属于槽例但其相对角色没有命中当前修订的局部 support 条件
- **THEN** 系统不运行目标 Program，也不扫描其他实例寻找可能匹配项

#### Scenario: 事件角色与实例结构不一致时拒绝
- **WHEN** 事件节点无法映射到所属槽例采用修订中的唯一相对角色
- **THEN** 系统返回 `SLOT_SCOPE_ROLE_MISMATCH`，不猜测同名角色或跨实例执行

### Requirement: v1 计算不探索当前槽例域外数据
v1 相对域计算 SHALL 只读取和改造当前槽例内的映射槽与本地料 Thing，并可调用同一槽模中的共享 Program 代码；被调用 Program SHALL 继承同一 `scope_root`。系统 SHALL NOT 提供跨槽例选择、外部共享资料直读或 PowerPivot 式 `FILTER`／`SUM` 聚合。外部变量需要参与计算时，槽体外编排 SHALL 先将其值物化为目标槽例指定槽下的未映射本地料 Thing，再触发该槽例；槽模 Program 仍仅使用 `./` 相对选择器读取。

#### Scenario: 被复用 Program 继承当前实例域
- **WHEN** 一个共享 Program 通过 `use_program()` 调用同槽模中的另一个 Program
- **THEN** 被调用 Program 的 `./…` 仍解析到原事件所属槽例且不能切换到其他实例

#### Scenario: 跨槽例聚合请求被拒绝
- **WHEN** Program 试图从当前槽例枚举兄弟槽例或提交跨实例聚合选择器
- **THEN** 系统返回 `SLOT_SCOPE_BOUNDARY_CROSSING` 或 `SLOT_RELATIVE_SELECTOR_REQUIRED`，不提供隐式世界扫描

#### Scenario: 外部变量先本地物化再触发
- **WHEN** 槽体外编排把变量值写成槽例 A 指定槽下的本地料 Thing，随后触发槽例 A 的映射来源槽
- **THEN** 共享 Program 以 `./` 读取该本地料并只计算槽例 A，槽例 B 不执行且槽模不主动读取域外变量节点
