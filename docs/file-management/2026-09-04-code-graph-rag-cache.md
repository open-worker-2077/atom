# Code-Graph-RAG 建图缓存归位

2026-09-04工具首次建图在Atom源码根目录写入四个本地缓存。为保持根目录可读，已逐文件移动，目标存在即拒绝覆盖，无删除。

源目录：`D:/Project/〇/subprojects/atom`

目标目录：`C:/Users/worker/AppData/Local/CodeGraphRAG/indexes/atom-main-b4c2632`

同名移动：`.cgr-dir-mtimes.json`、`.cgr-exclusion-state.json`、`.cgr-hash-cache.json`、`.cgr-parser-fingerprint`。

用途：工具索引缓存；不属于Atom软件或业务世界。需要时可从目标目录恢复，索引正文与manifest也保留在目标目录。
