## Purpose

为同一应用世界的旧持久编码、嵌套 Graph、Program 与模板提供可恢复、事务化且不猜测 partners 语义的内核编码升级；不迁移应用节点或业务语义。

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

### Requirement: 旧 partners 原位进入受信 support 编码
由于任意 `verb/object` 不存在到显式 if/then 的通用无损映射，迁移 SHALL 只将外层 `partners` 键改为 `support`，内部 `{verb,object}` 数组项、字符与顺序 MUST 不变。版本化持久 adapter MUST 仅在 revision-bound manifest 命中的受信快照中把这些项识别为 legacy-support entry；它们 MUST 可由兼容查询/投影呈现，但 MUST NOT 被解释为 if/then 或进入新 support dependency/endpoint/Program 推理索引。升级 MUST 保持节点数、路径、contain 拓扑和事实语义，不得生成、移动或删除业务节点。

#### Scenario: 非空 partner 保全文字
- **WHEN** 任一旧节点含 partner，无论 verb 是否为空或包含何种 Unicode 字符
- **THEN** 预检报告原值，升级后同一节点的 `support` legacy entry 与原 partner 逐字、逐序相等

#### Scenario: 兼容事实不伪造 support
- **WHEN** 旧 partner 的 verb 无已裁定的新语义
- **THEN** 升级后的来源和目标均不新增由该 verb 猜出的活跃 support clause

#### Scenario: 空 partners 可迁移
- **WHEN** 所有 partners 均为空且其他结构合法
- **THEN** planner 产生空 support 并通过关系守恒检查

### Requirement: 嵌套批量迁移原子化
迁移 SHALL 递归覆盖 contain 层级、类型/简介 key、旧 Program、模板与消费端。获批批次 SHALL 基于 expected revision 预检并原子提交；任一错误或 revision 冲突 SHALL 使整批不写入。

#### Scenario: 嵌套 Graph 守恒
- **WHEN** 三层以上且可含任意 legacy partners 的旧树通过预检
- **THEN** path、对象数、层级、类型、非 Program situation bytes、Program 非结构源码片段与数组顺序守恒

#### Scenario: 失败不留半迁移
- **WHEN** 任一对象或模板无法转换
- **THEN** 整批不提交且其他对象保留旧修订

### Requirement: 持久兼容边界与回退
旧 reader 只 MAY 存在于版本化持久 adapter 与 planner 中；常规 CLI 输入、Web 编辑、新 Program、Help 与写入 SHALL 只接受新语法。含旧轴的权威快照 MUST 可启动并由受控迁移升级；升级后的受信 legacy-support entry 与新 if/then clause MAY 在同一世界存在，普通四轴写入不得被全世界锁死。用户对一个节点显式全文替换新 support 时，旧 relation 才由该应用动作移除。回退 SHALL 从备份恢复为新的审计修订，不覆盖 backing JSON 或抹除历史，并拒绝跨越后续提交。

#### Scenario: 旧世界可启动并受控写入
- **WHEN** 权威快照仍含旧轴、partners 或旧 Graph ABI Program
- **THEN** 新运行时可加载、预检并按事务升级编码；升级后普通新四轴写入可执行，未被显式替换的 legacy relation 保持不变

#### Scenario: 旧入口关闭
- **WHEN** 常规入口使用旧轴或旧方向标记语法
- **THEN** 系统返回稳定错误，日常路径不导入 migration reader

#### Scenario: 回退保留历史
- **WHEN** 对未被后续修订跨越的迁移执行 rollback
- **THEN** 备份事实恢复为新修订，迁移与回退事件均保留
### Requirement: 全量预检与执行门禁
预检 SHALL 在一个 revision-bound 快照上完成一次结构遍历，返回节点数、legacy partner 节点数/条目数、Program 总数，以及按默认备份仓、调用方 exact test 根、活跃域分类的旧 ABI Program。报告 MUST 为每个旧 Program 给出 exact path、before/after 源码哈希、调用、旧轴、行列、逐项 edit/blocker 与处置；为每个 partner 给出 source、ordinal、verb、object。预检 MUST 收集全部问题而非首错退出，并产生可机器执行的 `readyToCommit` 门禁。

