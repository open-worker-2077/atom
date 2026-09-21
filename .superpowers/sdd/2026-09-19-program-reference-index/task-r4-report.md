# Task R4 report

- **范围**：仅实施 Revised R4「中央事务内核引述绑定」；基线 `cd56966`，产品与测试提交 `ba1664d41817bbb885964197ce776f14a9dd5093`。未实施 R5 冷启动、R6 热路径／旧数据迁移或 R7 部署；未增加 sidecar、第五轴或可见 ID；正式 current-requirement ledger 未修改、未暂存。
- **结论**：R3 站点与候选写入阶段一次解析得到的 target Thing ID 现在以隐藏 `programRefBindings` 元数据和 Program facts 同收据提交；receipt replay 可重建不可变的 Program-ID binding snapshot， disposable index 只消费该 snapshot 与当前 ID→path。

## 实现主干

- **中央收据**：新增 `program-ref-binding-ledger.mjs`，校验 version 1 replacement/removal、重放压缩后收据、计算 rollback 逆向 delta，并生成不可变 snapshot。
- **同代提交**：Program create/update/delete 在候选校验后生成 normalized-source binding delta，经既有 disk/memory transaction coordinator 与 facts 原子接受；冲突、journal prepare 失败、重试、恢复和 rollback 均复用中央事务边界。
- **索引边界**：reference index 不再解析 Situation 或用可读 path 推断 target ID；缺失 binding、source hash 不符、target ID 不存在分别局部隔离为 `PROGRAM_REF_BINDING_MISSING`、`PROGRAM_REF_SOURCE_MISMATCH`、`PROGRAM_REF_TARGET_MISSING`。
- **公开净化**：普通 commit/rollback、幂等重试、Program execution 查询、回调和错误 receipt 均删除内部 binding metadata；端到端 Program create/update 断言应用输出不含 target ID。

## RED 证据

- **基线探针**：旧 index 合约在显式 `ref()` 基线上得到 13 pass / 4 fail，证明原实现仍依赖 Situation path 重绑。
- **首轮 R4 RED**：`node --test tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-memory-transaction-ports.test.mjs` 得到 7 pass / 3 fail；失败为 ledger 模块不存在与 memory journal 缺少 `readMetadataState()`。
- **透传 RED**：暂时断开 engine 的 binding delta 透传后，create/update integration 为 0/1；恢复最小透传并修复 create transform 返回值后转 GREEN。

## GREEN 与验证

- **精确套件**：`node --test tests/atom-program-ref-binding-ledger.test.mjs tests/atom-program-reference-index.test.mjs tests/atom-memory-transaction-ports.test.mjs tests/atom-language-transform-receipt.test.mjs`：24/24 pass，0 fail。
- **相邻写入**：`node --test tests/atom-program-reference-write.test.mjs`：23/23 pass，0 fail。
- **相邻事务**：对 `atom-world-transaction` 与 `atom-worker-recovery` 运行 repeated command ID、rollback、prepared recovery、metadata initialization/restart 定向筛选：5/5 pass，0 fail。
- **差异门禁**：`git diff --check` exit 0；只有 Git 的 LF→CRLF 工作区提示，无 whitespace error。未运行 full `npm test`，遵守 brief 的明确边界。

## 自审与 concerns

- **初轮自审**：逐文件核对了 receipt 写入／净化、memory metadata、rollback rebase、replay removal、source hash 与 index ID-path 投影；删除了无用导出，并补充真实 disk journal prepare 失败与 Program deletion 持久化覆盖。独立复核随后发现空源码旧 binding 残留、missing-target 诊断泄露及两处 replay 断言被过滤器掩盖，均进入下述 fix round。
- **阶段依赖**：额外非验收探针 `atom-program-reference-write + atom-memory-persistence-integration` 为 27/28；失败项 `Program source and subsequent facts both execute against accepted memory before save` 使用没有历史 binding receipt 的旧启动 Program，现按 R4 要求被局部隔离。把旧数据生成／冷启动接入留给已规划的 R5/R6，未在 R4 越界提供 path fallback。
- **Superpowers 核对**：本会话核对插件 6.4.1（manifest SHA-256 `8F879F5E2F04C5D2A93BD9EA455072384DC35D01F1DFC5307CA1BE0CEF5BE9AA`）相对 6.3.0；SP-L01/L02/L04/L05 继续本地补充，SP-L03 与 brief 的“不得 full npm test”存在语义冲突，本任务按更直接的 brief 执行。核对记录留在既有 SDD progress，不新建状态源。

## Commit

- `ba1664d41817bbb885964197ce776f14a9dd5093` — `feat: persist hidden Program reference bindings`（R4 产品与测试）。
- 本报告作为后续 docs-only 提交；其提交 SHA 由最终 HEAD 记录，避免在提交内容中制造自引用哈希。

## 独立复核 fix round 1

- **问题与边界**：复核状态 Not Approved。仅修 R4：Program Situation 从非空改为 `""` 或纯空白时必须用同一 Program ID、实际新 source hash 和 `sites:[]` 覆盖旧 binding；`PROGRAM_REF_TARGET_MISSING` 的 scheduler exception/runtime warning 不得含 Program/target Thing ID。R5 runtime 启动传入 binding snapshot 仍只记录为后续边界，本轮未接线。
- **真实 RED**：engine create→clear integration 对空字符串与纯空白分别得到 `replacement=[]`，两项均失败；纠正测试夹具 ID 长度后，index→scheduler 定向测试 4/5，异常序列化仍含隐藏 ID。三项均由缺失行为而非语法或 mock 失败。
- **最小修复**：engine 对已发生源码变化的空／纯空白 Program 补完整 replacement；index 的 missing-target message 不拼接 target ID；scheduler 将内部 identity-bearing failure 映射为只含稳定 code、可读 `programPath`、`fingerprint` 与 `role` 的公共诊断。
- **证据加固**：Program deletion 直接断言原始 receipt delta 为 removal，并在不传 `currentPrograms=[]` 的情况下 replay；commit conflict 直接断言原始 receipts 无 losing replacement，再无过滤 replay。
- **GREEN**：R4 精确套件 27/27；相邻 `atom-program-reference-write` 23/23；因修改 scheduler，完整相邻 `atom-program-runtime-scheduling` 71/71。`git diff --check` 仅有 LF→CRLF 提示，无 whitespace error；仍按 brief 未运行 full `npm test`。
- **Fix commit**：本节与产品／测试修复进入同一 fix commit；精确 SHA 由 Git 历史与最终回报记录，避免报告内容自引用。
