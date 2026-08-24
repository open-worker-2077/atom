## Purpose

为 Atom Graph 提供可由使用方 Agent 直接调用的槽体运行时，使槽模定义、共享 Program、空槽例和业务槽例保持显式、局部、可打印且可回读，同时避免调用方逐节点递归装配。

## ADDED Requirements

### Requirement: 槽体采用槽模与槽例二分结构
系统 SHALL 将一个槽体识别为包含且仅包含一个直接下级 `槽模` 和一个直接下级 `槽例` 的显式 Graph；`槽例` SHALL 包含且仅包含一个直接下级 `空槽例`，业务槽例 SHALL 与空槽例同属 `槽例`，系统不得要求名为“槽域”或带“球”后缀的技术节点。

#### Scenario: 合法槽体被封装
- **WHEN** `slot_body({"action":"seal","body":"订单槽体"})` 指向符合二分结构的槽体
- **THEN** 系统返回槽模、空槽例和现有业务槽例的精确路径，并建立后续打印与映照所需的稳定对应关系

#### Scenario: 结构不完整时整次拒绝
- **WHEN** 目标缺少、重复或混放 `槽模`、`槽例`、`空槽例`
- **THEN** 系统以 `INVALID_SLOT_BODY_LAYOUT` 拒绝封装且不写入部分对应关系

### Requirement: 空槽例可以原子打印具名槽例
系统 SHALL 通过 `slot_body()` 将完整 `空槽例` Graph 子树复制为指定名称的业务槽例；复制 SHALL 保留全部后代节点与料，副本内部推线 SHALL 重接至副本内部，指向槽模共享 Program 的外部推线 SHALL 继续指向原槽模 Program。

#### Scenario: 嵌套空槽例打印成功
- **WHEN** 调用 `slot_body({"action":"print","body":"订单槽体","name":"订单001"})` 且名称未被占用
- **THEN** 系统在 `订单槽体/槽例/订单001` 一次提交完整具名副本，并返回可精确回读的目标路径

#### Scenario: 重名打印不产生半份副本
- **WHEN** 指定业务槽例名称已存在
- **THEN** 系统以 `SLOT_BODY_EXAMPLE_EXISTS` 拒绝整次打印，原空槽例和既有槽例均保持不变

### Requirement: 槽模 Program 由所属槽例共享
系统 SHALL 只在 `槽模` 中保存共享 Program；打印 SHALL 不复制这些 Program，并 SHALL 保持槽例槽位到共享 Program 的显式关系，使 Program 更新后所属槽例无需逐份复制代码。

#### Scenario: 打印多个槽例只保留一份 Program
- **WHEN** 同一槽体连续打印多个业务槽例
- **THEN** 每个槽例拥有独立槽、料和内部推线，但均引用槽模中的同一 Program，槽例内部不出现 Program 副本

### Requirement: 槽例上下文沿显式关系按需装配
槽模共享 Program SHALL 能以一个精确槽例路径作为 `use_program().arguments` 入参，只读取该槽例自身、其显式推线依赖和槽模共享依据；不得为了处理一份槽例继承完整会话历史、复制整套公共资料或遍历无关槽例。必要依赖缺失时 SHALL 返回精确缺项，不得以无依据补全掩盖缺口。

#### Scenario: 显式依赖足以完成一次槽例运算
- **WHEN** 一张槽例显式关联了本次运算声明为必要的输入与规则
- **THEN** 共享 Program 只装配这些依赖并将完整输入交给该槽体自行定义的运算逻辑

#### Scenario: 公共资料不逐槽例复制
- **WHEN** 多张槽例共同使用同一份共享规则或依据
- **THEN** 公共资料只在槽模或共享依据节点保存一次，各槽例通过关系引用，单张上下文不重复携带无关条目

#### Scenario: 必要依赖缺失时显式失败
- **WHEN** 当前槽例缺少完成该项判断所必需的原文、关联画像或输出契约
- **THEN** 共享 Program 返回缺失依赖的精确槽路径且不启动主要计算

### Requirement: 槽模结构局部映照到全部槽例
系统 SHALL 通过 `slot_body({"action":"sync","body":"..."})` 将槽模中的新增、重命名、移动、类型和推线变化映照到空槽例及所属业务槽例；既有槽例 detail 中的料字符 SHALL 原样保留，不能解释为新类型的字符 SHALL 被保留并报告而不得删除。

#### Scenario: 结构变化保留既有料
- **WHEN** 槽模槽位被重命名、移动或改变类型后执行同步
- **THEN** 对应槽例槽位同步变化且其原 detail 字符逐字保持

#### Scenario: 新槽映照到全部槽例
- **WHEN** 槽模新增一个槽位后执行同步
- **THEN** 空槽例和每个业务槽例均在对应位置得到空料槽位，并建立稳定对应关系

#### Scenario: 无法安全删除的有料槽被保留
- **WHEN** 槽模不再包含某个映照槽位而至少一个槽例中的对应槽位仍有料
- **THEN** 系统保留该槽位及料并返回 `SLOT_BODY_SYNC_CONFLICT`，不以静默删除完成同步

### Requirement: 槽体运算限定在当前局部
封装、打印和同步 SHALL 只遍历指定槽体中的槽模与槽例以及它们的显式推线端点，不得扫描、哈希或重算无关 Atom 世界，也不得触发无关 Program。

#### Scenario: 大世界中的局部打印
- **WHEN** 世界包含大量无关节点而调用方打印一个槽体的空槽例
- **THEN** 运行时访问范围限于该槽体、被复制子树和显式关系端点，结果与无关节点数量无关

### Requirement: 旧复制与模板能力保持兼容
系统 SHALL 保持现有 `.cpy.`、`instantiate()`、`template_catalog()`、`form()`、`work_order()` 和 Program trigger 的既有输入与结果；`slot_body()` SHALL 是新增公共内核函数而不是替换旧调用。

#### Scenario: 旧调用无需迁移
- **WHEN** 现有应用继续使用旧复制、模板或表单函数且不调用 `slot_body()`
- **THEN** 其行为和公开错误契约保持不变

### Requirement: Help 公开完整槽体契约
CLI Help 与 Program 函数注册表 SHALL 公开 `slot_body()` 的动作、JSON 入参、返回值、延迟提交性质、结构约束、错误码、事务边界和回读要求，不得要求使用方阅读源码或猜测递归实现。

#### Scenario: 使用方可仅凭 Help 打印槽例
- **WHEN** Agent 读取 `atom.cmd --help` 和 `atom.cmd --program-function-registry`
- **THEN** 它能够封装、打印、同步并解释正反回执，无需自行递归创建槽位

### Requirement: 服务启动不得重放槽体写效果
系统 SHALL 在服务启动时验证并投影 Program 契约与锁状态，但不得仅因启动或重启而重放 `slot_body()`、Transform、消息或其他写效果；槽体写效果 SHALL 仅由显式 Program 运行或命中的 Transform 触发器产生。

#### Scenario: 重启不重复打印槽例
- **WHEN** 世界中已有一个可打印槽例的 Program 且 Atom 服务重新启动
- **THEN** 服务恢复可读投影与锁状态，但不新增、同步或修改任何槽例
