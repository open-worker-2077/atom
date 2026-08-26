## Purpose

让使用方 Program 通过统一索引调度安全地守窗、回收或迁移当前 Agent 窗口，并在迁移后把槽例相对 support 与变化监测精确重绑到新域。

## ADDED Requirements

### Requirement: jump 使用固定的精确 Program 契约
系统 SHALL 注册 `jump`，其参数对象只允许 `when`、`where`、`recycle`、`lock`。`when`、`where`、`recycle` 若存在 SHALL 是由 `explore()` 返回的单个精确 Thing 坐标对象，且目标 Thing SHALL 为 `@program`；系统 SHALL NOT 要求调用方提取 `.ref`，也 SHALL NOT 接受短名、模糊字符串、数组位置或隐式邻接猜测。`when` 与 `recycle` Program SHALL 返回 JSON boolean；`where` Program SHALL 返回一个精确 Thing 坐标对象。

#### Scenario: explore 坐标直接传入
- **WHEN** 使用方把 `explore({...})[0]` 返回的精确 `@program` Thing 坐标分别传给 `when`、`where` 或 `recycle`
- **THEN** `jump` 直接接受坐标对象并保存稳定的精确依赖，不要求 `.ref` 或另造游走语法

#### Scenario: 非精确 Program 引用被拒绝
- **WHEN** 任一 Program 参数是字符串、模糊选择、零命中、多命中、非 `@program` Thing 或包含未知键
- **THEN** 系统以稳定的 `INVALID_JUMP_CONTRACT` 拒绝注册或执行且不产生窗口效果

### Requirement: 守窗、回收与跳转具有确定顺序
一次命中执行中系统 SHALL 先求值 `recycle`；其结果为 `true` 时 SHALL 直接回收当前窗口且不执行 `when` 或 `where`。`recycle` 省略或返回 `false` 时，系统 SHALL 再求值 `when`；`when` 省略或返回 `false` 时 SHALL 原位守窗且不执行 `where`。只有 `when` 返回 `true` 时 SHALL 执行 `where` 并尝试跳转。

#### Scenario: 无 when 永久守窗
- **WHEN** `jump` 省略 `when` 且 `recycle` 省略或返回 `false`
- **THEN** 当前窗口保持原位，`where` 不执行且不提交世界修订

#### Scenario: when false 短路 where
- **WHEN** `when` 返回 `false`
- **THEN** 当前窗口保持原位且 `where` 的复杂 Program 不运行

#### Scenario: recycle true 优先回收
- **WHEN** `recycle` 返回 `true`，包括通过 exact `thing.run.` 显式运行 jump 注册 Program
- **THEN** 系统把该 Agent 注册减少标记为本次计划内 `window-recycle`，在同一权威世界提交中直接回收当前窗口，并在提交成功后清理其活动窗口自锁快照；`when` 与 `where` 均不运行且系统不保留、停放或销毁枚举状态
- **AND** 未由该 jump 回收效果产生的 Agent 注册减少仍以 `AGENT_REGISTRATION_LOSS` 拒绝且不提交

#### Scenario: when true 才计算目的地
- **WHEN** `recycle` 不回收且 `when` 返回 `true`
- **THEN** 系统恰好执行一次 `where`，并仅以其返回的精确 Thing 坐标作为目的地

#### Scenario: 显式运行绑定当前窗口相对域
- **WHEN** 当前 Agent 窗口显式运行 jump 注册 Program，`when` 内以 `./…` 读取窗口内节点且 `where` 返回绝对 exact Thing 坐标
- **THEN** 系统以当前 Agent 窗口为未显式绑定槽域的相对解析根，保留 `where` 绝对 exact 坐标语义，且不放宽已显式绑定的槽例域边界

### Requirement: 窗口迁移是中央事务中的原子效果
有效目的地 SHALL 是可作为当前 Agent 窗口新父位置的唯一精确 Thing。迁移、窗口自锁安装或收紧、相对域重绑、触发索引更新与派生 Program 效果 SHALL 在同一候选世界事务中验证并一次提交；任一验证、锁或 Program 失败 SHALL 回滚全部候选效果，窗口保持原位并返回稳定错误。

