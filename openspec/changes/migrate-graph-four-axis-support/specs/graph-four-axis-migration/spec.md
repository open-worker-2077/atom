## Purpose

为旧四轴世界、嵌套 Graph、Program 与模板提供可恢复、事务化且不猜测 partners 语义的一次性迁移。

## ADDED Requirements

### Requirement: 迁移前可恢复备份
任何真实迁移 MUST 在首个事实改动前创建与源修订绑定、完整性可验证且可恢复的备份。失败 SHALL 返回 `GRAPH_MIGRATION_BACKUP_FAILED` 并保持世界不变。

#### Scenario: 无备份不迁移
- **WHEN** 备份创建、持久化或校验失败
- **THEN** 世界修订与投影不变且不存在迁移提交

### Requirement: 只迁移已识别结构
迁移器 SHALL 只将 parser 识别的 `name/detail/children/partners` 结构位置映射为新轴。正文、Program 源码与业务 JSON 字符串 SHALL 逐字保持，不得全局替换。

#### Scenario: 正文不误改
- **WHEN** detail 中包含旧新轴普通字符串
- **THEN** 只有结构 key 改为 situation，正文字节不变

### Requirement: 旧 partners 无损性阻断
由于任意 `verb/object` 不存在到显式 if/then 的通用无损映射，任何非空旧 partners SHALL 返回 `UNMAPPABLE_LEGACY_SUPPORT_RELATION` 并阻断迁移。诊断 MUST 保留 source、ordinal、原始 verb 与 object 全部字符，不得猜含义、丢字符、压平或新增字段。空 partners MAY 映射为 `support:[]`。

#### Scenario: 非空 partner 阻断整批
- **WHEN** 任一旧节点含 partner，无论 verb 是否为空
- **THEN** 预检逐项报告原值且整批不可提交

#### Scenario: 空 partners 可迁移
- **WHEN** 所有 partners 均为空且其他结构合法
- **THEN** planner 产生空 support 并通过关系守恒检查

### Requirement: 嵌套批量迁移原子化
迁移 SHALL 递归覆盖 contain 层级、类型/简介 key、旧 Program、模板与消费端。获批批次 SHALL 基于 expected revision 预检并原子提交；任一错误或 revision 冲突 SHALL 使整批不写入。

#### Scenario: 嵌套 Graph 守恒
- **WHEN** 三层以上且无非空 partners 的旧树通过预检
- **THEN** path、对象数、层级、类型、situation bytes 与数组顺序守恒

#### Scenario: 失败不留半迁移
- **WHEN** 任一对象或模板无法转换
- **THEN** 整批不提交且其他对象保留旧修订

### Requirement: 一次性读取边界与回退
旧 reader 只 MAY 存在于版本化 planner 中；常规 CLI、Web、Program、Help 与写入 SHALL 只接受新语法。回退 SHALL 从备份恢复为新的审计修订，不覆盖 backing JSON 或抹除历史，并拒绝跨越后续提交。

#### Scenario: 旧入口关闭
- **WHEN** 常规入口使用旧轴或旧方向标记语法
- **THEN** 系统返回稳定错误，日常路径不导入 migration reader

#### Scenario: 回退保留历史
- **WHEN** 对未被后续修订跨越的迁移执行 rollback
- **THEN** 备份事实恢复为新修订，迁移与回退事件均保留
