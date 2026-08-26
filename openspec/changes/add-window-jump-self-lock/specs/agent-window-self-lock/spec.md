## Purpose

为产出 `jump` 注册结果并进入受自锁窗口态的 Agent 窗口提供独立于通用节点锁的最小默认读写边界，并保持未注册 `jump` 的既有 Agent 窗口访问兼容。

## ADDED Requirements

### Requirement: jump 注册激活窗口默认自锁
当前 Agent 的 Program 周期一旦产出 `jump` 注册结果，系统 SHALL 在该周期立即把当前窗口置为受自锁窗口态；守窗、带条件跳转或带回收条件的有效 `jump` 注册均触发该状态，不以本轮是否实际移动或回收为前提。未显式提供 `lock` 时，系统 SHALL 为该窗口应用默认自锁。未产出 `jump` 注册结果的既有 Agent 窗口 SHALL 维持旧访问行为，不得仅因其为 `@agent` 或作为当前交互窗口而隐式启用自锁。默认 read SHALL 允许当前窗口节点、其全部后代、其全部同父兄弟及唯一直接父节点；默认 read SHALL 拒绝父节点的其他同层节点、直接父节点以上的祖先及其他分支。默认 write SHALL 只允许当前窗口节点下方的后代范围，不允许改造当前窗口节点自身、同父兄弟、直接父节点或其他分支。

#### Scenario: 未注册 jump 保持旧行为
- **WHEN** 当前 Agent 的 Program 周期没有产出任何 `jump` 注册结果
- **THEN** 系统不启用默认或显式窗口自锁，既有 Agent 继续按原有节点锁与访问契约运行

#### Scenario: jump 注册立即激活默认自锁
- **WHEN** 当前 Agent 产出有效 `jump` 注册结果且未提供显式 `lock`
- **THEN** 系统在同一周期立即启用默认窗口自锁，即使该结果本轮只是守窗

#### Scenario: 默认读正向边界
- **WHEN** 窗口读取当前节点、任意深度后代、同父兄弟或唯一直接父节点
- **THEN** 窗口自锁允许该读取继续经过通用节点锁检查

#### Scenario: 默认读反向边界
- **WHEN** 窗口读取其父节点的同层节点、父节点以上祖先或其他分支
- **THEN** 系统返回 `WINDOW_ACCESS_DENIED` 且不公开受拒绝目标内容

#### Scenario: 默认写只及后代
- **WHEN** 窗口在任意深度后代中修改已有料或创建普通料 Thing
- **THEN** 窗口自锁允许该写入继续经过通用节点锁检查

#### Scenario: 默认写拒绝自身与旁支
- **WHEN** 窗口尝试修改自身、同父兄弟、直接父节点、祖先或其他分支
- **THEN** 系统返回 `WINDOW_ACCESS_DENIED` 且世界不改变

### Requirement: exact path 不绕过窗口自锁
所有 CLI 与 Program Explore/Transform SHALL 在目标已经 exact 解析后执行同一窗口自锁检查。完整路径、顶层消歧路径、内部 ref 或其他精确寻址 SHALL NOT 绕过边界。

#### Scenario: 完整路径仍被拒绝
- **WHEN** 窗口以目标完整 exact path 读取父节点以上祖先或写入同父兄弟
- **THEN** 系统仍返回 `WINDOW_ACCESS_DENIED`，结果与使用最短 exact 选择器相同

#### Scenario: 跳窗后下一公开请求仍执行重绑定自锁
- **WHEN** 窗口已从槽例 A 原子跳到槽例 B，活动自锁已重绑定到 B 下的新窗口路径，随后该窗口在下一条公开 CLI/Program 请求中以完整 exact path 读取旧槽例 A
- **THEN** 系统从 scheduler 的活动状态投影重绑定后的默认或显式自锁，以 `WINDOW_ACCESS_DENIED` 拒绝且不公开旧槽例内容；不得因该请求未重跑 `jump` Program、复用缓存投影或跨越事务边界而回落为无自锁访问

### Requirement: 显式 lock 在 read 与 write 分别层叠 allow deny 规则
显式 `lock` SHALL 只允许 `read` 与 `write` 两个侧对象；每侧 SHALL 同时支持 `allow` 与 `deny` 规则数组。每条规则 SHALL 包含正整数 `priority`、一个 `from` 精确起点，以及可选 `parent:boolean`、`peers:boolean`、`descendants:"all"|非负整数`。`from` 只允许字面量 `"current"`，或由绝对 exact `explore()` 返回的单个 Thing 坐标对象，或由 current 执行 exact 相对 `explore()` 后返回的单个 Thing 坐标对象；除唯一保留字 `current` 外 SHALL NOT 接受字符串、短名、模糊选择、ref 或邻接/数组位置猜测。每条规则 SHALL 匹配起点 exact Thing 本身，并按声明选择唯一直接 parent、同父 peers 与指定深度 descendants；`parent` SHALL NOT 展开到父节点所在层。read 与 write 未出现的一侧、以及任一侧没有显式命中目标时 SHALL 回落该侧既定默认自锁，不得默认全放行。

#### Scenario: read write 独立层叠
- **WHEN** read 与 write 各自配置不同的 allow/deny 规则和深度
- **THEN** 系统分别求值两侧规则，不把任一侧的命中或优先级投影到另一侧