#### Scenario: true 原子跳转
- **WHEN** `when` 返回 `true`、`where` 返回有效且可写的精确目的地并且所有候选效果通过授权
- **THEN** 当前 Agent 窗口一次移动到目的地下，世界只提交一个权威修订且不存在可见半迁移状态

#### Scenario: 无效或歧义目的地不移动
- **WHEN** `where` 返回空值、非 Thing 坐标、零命中、多命中、循环位置或其他无效目的地
- **THEN** 系统返回 `INVALID_JUMP_DESTINATION`，窗口与所有派生事实保持事务前状态

#### Scenario: 目的地被锁不移动
- **WHEN** 节点锁与窗口自锁的交集拒绝目的地写入
- **THEN** 系统返回 `WINDOW_JUMP_LOCK_DENIED`，不提交移动、索引或 Program 效果

### Requirement: changed 通过 Transform 反向索引短路
系统 SHALL 注册 `changed(things)`；`things` SHALL 是非空、无重复的精确 Thing 坐标对象数组。注册/建立 Program 投影时系统 SHALL 把这些坐标加入既有 Transform 反向索引；本次候选 Transform 未涉及任何目标时 SHALL 返回 `false` 且不执行调用方后续复杂 Program，涉及至少一个目标时 SHALL 返回 `true`。系统 SHALL NOT 为此扫描整个世界。

#### Scenario: 未命中不运行复杂 Program
- **WHEN** 本次 Transform 与 `changed` 登记的全部 Thing 坐标无关
- **THEN** `changed` 返回 `false`，调用方的 explore、聚合或目的地计算不执行

#### Scenario: 命中才继续计算
- **WHEN** 本次 Transform 涉及任一登记 Thing
- **THEN** `changed` 返回 `true`，调用方才可继续运行后续 Program 逻辑

#### Scenario: 非精确坐标被拒绝
- **WHEN** `things` 为空、重复或包含字符串、短名、非 Thing、零命中或多命中坐标
- **THEN** 系统返回 `INVALID_CHANGED_THINGS` 且不建立宽泛索引

### Requirement: jump 复用现有 support 调度并按新槽例重绑
`when`、`recycle` 与 `changed` SHALL 复用既有 Graph support/Transform 反向索引触发机制，不建立第二套全局调度器。窗口从一个槽例迁移到另一个槽例后，系统 SHALL 以新槽例为 `scope_root` 重新解析槽模相对 support、映射角色与 `changed` 坐标；旧槽例绑定 SHALL 在同一提交中失效，槽模模板 support SHALL 保持物理不变。v1 SHALL 只监测槽模已定义的映射槽及其允许的料变化，不监测执行窗口新增槽位。

#### Scenario: 第二槽例事件使用新域
- **WHEN** 窗口从槽例 A 跳到同槽模的槽例 B 后，槽例 B 的已定义监测槽发生 Transform
- **THEN** 共享 Program 仅以 B 为 scope 运行，所有相对读取、写入和下一次目的地计算都绑定 B

#### Scenario: 旧槽例不再误触发
- **WHEN** 窗口已提交迁移到 B 后槽例 A 的原监测槽发生 Transform
- **THEN** 该窗口的旧绑定不运行，系统不扫描其他槽例寻找替代匹配

#### Scenario: 普通 Explore 不重放无关 jump
- **WHEN** 一条普通 exact Explore 缺少当前 Agent 的可复用 Program 投影，世界中另一窗口已有使用 `./…` 相对读取的 jump 注册 Program
- **THEN** 系统只被动复用已验证的上下文无关投影并叠加 request-driven 锁，不解析、执行或重放该 jump 的 `when`/`where`/目的地链；只有精确命中的 Transform 事件或显式 `.run.` 才按既有索引执行

#### Scenario: 新增伪槽不进入监测
- **WHEN** 槽例执行窗口在普通料子树下创建未映射节点
- **THEN** 该节点不自动成为槽模监测角色，只有槽模已定义槽及其允许料变化参与 v1 索引
