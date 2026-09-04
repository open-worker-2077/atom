# Code-Graph-RAG 辅助检索

## 定位与边界

用户于2026-09-04授权全局安装、全仓源码建图、按需局部检索。它仅为Superpowers系统调试／影响分析提供代码关系候选，不替代规格、计划、TDD、验证及唯一需求总账。不启用其自主编辑、优化Agent或第二套开发流程。不为静态建图配置付费模型、语义嵌入或数据库服务。

## 已验证安装

- 版本：`code-graph-rag[treesitter-full]==0.0.845`，由`uv tool install`安装在独立全局用户工具环境。
- 入口：`C:/Users/worker/.local/bin/cgr.exe`。
- Python：`C:/Users/worker/AppData/Roaming/uv/tools/code-graph-rag/Scripts/python.exe`。
- 官方仓库：<https://github.com/vitali87/code-graph-rag>。
- 全仓离线索引：`C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632`；源码基线`b4c2632b5c2b2debd259c520e4ebecb5ffd51952`，建图开始时clean。
- 结果：12238节点、83065关系；339个JavaScript模块、5个Python模块、112个语言归类unknown模块。unknown不等于完整语言语义支持；manifest的flow_covered均为0，不能据此断言数据流不存在。
- 排除范围：node_modules、.worktrees、vendor及工具默认／仓库gitignore；实查索引中这三类module数量为0。包含源码与测试，未索引生产世界。
- 工具`verify-index`成功验证产物与manifest一致；发布包缺少schema.proto导致`codec_schema_sha256=null`，该结果不等于上游签名验证或调用准确率保证。

## 使用方式

首次建图命令（Windows使用目录名，不能用会被CLI展开为海量文件参数的通配符）：

```powershell
C:/Users/worker/.local/bin/cgr.exe index --repo-path D:/Project/〇/subprojects/atom -o C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632 --exclude vendor --exclude .worktrees --exclude node_modules
C:/Users/worker/.local/bin/cgr.exe verify-index -i C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632
```

后续索引新版本使用新目录，不覆盖旧快照。仅源码发生相关变化时更新；不能因每小时巡守重扫。该离线入口与在线增量库不同，不能声称已经配置在线增量更新。

局部检索直接由上述Python读取官方`codec.schema_pb2.GraphCodeIndex`的`index.bin`，按`Relationship.type`枚举CALLS与source_id／target_id精确筛选；进程可以完整载入二进制，但只向Agent输出有关节点和边，不输出全图或指纹。无需调用其自然语言模型接口。优先限定符号全名、方向与结果数，再按节点行号回读源码。

已实测：`atom.work-engine.atom-language.query-capability.executeExploreItem`的调用者包括`engine.executeAtomLanguageInteraction`及`query-capability.executeProgramExplore`；引擎还关联`revisionOfWorldFacts`、`programLockState`、`relevantProgramMessages`等结果组装链，可作为当前延迟分析入口。

## 已知风险

本次索引存在静态误连：executeExploreItem的部分source／match等局部名称被连到测试同名函数，不能把全部CALLS当作确定调用。关键边回读imports、词法作用域和调用现场确认；缺边亦不证明无调用。索引只绑定main基线，隔离分支改动必须回读diff，不能冒充当前候选版本事实。

默认DEBUG输出极大；以后运行须将详细日志留在仓库外并只返回摘要。初次运行未控制此输出，工具结果虽截断但造成额外输出成本，不重复该用法。

原工具在源码根生成四个缓存，已移到索引目录，不删除。迁移明细见`../file-management/2026-09-04-code-graph-rag-cache.md`。下一次运行如需缓存，先核对该工具版本支持的缓存使用方式，不能伪造增量状态。