#### Scenario: 任意规模世界完整聚类
- **WHEN** 对同一只读修订运行预检
- **THEN** 报告返回该修订的完整节点、legacy partners、Program 与备份/test/活跃分类计数及逐项清单，且不写世界

#### Scenario: 修订漂移
- **WHEN** 预检后权威修订发生变化
- **THEN** 提交返回 `GRAPH_MIGRATION_REVISION_MISMATCH` 且必须重新预检和备份

### Requirement: Program 一次性结构升级与执行边界
所有非默认备份仓中的可执行旧 Graph ABI Program MUST 在迁移事务中原地升级为新四轴调用。升级器 SHALL 以 Python AST 和词法块局部定义使用链证明 Graph API 字典键、Graph specification 或 AtomView 来源，并只改对应结构 token。直接 literal 与可唯一归约、在同一 block 内支配消费点的单一 reaching definition 均 MAY 生成 edit；只要存在多重赋值、控制流歧义、逃逸、别名写入、动态构造或来源不明就 MUST 阻断。Graph specification 集合除 For.iter 外只 MAY 被纯 `len(binding)` 观察基数，其他用途均视为逃逸。普通字符串、注释、业务表达式、其他对象属性与计算语义 MUST 不变。迁移 manifest MUST NOT 保存 Program 兼容授权，worker/runtime MUST NOT 提供 legacy ABI wrapper。typed default backup 下 Program SHALL 保留原源码字符且永不进入执行集；调用方 exact test 根只用于报告分类，其可执行 Program 仍必须升级。

#### Scenario: 默认备份 Program 保留历史原文
- **WHEN** 旧 ABI Program 位于 typed default backup
- **THEN** 源码 hash 与字符不变、报告为 `historical-non-executable`，且冷启动、trigger、use_program 和显式 run 均不能执行它

#### Scenario: 活跃与 test Program 原地升级
- **WHEN** AST 唯一定位 explore/transform literal dict 旧轴键或可证明的 AtomView 旧属性访问
- **THEN** 预检生成 before/after hash 与逐项 token edit，事务提交升级源码，升级后只走新 ABI

#### Scenario: 歧义升级阻断上线
- **WHEN** Program 使用动态 Graph key、字典展开、来源不明的旧属性或任何不能唯一结构化转换的形态
- **THEN** `readyToCommit` 为 false，并逐项报告 exact path/source hash/行列/原因，世界保持原修订

#### Scenario: 普通字符串不改
- **WHEN** Program 注释、日志文本、selector 值或非 Graph object 中出现 name/detail/children/partners
- **THEN** 这些源码字节保持不变且不生成 edit

#### Scenario: 局部常量 Graph key 可证明升级
- **WHEN** Graph call 的 dict key 由同一 module/function 控制块内的单一 reaching definition 绑定旧轴常量，该赋值支配唯一 key 消费，且表达式无重赋值、逃逸或副作用
- **THEN** upgrader 只在 Graph dict key 结构位置写入对应新轴 literal，原常量绑定和其他普通用途保持逐字不变

#### Scenario: 局部 Graph specification 可证明升级
- **WHEN** explore/transform 首参 Name 在同一词法块内只有一个支配该调用的 literal dict 定义，且该 dict 未逃逸、未变异并只含可证明键；批量 List 只额外进入 `len(binding)`
- **THEN** upgrader 对该 Graph specification 的旧轴结构 token 生成最小 edits；任一证明条件不成立仍按 exact blocker 拒绝

#### Scenario: 注册过滤函数保持 AtomView identity
- **WHEN** Explore rows 经正式注册 `direct_children` 返回，并且 upgrader 对当前 stdlib AST 验证其返回列表元素唯一来自输入 rows 原对象
- **THEN** 后续 For 中的 child 仍可证明为 AtomView；若 stdlib 证明失配或 Program 自定义同名函数则不授予来源资格

### Requirement: 部署入口保持预检分类参数一致
部署脚本 SHALL 将每个 `--isolated-root` 操作参数解释为本次迁移报告的 exact test root，并以 operation 公开参数 `testRoots` 传给 `planGraphFourAxisWorldMigration`。脚本输出 SHALL 使用 `testRoots` 命名并与直接 planner 调用产生相同的 default backup/test/active 计数；该参数只影响分类，不隔离可执行 test Program 的升级。

