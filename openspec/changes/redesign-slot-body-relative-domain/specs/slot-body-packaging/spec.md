## Purpose

让使用方把一棵普通、可单次自运行的候选 DataFlow 原子封装为可一对多打印的槽体，同时以可见 Program 保存完整生成计划，消除人工预建空槽例和复制共享 Program 的负担。

## ADDED Requirements

### Requirement: 普通候选 DataFlow 原子封装为槽体
封装前，目标槽体 SHALL 是只直接包含一棵候选 DataFlow 的普通 Graph 容器；候选 DataFlow SHALL 能以自身作为当前域单次运行。上层 Program 调用 `slot_body({"action":"seal","body":"EXACT槽体路径"})` 后，系统 SHALL 在一个事务中保留同一棵候选逻辑为唯一直接下级 `槽模`，并生成唯一直接下级 `print@program` 与唯一直接下级 `槽例` 容器。系统 SHALL NOT 要求使用方预建任何同构空槽例。

#### Scenario: 候选 DataFlow 完成首次封装
- **WHEN** 槽体只直接包含一棵含普通槽、嵌套 contain、support 推线和正常 Program 的候选 DataFlow
- **THEN** 封装后槽体恰好直接包含 `槽模`、`print@program` 和 `槽例`，候选逻辑成为 `槽模` 且 `槽例` 初始可以为空

#### Scenario: 旧空槽例布局不再充当封装输入
- **WHEN** 调用方提交依赖 `槽例/空槽例` 复制母版的旧二分布局
- **THEN** 系统以 `INVALID_SLOT_BODY_LAYOUT` 拒绝，不读取空槽例作为权威定义且不部分改造布局

### Requirement: print Program 显式承载完整生成计划
系统 SHALL 从封装时槽模的最新事实生成确定性、可回读的 print 计划，并把当前完整计划及其修订标识保存在 `print@program` 的可见 Graph 内容中，而不是只存在运行时缓存。计划 SHALL 枚举全部非 Program 抽象槽角色、嵌套 contain、局部 support 关系、类型及槽的说明／契约元数据；计划 SHALL NOT 编译 `default_detail` 或任何默认料。槽模重新封装时 SHALL 重新生成计划。

#### Scenario: Help 回读可审计 print 计划
- **WHEN** 使用方封装一个含嵌套槽、槽契约元数据和 support 推线的槽模并 exact Explore `print@program`
- **THEN** 返回内容足以逐项核对槽角色、contain、support、契约元数据和当前修订，且计划中不存在 `default_detail` 或默认料，不依赖隐藏缓存或测试夹具

#### Scenario: 相同槽模生成稳定计划
- **WHEN** 槽模事实未变化而重复封装
- **THEN** 系统生成相同的规范化计划与修订标识，不制造无意义新修订

### Requirement: print 计划直接生成普通槽例
使用方 SHALL 只通过 `use_program({"name":"EXACT槽体/print","arguments":{"name":"新槽例名"}})` 调用生成的 `print@program` 提交具名打印；`name` SHALL 是唯一公开打印参数。调用方 SHALL NOT 读取后再回传 `revision`；当前 `print@program` SHALL 从自身可见计划绑定当前修订，内核 SHALL 验证调用源与该计划后直接建立完整普通槽例，不经过物理空槽例。打印 SHALL 复制计划中的所有抽象槽、嵌套 contain、support 关系、类型及槽契约元数据，不得只复制输出槽、按输入／输出角色筛选或限制业务可填写的槽。打印 SHALL NOT 创建任何默认料；槽例中的具体料只能由使用方或外部编排在映射槽下新增为不带 `槽模角色` 的普通 Thing 子树。

#### Scenario: name-only 调用绑定当前可见修订
- **WHEN** 使用方封装槽体后仅向生成的 `print@program` 传入唯一 `name`
- **THEN** `print@program` 自动绑定其当前可见计划修订，系统生成采用该修订的槽例且回执返回同一修订

#### Scenario: 调用方不直接提交 print 效果
- **WHEN** 其他 Program 绕过生成的 `print@program` 直接登记 `slot_body(action=print)`
- **THEN** 系统返回 `INVALID_SLOT_PRINT_PLAN`，不生成槽例且不把 caller-supplied revision 作为授权

#### Scenario: 无空槽例打印嵌套实例
- **WHEN** 使用方以唯一名称运行 `print@program`
- **THEN** 系统在 `槽体/槽例/名称` 一次形成计划声明的完整嵌套 Graph，槽例容器中不存在作为母版的 `空槽例`

#### Scenario: 槽契约不是默认料
- **WHEN** 槽模槽节点带有 `detail`／`situation` 说明而使用方打印新槽例
- **THEN** 对应映射槽保留槽契约语义，但槽下不生成料节点，且计划与实例均不把契约字符标记或处理为默认料

#### Scenario: 重名打印整次拒绝
- **WHEN** `槽例` 中已经存在同名直接下级
- **THEN** 系统返回 `SLOT_BODY_EXAMPLE_EXISTS`，既有槽例和世界修订保持不变

### Requirement: 槽模 Program 始终共享一份
槽模中的 Program SHALL 作为该槽体全部槽例的共享逻辑只保存一份。print 计划 SHALL 记录 Program 的相对角色及 support 接线，但实例化 SHALL NOT 在槽例中复制 Program 源码或 Program 节点。

#### Scenario: 多实例共享同一 Program
- **WHEN** 同一槽体打印两个以上槽例
- **THEN** 每个槽例拥有独立槽与料，所有计算均解析到槽模中的同一 Program，任何槽例内部都没有 Program 副本

#### Scenario: 修改共享 Program 无需重写实例代码
- **WHEN** 使用方修改槽模中的 Program 并重新封装同一槽体
- **THEN** 新修订统一引用修改后的单份 Program，系统不向各槽例复制或转换源代码
