# graph-program-support Specification

## Purpose

定义 Program 端点“节点计算自身、support 只传递是否支撑”的边界。

## ADDED Requirements

### Requirement: Program 身份只在端点引用键
support MUST 保持纯连接且 MUST NOT 存在 support@program。普通端点使用 `thing`，Program 端点使用 `thing@program`；两者 RHS 都 MUST 只是 selector。被 thing@program 捕获的节点 MUST 是 exact thing@program 节点，源码 MUST 只在该节点 situation。

#### Scenario: 普通与 Program 枢纽
- **WHEN** 两条规则分别引用普通 H 与 thing@program:P
- **THEN** H 只作为普通节点，P 使用其 situation Program，且无额外枢纽类型

#### Scenario: 类型不匹配
- **WHEN** thing@program selector 指向普通 thing
- **THEN** 返回 `SUPPORT_PROGRAM_ENDPOINT_TYPE_MISMATCH`

### Requirement: 前件 Program 只返回 strict bool
if 侧 Program endpoint MUST 运行该节点的既有 main(arguments) 并 strict 返回 bool。true 表示该前件成立；false 表示不成立；and/or MUST 按序短路。非 bool MUST 返回 `INVALID_PROGRAM_SUPPORT_RESULT`。

#### Scenario: true 与 false
- **WHEN** 两个前件 Program 分别返回 True 和 False
- **THEN** 对应规则分别成立和不成立

### Requirement: 前件 Program 不得产生效果
support 求值中的 Program MUST NOT 发布 transform、slot_body、lock、message 或 choice。登记任何效果 MUST 返回 `PROGRAM_SUPPORT_EFFECT_FORBIDDEN`，世界与后件保持不变。

#### Scenario: 前件试图写后件
- **WHEN** 前件 Program 登记 transform 后返回 True
- **THEN** 求值失败、效果不提交且后件未改变

### Requirement: 后件 Program 只由自身计算
then 侧 thing@program MUST 仅标识该后件是 Program 节点。前件求值 MUST NOT 执行、代写或代算后件 Program；后件按自身 trigger、use_program 或显式 run 使用既有 ABI 读取和计算。

#### Scenario: 后件自算
- **WHEN** 前件规则成立且 then 指向 Program Q
- **THEN** support 只发布支撑状态；Q 仅在自身触发条件满足时运行

### Requirement: 禁止线载源码与旧候选
satisfies、内联 def main、动态表达式、support@program、support@reverse 及在线项内放源码 MUST 返回 `SUPPORT_INLINE_PROGRAM_UNSUPPORTED` 或 `INVALID_SUPPORT_KEY`，不得兼容为活跃语法。

#### Scenario: satisfies 被拒绝
- **WHEN** thing@program RHS 提交 satisfies 表达式
- **THEN** 解析失败且不写入

### Requirement: Program ABI 保持兼容
Program endpoint MUST 沿用 main(arguments)、current_atom、explore/transform、trigger、use_program、锁与事务契约。support 求值参数 SHALL 为只读空 JSON object；Program 可通过 current_atom 与既有 exact/current-domain Explore 读取自身显式逻辑，不新增平行 ABI。

#### Scenario: use_program 保持兼容
- **WHEN** 既有 Program 使用 main(arguments)
- **THEN** 四轴迁移后参数和返回契约不变

### Requirement: Program 节点只保留新 ABI
迁移 SHALL 保持 thing@program identity、contain、support、锁、trigger 与业务计算语义。旧 Graph ABI 只可由一次性 upgrader 在 AST 证明后修改 Graph API 结构键与 AtomView 属性 token；不得全局替换或修改普通字符串。无法唯一升级者 MUST 阻断迁移。正式 worker/runtime 与 manifest MUST 不含 legacy Program wrapper、双 ABI 分支或兼容授权。默认备份仓 Program 保留原字符但不可执行；活跃与 exact test 可执行 Program 升级后全部只接受新 ABI。

#### Scenario: 旧 Program 使用 name
- **WHEN** dry-run 的 AST 发现源码调用 explore({name:...}) 且 key 是 literal Graph 参数
- **THEN** 报告精确 Program 路径、before/after 源码哈希、位置与 `name→thing` edit，并在同一事务提交升级源码

#### Scenario: 普通正文提到旧轴
- **WHEN** Program 注释、字符串或非 Graph object 中出现 name/detail/children/partners
- **THEN** 源码字符保持不变且不得被识别为可迁移调用

#### Scenario: 歧义 Program 不靠 wrapper 运行
- **WHEN** 非备份 Program 包含不可证明等价的旧 ABI 调用
- **THEN** 迁移门禁列出精确 Program 并拒绝提交；运行时不提供兼容执行路径