#### Scenario: test 根从脚本贯通 planner
- **WHEN** 隔离 fixture 含一个 exact test root 下旧 ABI Program 与一个 active 旧 ABI Program，并以 `--isolated-root` 调用部署 preflight
- **THEN** 脚本报告 `testLegacyPrograms=1`、`activeLegacyPrograms=1`，且两项都必须升级或进入 blocker，不得把 test 项误计 active

### Requirement: manifest 随中央事务推进迁移谱系
manifest MUST 保存 currentWorldRevision，并与每次中央授权事实提交原子推进。无关写入 MUST 保留仍可验证的 legacy-support provenance；重启时 manifest revision 与当前事实 revision 不一致 MUST 拒绝启用该 provenance。legacy-support 资格 SHALL 由迁移数组内容指纹与授权出现次数验证，使节点改名/移动仍保持关系 provenance；显式 support 替换 SHALL 清除被移除旧数组的资格。manifest 不得包含 Program ABI 资格或源码授权。

#### Scenario: 无关写不使兼容整体掉线
- **WHEN** 中央事务只修改一个不相关普通节点
- **THEN** manifest currentWorldRevision 与事实原子推进，未变化 legacy relation provenance 继续有效，Program ABI 不受 manifest 影响

#### Scenario: legacy relation 随节点移动保持
- **WHEN** 含 legacy-support entries 的节点合法改名或移动且 support 未被替换
- **THEN** 数组指纹/出现次数仍匹配并继续作为 legacy relation 呈现

#### Scenario: 重启发现 manifest 漂移
- **WHEN** manifest currentWorldRevision 不等于权威事实 revision
- **THEN** 运行时拒绝启用 legacy relation provenance 并返回稳定迁移谱系错误；Program 仍只有新 ABI

### Requirement: 请求驱动锁侧车随部署事务升级
部署迁移 SHALL 在同一只读预检中读取内核拥有的 `request-driven-locks.json`，并且只在每个 lock 的 `fields` 数组中原位映射 `name→thing`、`detail→situation`、`children→contain`、`partners→support`。迁移 MUST 保持顶层键、lock 顺序、fields 顺序、重复以外的数组基数、窗口规则、目标、模式、保护项、刷新策略和所有其他字段结构等价；不得把该兼容能力带入 runtime repository、公开 parser 或 Program ABI。

若同一个 `fields` 数组同时含任一旧 Graph 轴与任一新 Graph 轴，或映射后产生同义重复，预检 MUST 返回 `AMBIGUOUS_REQUEST_DRIVEN_LOCK_GRAPH_AXIS`。非法顶层结构、非字符串 field 或闭集外 field MUST 返回 `INVALID_REQUEST_DRIVEN_LOCK_MIGRATION_SNAPSHOT`。任一错误 MUST 在世界或侧车首写前终止。

侧车原始字节、哈希和路径 MUST 纳入 source revision 绑定的私有备份与部署收据。apply SHALL 在世界迁移提交后以临时文件原子替换侧车，并用严格四轴 request-driven-lock repository 回读校验；侧车提交或校验失败 SHALL 回退本次世界迁移并恢复备份侧车。operator rollback SHALL 同时创建世界回退审计修订并恢复原侧车字节，不得只回退 atom.json。

#### Scenario: 旧锁 fields 无损升级
- **WHEN** 合法侧车包含多个旧轴 fields、`messages` 及其他锁配置
- **THEN** 每个旧轴按原 ordinal 映射为新轴，`messages` 与所有非 fields 数据逐结构保持，严格新仓库可加载升级结果

#### Scenario: 旧新轴混合在首写前拒绝
- **WHEN** 任一 lock.fields 同时含旧轴与新轴，或含 `name` 与 `thing` 等映射碰撞
- **THEN** 返回 `AMBIGUOUS_REQUEST_DRIVEN_LOCK_GRAPH_AXIS`，世界、侧车和备份目录均不改变

#### Scenario: apply 失败补偿与 operator rollback
- **WHEN** 侧车原子写入/严格回读失败，或操作员对成功部署执行 rollback
- **THEN** 权威世界回到源 revision 对应的新审计修订，侧车字节与源备份哈希一致
