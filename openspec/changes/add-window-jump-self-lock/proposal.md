## Why

Atom 现有 Program 锁、Transform 触发和槽体相对域已能限制节点并局部调度，但仍缺少一个公开且原子的“执行窗口迁移”能力、窗口自身的默认访问边界，以及可选的槽体结构封印。缺少这三段内核契约时，使用方只能在业务 Program 中拼接移动、权限和槽结构规则，容易产生越界访问、全世界重算、半次迁移或槽例伪结构。

## What Changes

- 注册 `jump({when?, where?, recycle?, lock?})`：复用 Graph support/Transform 反向索引调度，在命中后按 `recycle` 优先、否则按 `when` 与 `where` 原子回收或迁移当前执行窗口；省略 `when` 即守窗，失败保持原位并返回稳定错误。
- 注册轻探针 `changed(things)`：只接受精确 Thing 坐标对象数组，以 Transform 反向索引判断本次事务是否涉及目标；未命中时返回 `false` 并阻止后续复杂 Program 计算。
- 以当前 Agent 产出 `jump` 注册结果作为窗口自锁的激活边界：注册后该窗口立即进入受自锁窗口态；未注册 `jump` 的既有 Agent 窗口维持旧访问行为。激活后的默认读边界覆盖当前节点、全部后代、同父兄弟和唯一直接父节点；默认写边界仅覆盖当前节点的后代。显式 `lock` 在 read/write 两侧分别支持带正整数 priority 的 allow/deny 规则列表；规则从 `current` 或 `explore()` 返回的精确 Thing 坐标展开 exact thing、唯一 parent、同父 peers 与有限/全部 descendants，最高优先级胜出且同级冲突 deny，未命中仍回落默认自锁。当前窗口只能维持或收紧自己的已生效边界。
- 扩展 `slot_body({"action":"seal",...,"lock":...})`：由使用方选择是否安装槽体节点锁。启用时锁定映射槽节点自身及其结构/规则，仍允许在映射槽后代写入普通料；拒绝槽例窗口新增映射槽位或伪装槽角色，槽模 reseal 通过既有节点锁与窗口自锁交集授权后可原子覆盖。
- 将跳窗后的相对 support、changed 监测与窗口自锁按新 `scope_root` 重新绑定，不物理改写槽模模板推线，不引入第二套全局调度器，也不改变 Graph 的 thing/situation/contain/support 四轴。
- 从同一权威契约发布 Program 注册表、CLI Help、错误码、事务/回滚语义与安全示例；明确未启用槽体 lock 的结构篡改风险。

## Capabilities

### New Capabilities

- `window-jump-scheduling`: `jump`、`changed`、索引触发、回收优先级、原子迁移和跳窗后的槽例域重绑定。
- `agent-window-self-lock`: `jump` 注册激活的 Agent 窗口默认自锁、未注册窗口兼容边界、精确坐标 allow/deny 优先级规则、不可自扩及跨锁交集授权。
- `slot-body-structure-locking`: 可选槽体结构锁、映射槽 self 与普通料后代的权限区分、伪槽拒绝及受权 reseal 覆盖。

### Modified Capabilities

None. 当前仓库没有已归档的主规格目录；本变更以新 delta capabilities 明确补齐现有运行时之上的公开行为。

## Impact

- Program worker、Program 结果/函数注册表与运行时调度索引。
- 世界查询/Transform 授权、中央候选事务、窗口移动/回收与回滚。
- 槽体 seal/print/reseal 计划、稳定映射角色和相对 support scope 绑定。
- CLI Help、HTTP/Web 共用公开契约及对应聚焦、回归和端到端测试。
- 不修改 ESG、共享 4784 或正式 Atom 数据；运行态加载与真实 ESG 验收由总控完成。
