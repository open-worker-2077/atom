# Inline Strut Predicate And Transform Actions Implementation Plan

> **执行规则：** 使用 `systematic-debugging`、`test-driven-development` 与 `verification-before-completion`；每项先取得 RED，再最小实现至 GREEN。旧的独立 click trigger 计划已经作废。

**目标：** 推支线在自身 `if` 内携带判定 Program，读取结构化上下游与本次 Transform `$动作`，只在严格返回 `true` 时向后项投递；点击只是可注册动作之一。

**架构：** Graph parser 将 `{ "program": "..." }` 编译为 Strut AST 的内嵌判定叶，源码不落成 Thing、Agent 或全局 trigger。Transform parser 通过独立动作注册表解释 `thing$动作`，产生不可变动作信封；Strut runtime 用现有受限 Python worker执行临时 Program，并把动作信封与前后项快照作为只读 context。Explore 继续只读，Transform 统一承载交互和改造动作。

## Task 1：内嵌判定语法

- [x] 失败测试：接受 `program` 叶；拒绝空源码、未知字段和后项 Program。
- [x] 最小实现：AST 保存源码、表达式位置和稳定判定 ID；依赖索引只包含事实前项。
- [ ] 回归：N→1、1→N、AND/OR 与 N→M 禁令保持成立。

## Task 2：通用 Transform `$动作`

- [ ] 失败测试：`thing$click` 解析为注册动作，不再作为 Explore matcher；未知动作稳定拒绝。
- [ ] 扩展性测试：测试注册第二种 `$动作` 时不修改 Strut parser/runtime/delivery。
- [ ] 最小实现：输出统一 `{name, parameter, targetPath, payload, source}` 动作信封；不伪造事实改动。

## Task 3：判定执行与布尔投递

- [ ] 失败测试：内嵌 Program收到 clause、前项、后项、Transform 动作；严格 `true` 才投递，`false` 零投递，非布尔失败。
- [ ] 最小实现：复用受限 Python worker执行临时 Program，禁止效果、调度与持久注册。
- [ ] 调度接入：事实变化或目标动作均只重算受影响推支线；复合前项一次取得一致快照。

## Task 4：入口与真实验收

- [ ] CLI：`transform {"thing$click":"精确路径"}` 进入同一 Transform 链。
- [ ] Web：点击适配为相同动作，不新增 click 专用 endpoint 或独立 trigger。
- [ ] 用测试 Graph 跑通“前项完成 → true → 后项解锁/状态推进”，不等待 ESG 真实数据。
- [ ] 更新 Help、规范和持久化账本；运行聚焦测试、相关回归与完整测试。
- [ ] 分段提交形成安全回退点；全部验证后再处理其他 Web Bug。