#### Scenario: current 起点精确展开
- **WHEN** 一条规则以 `from:"current"` 声明 exact current、`parent:true`、`peers:true` 与 `descendants:2`
- **THEN** 规则只覆盖当前窗口、唯一直接父节点、当前同父兄弟及最多两层后代，绝不覆盖父节点的同层节点

#### Scenario: 绝对 explore 对象直接作为起点
- **WHEN** Program 把 `explore({"name":"完整精确路径"})[0]` 返回对象直接放入规则 `from`
- **THEN** 系统从该 exact Thing 展开规则，不要求 `.ref` 且不自动包含任何未声明关系

#### Scenario: current 相对 explore 对象直接作为起点
- **WHEN** Program 从 current 执行精确相对 explore 并把返回坐标对象直接放入规则 `from`
- **THEN** 系统以解析后的唯一 Thing 为起点，不保存相对字符串、不按后续数组位置重解释

#### Scenario: 模糊起点被拒绝
- **WHEN** `from` 是除 `current` 外的字符串、短名、模糊选择、ref、非 Thing、零命中、多命中或数组位置
- **THEN** 系统以 `INVALID_WINDOW_SELF_LOCK` 拒绝整份覆盖且保留原自锁

### Requirement: 规则冲突按 priority 与 deny 确定
对同一目标和同一 read/write 侧，系统 SHALL 收集全部匹配 allow/deny 规则，选取数值最高的 `priority`；若最高 priority 只存在 allow SHALL 允许，若包含任一 deny SHALL 拒绝。priority SHALL 为任意正整数且不限制层叠数量。较高 priority SHALL 覆盖所有较低 priority；同 priority allow/deny 冲突 SHALL 一律 deny。零条规则匹配 SHALL 回落默认自锁。

#### Scenario: 高优先级 allow 覆盖低优先级 deny
- **WHEN** 同一目标命中 priority 2 allow 与 priority 1 deny
- **THEN** 显式规则结果为 allow，并继续经过另一套锁检查

#### Scenario: 高优先级 deny 覆盖低优先级 allow
- **WHEN** 同一目标命中 priority 3 deny 与任意较低 priority allow
- **THEN** 窗口自锁拒绝访问

#### Scenario: 同优先级冲突 deny
- **WHEN** 同一目标同时命中相同最高 priority 的 allow 与 deny
- **THEN** 窗口自锁拒绝访问，不按声明顺序选择

#### Scenario: 未命中回落默认边界
- **WHEN** 目标未命中该侧任一显式 allow/deny 规则
- **THEN** 系统按默认窗口自锁判断，而非默认允许或默认拒绝全部

#### Scenario: priority 非法整份拒绝
- **WHEN** 任一规则 priority 缺失、为零、负数、非整数或非数值
- **THEN** 系统以 `INVALID_WINDOW_SELF_LOCK` 拒绝整份覆盖且保留原自锁

### Requirement: 节点锁与窗口自锁独立取交集
通用节点 lock 与窗口自锁 SHALL 分别求值；一次访问只有在两套锁都允许时才可继续。窗口自锁 SHALL 限制该窗口发起的全部 CLI 与 Program 访问，不表示归属、控制者、身份或节点所有权，也 SHALL NOT 替代节点 lock。

#### Scenario: 任一锁拒绝即拒绝
- **WHEN** 节点 lock 允许而窗口自锁拒绝，或窗口自锁允许而节点 lock 拒绝
- **THEN** 操作不提交并返回对应稳定拒绝码，不因另一套锁允许而放行

### Requirement: 已生效窗口不能自扩或自解锁
窗口自己的调用 SHALL 只能保持或收紧当前有效 read/write 集合，不得通过增加/提高 allow、删除/降低 deny、扩大关系范围或其他规则改写扩大可达集合，也不得停用自锁或移除显式覆盖。窗口回收 SHALL 结束该窗口自锁。其他窗口只有在其自身窗口自锁允许触达目标窗口节点且通用节点锁也允许修改时，才可修改显式覆盖或将其移除并恢复默认自锁；系统 SHALL NOT 硬编码总控、执行或其他业务角色。

#### Scenario: 自身收紧成功
- **WHEN** 窗口通过降低/删除 allow、增加/提高 deny 或缩小规则关系范围使新可达集合成为旧集合子集
- **THEN** 新边界原子生效且该窗口不能再自行恢复原范围

#### Scenario: 自身扩大被拒绝
- **WHEN** 已生效窗口尝试扩大任一 read/write 可达集合或解除自锁
- **THEN** 系统返回 `WINDOW_SELF_LOCK_EXPANSION_DENIED` 并保留旧边界

#### Scenario: 可达的上方窗口修改授权
- **WHEN** 另一个窗口的自锁允许写目标窗口节点且目标节点的通用 lock 也允许该调用
- **THEN** 该调用可原子替换、收紧、放宽目标窗口的显式覆盖，或移除覆盖并恢复默认自锁

#### Scenario: 避免自锁死锁的最小机制
- **WHEN** 一个窗口已因自身边界无法改造自身且需要解除或放宽
- **THEN** 唯一公开恢复路径是回收该窗口，或由另一个同时通过自身窗口自锁与目标节点 lock 的可达窗口发起覆盖修改/移除；系统不提供硬编码管理角色、无自锁状态或隐式后门
