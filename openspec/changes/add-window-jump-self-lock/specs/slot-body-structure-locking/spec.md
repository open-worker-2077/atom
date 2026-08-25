## Purpose

让槽体封装可选择安装结构节点锁，保护槽例的映射槽身份与规则，同时继续允许经过锁交集授权的窗口在既有槽内写入普通料。

## ADDED Requirements

### Requirement: seal 可选安装槽体结构锁
`slot_body` 的 `seal` 动作 SHALL 接受可选 boolean `lock` 参数；省略或为 `false` 时 SHALL 保持现有槽体封装与 reseal 兼容且不自动安装结构锁，为 `true` 时系统 SHALL 在同一 seal 事务中把结构锁策略编入可见 print 计划，并自动投影到全部既有和后续槽例的映射槽节点。其他类型 SHALL 以 `INVALID_SLOT_BODY_EFFECT` 拒绝。内核 SHALL NOT 按“总控／执行”或其他业务角色写死调用方。

#### Scenario: lock 关闭保持兼容
- **WHEN** 使用方 seal 时省略 `lock` 或将其设为关闭
- **THEN** 槽模、print 计划和槽例按现有契约封装/同步且不新增槽体结构门禁

#### Scenario: lock 开启原子投影
- **WHEN** 使用方以有效 `lock` seal 或 reseal 槽体
- **THEN** 当前 print 计划和所有槽例的映射槽结构锁在同一事务中生效，任一投影失败则全部回滚

### Requirement: 映射槽 self 与槽下普通料分开授权
启用结构锁后，每个带稳定 `槽模角色` 映射的槽节点 SHALL 锁定其 self transform，包括名称、类型/角色、结构位置、移动、删除、support/Program 规则与槽契约元数据。该锁 SHALL NOT 粗暴禁止整棵子树：映射槽的 descendants 仍按节点 lock 与窗口自锁交集接受 Transform，允许在既有槽下创建、修改或移动不带 `槽模角色` 的普通料 Thing 子树。

#### Scenario: 改槽 self 被拒绝
- **WHEN** 槽例窗口尝试改名、移动、删除映射槽或修改其角色、结构、support、Program 规则或契约元数据
- **THEN** 系统返回 `SLOT_STRUCTURE_LOCK_DENIED` 且不改变槽或料

#### Scenario: 槽下填料被允许
- **WHEN** 调用窗口通过节点 lock 与窗口自锁交集并在既有映射槽下创建或修改不带槽模角色的普通 Thing
- **THEN** 该 Transform 可提交且结构锁不把普通料误判为槽 self 修改

### Requirement: 槽例窗口不能制造映射槽或伪装角色
启用结构锁后，槽例内任何新增节点 SHALL 默认为普通未映射料。除当前槽体 reseal 的权威映射计划外，系统 SHALL 拒绝新增 `槽模角色` 映射、把普通料改成映射槽、复制/移动外部映射槽进入实例，或以同名、类型、数组位置伪装槽角色。普通未映射子树 SHALL 始终视为料且不进入槽位 support/changed 结构索引。

#### Scenario: 新增伪槽被拒绝
- **WHEN** 槽例窗口创建新节点并声明、复制或仿造 `槽模角色`
- **THEN** 系统返回 `SLOT_ROLE_FORGERY_DENIED`，世界与槽例结构保持不变

#### Scenario: 普通子树保持为料
- **WHEN** 窗口在映射槽下创建不带稳定角色映射的嵌套 Thing 子树
- **THEN** 系统把整棵子树作为普通料保存，不按名称、相对位置或数组顺序猜测槽角色

### Requirement: 槽位规则变化只由受权 reseal 覆盖
槽模结构、support 或 Program 规则变化 SHALL 只通过 `slot_body seal` 重新生成的完整计划覆盖所有槽例。reseal 调用方 SHALL 同时通过其窗口自锁、槽模/槽体节点 lock 与结构锁授权；通过后系统 SHALL 以计划来源权限修改映射槽 self，保持普通料守恒并原子投影新锁。结构锁 SHALL NOT 为 reseal 硬编码特殊业务角色或无条件后门。

#### Scenario: 上方窗口满足交集后 reseal
- **WHEN** 一个相对上方窗口的自锁允许触达槽模/槽体且全部节点锁允许 seal
- **THEN** reseal 可原子更新映射槽结构、规则和锁投影，同时继续遵守既有料守恒与冲突回滚契约

#### Scenario: 任一锁拒绝则 reseal 回滚
- **WHEN** 调用窗口自锁、槽模节点 lock、槽体结构 lock 中任一项拒绝 reseal
- **THEN** 系统返回稳定锁拒绝，print 计划、全部槽例、料与修订保持事务前状态

### Requirement: Help 公开开关风险与安全示例
CLI Help 与 Program 函数注册表 SHALL 从同一权威契约公开 `slot_body seal lock` 的精确 JSON 结构、默认关闭行为、映射槽 self/descendants 分界、伪槽错误、reseal 授权交集，以及不开启时槽例结构可能被有写权限窗口改造的风险。示例 SHALL 展示启用锁后槽下填料成功与直接改槽失败。

#### Scenario: 只读 Help 足以安全使用
- **WHEN** Agent 仅读取 CLI Help 与 Program 函数注册表
- **THEN** 它能构造 lock 开/关 seal、判断料写与结构写边界、解释拒绝码并知道未启用结构锁的风险，无需读取源码或猜测角色
