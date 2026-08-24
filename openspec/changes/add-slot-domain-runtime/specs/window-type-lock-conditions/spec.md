## Purpose

让 Program 锁能够按窗口类型、目标状态和交互动作分别判断，而不必把具体窗口 ID 或名称固化进每个节点；具体窗口的守窗、跳窗、关窗和滚动调度继续由总控 Agent 决定。

## ADDED Requirements

### Requirement: 锁可以按窗口 Graph 类型放行
系统 SHALL 接受 `allowed_windows.types` 类型条件；条件 SHALL 只读取当前 `@agent` 节点的 Graph `@type` 集合，并支持 `all`、`any`、`none` 三种可组合判断，不比较窗口名称或路径。

#### Scenario: 窗口类型命中
- **WHEN** 当前 `@agent` 的类型满足锁声明的 `all`、`any` 和 `none` 条件
- **THEN** 当前锁对该窗口放行，其他锁与事务检查仍照常执行

#### Scenario: 窗口类型未命中
- **WHEN** 当前 `@agent` 的类型不满足条件
- **THEN** 当前锁按既有读截断或 `PROGRAM_LOCK_DENIED` 行为执行

#### Scenario: 无效类型条件不发布
- **WHEN** 类型条件含未知键、空类型、重复类型或空的全部判断
- **THEN** Program 以 `INVALID_PROGRAM_LOCK_WINDOW_TYPES` 失败且不发布本次效果

### Requirement: 目标状态与交互动作分别表达
系统 SHALL 接受可选 `when.target_types` 与 `when.actions`；`target_types` SHALL 使用与窗口类型相同的 `all`、`any`、`none` 判断当前目标的 Graph 类型，`actions` SHALL 明确区分 `explore` 与 `transform`。锁仅在目标状态条件与当前动作均命中时生效。

#### Scenario: 状态命中但动作不命中
- **WHEN** 目标类型满足状态条件但当前动作不在 `when.actions`
- **THEN** 此锁不阻断本次动作

#### Scenario: 动作命中但状态不命中
- **WHEN** 当前动作命中但目标类型不满足状态条件
- **THEN** 此锁不阻断本次动作

#### Scenario: 状态与动作同时命中
- **WHEN** 当前目标类型和交互动作同时满足条件且窗口类型未获放行
- **THEN** 此锁按既有保护字段与读写模式执行

### Requirement: 具体窗口名单保持兼容
系统 SHALL 保持旧 `allowed_windows:{"paths":[...]}` 契约；一个锁 SHALL 使用 `paths` 或 `types` 之一，不得同时声明二者。未使用新条件的旧锁 SHALL 保持原结果。

#### Scenario: 旧名单锁继续工作
- **WHEN** 已有 Program 只声明 `allowed_windows.paths`
- **THEN** 精确路径匹配、显式重算和拒绝行为均保持不变

### Requirement: 调度策略不写死在锁内核
窗口类型条件 SHALL 只提供本次交互判断能力；内核 SHALL NOT 自动决定某个具体窗口何时守窗、跳窗、关窗或绑定哪个槽例，也 SHALL NOT 因业务状态变化自动改写所有槽体锁。

#### Scenario: 总控滚动分配执行窗口
- **WHEN** 总控 Agent 根据业务需要改变执行窗口的当前绑定范围
- **THEN** 它通过现有调度与显式重算能力完成控制，类型条件锁只判断随后到达的交互

### Requirement: Help 区分类型、状态和动作
CLI Help 与 Program 函数注册表 SHALL 分别说明窗口类型条件、目标状态条件、动作条件、旧路径名单兼容方式、验证错误与拒绝结果。

#### Scenario: 使用方无需猜测条件轴
- **WHEN** Agent 读取公开 Help
- **THEN** 它能够明确区分“窗口是什么类型”“目标处于什么状态”“本次执行什么动作”，并构造合法 JSON
