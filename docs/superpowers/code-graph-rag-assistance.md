# 代码关系检查

## 定位与边界

本页是Superpowers统一管理源码关系检查的按需入口。GitNexus、Code-Graph-RAG及后续替代工具只提供代码关系候选，不替代规格、计划、源码裁定、TDD、验证及唯一需求总账；不得自主编辑Atom、生成第二套开发规则或把动态统计写入`AGENTS.md`。

## GitNexus

- **来历**：第三方社区工具`abhigyanpatwari/GitNexus`，不是Git或GitHub官方机制。
- **用途**：按符号查看调用上下游、执行路径和当前diff的潜在影响；结果必须回读源码，并由最小受影响测试和真实旅程裁定。
- **性能边界**：索引绑定源码修订并复用；只有相关源码变化才更新，不因文档、巡守或普通汇报重建全仓。
- **无污染更新**：只能使用`gitnexus analyze --index-only`更新索引。该模式不写`AGENTS.md`、`CLAUDE.md`或工具技能；禁止在Atom仓库运行会注入这些文件的普通`gitnexus analyze`。
- **使用节奏**：实质代码修改前查询直接关联符号；修改后检查当前diff影响。静态误连、漏连、动态调用和过期索引均不能当作安全证明。

## Code-Graph-RAG 已验证安装

- 版本：`code-graph-rag[treesitter-full]==0.0.845`，由`uv tool install`安装在独立全局用户工具环境。
- 入口：`C:/Users/worker/.local/bin/cgr.exe`。
- Python：`C:/Users/worker/AppData/Roaming/uv/tools/code-graph-rag/Scripts/python.exe`。
- 官方仓库：<https://github.com/vitali87/code-graph-rag>。
- 全仓离线索引：`C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632`；源码基线`b4c2632b5c2b2debd259c520e4ebecb5ffd51952`，建图开始时clean。
- 结果：12238节点、83065关系；339个JavaScript模块、5个Python模块、112个语言归类unknown模块。unknown不等于完整语言语义支持；manifest的flow_covered均为0，不能据此断言数据流不存在。
- 排除范围：node_modules、.worktrees、vendor及工具默认／仓库gitignore；实查索引中这三类module数量为0。包含源码与测试，未索引生产世界。
- 工具`verify-index`成功验证产物与manifest一致；发布包缺少schema.proto导致`codec_schema_sha256=null`，该结果不等于上游签名验证或调用准确率保证。

## Code-Graph-RAG 使用方式

首次建图命令（Windows使用目录名，不能用会被CLI展开为海量文件参数的通配符）：

```powershell
C:/Users/worker/.local/bin/cgr.exe index --repo-path D:/Project/〇/subprojects/atom -o C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632 --exclude vendor --exclude .worktrees --exclude node_modules
C:/Users/worker/.local/bin/cgr.exe verify-index -i C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632
```

后续索引新版本使用新目录，不覆盖旧快照。仅源码发生相关变化时更新；不能因每小时巡守重扫。该离线入口与在线增量库不同，不能声称已经配置在线增量更新。

局部检索直接由上述Python读取官方`codec.schema_pb2.GraphCodeIndex`的`index.bin`，按`Relationship.type`枚举CALLS与source_id／target_id精确筛选；进程可以完整载入二进制，但只向Agent输出有关节点和边，不输出全图或指纹。无需调用其自然语言模型接口。优先限定符号全名、方向与结果数，再按节点行号回读源码。

已实测：`atom.work-engine.atom-language.query-capability.executeExploreItem`的调用者包括`engine.executeAtomLanguageInteraction`及`query-capability.executeProgramExplore`；引擎还关联`revisionOfWorldFacts`、`programLockState`、`relevantProgramMessages`等结果组装链，可作为当前延迟分析入口。

## Code-Graph-RAG 已知风险

本次索引存在静态误连：executeExploreItem的部分source／match等局部名称被连到测试同名函数，不能把全部CALLS当作确定调用。关键边回读imports、词法作用域和调用现场确认；缺边亦不证明无调用。索引只绑定main基线，隔离分支改动必须回读diff，不能冒充当前候选版本事实。

默认DEBUG输出极大；以后运行须将详细日志留在仓库外并只返回摘要。初次运行未控制此输出，工具结果虽截断但造成额外输出成本，不重复该用法。

原工具在源码根生成四个缓存，已移到索引目录，不删除。迁移明细见`../file-management/2026-09-04-code-graph-rag-cache.md`。下一次运行如需缓存，先核对该工具版本支持的缓存使用方式，不能伪造增量状态。
