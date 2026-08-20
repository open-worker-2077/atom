## Why

`use_program()` 当前自行按短名或路径查找目标 Program，与 `explore()` 已有的统一游走、消歧和坐标结果形成重复语义。另有 Agent 已在使用旧写法，因此需要在不突然破坏现有 Program 的前提下，将跨 Atom Program 复用收束到“先 Explore 定位，再按结果调用”的单一边界。

## What Changes

- 增加以 `explore()` 返回的 Program 结果作为调用目标的标准 `use_program()` 写法，运行输入继续作为独立、可省略的 JSON 兼容数据传入。
- `use_program()` 不再为标准写法定义短名、路径、伙伴或层级游走语法；全部定位和消歧由 `explore()` 负责。
- 调用目标必须是同一不可变世界修订中的 `@program`；非 Program、失效坐标和跨世界结果均被明确拒绝。
- 暂时兼容现有 `{name, arguments}` 写法，避免破坏已经运行的 Agent；兼容分支复用统一 Explore 选择语义，不继续维护独立查找规则，Help 将其标记为迁移兼容写法。
- 保持既有 JSON 兼容返回值、沙箱、递归拒绝、最大调用深度、效果汇集、锁、Transform 与中央事务边界不变。
- 不在本变更中开放动态全局函数注册，不改变 `form()` 内核、`work_order()` 或推进流模板，也不增加跨 Atom 世界调用。

## Capabilities

### New Capabilities

- `program-composition`: 规定 Explore 已解析 Program 的复用调用、同修订坐标校验以及旧写法的兼容迁移边界。

### Modified Capabilities

无。

## Impact

- Program Python worker 的 `use_program()` 参数解析与目标校验。
- Program 依赖跟踪、缓存失效和诊断身份。
- Program 引用、生命周期、沙箱与事务相关测试。
- `atom.cmd --help` 及 Program 运行时说明。
