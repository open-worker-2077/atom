# Task 5 I3 repair report

- **状态**：IMPLEMENTED，等待独立复审。
  - **范围**：只修复 final review I3 的 schemaVersion 1 prepared 切换恢复；I1/I2 实现、生产、main、stash、remote、`AGENTS.md` 与生成 bundle 均未修改。
  - **实现提交**：`bd2f656` (`fix(atom): recover verified legacy prepared commits`)。
- **根因**：新 JSON world repository 始终暴露 `durableCommitEvidence()`，因此旧 coordinator 的 afterRevision 回退不再可达；同时该回退在不提供证据接口的仓储上仍会无条件信任 revision，无法区分旧格式切换状态与新格式冒名 command。
- **RED**：按旧磁盘合同和反向所有权矩阵分两轮固定失败。
  - 真实 schemaVersion 1 base journal、完整 before/after/receipt、after facts 已替换且没有 local proof：after-world-write 为 `TRANSACTION_RECOVERY_CONFLICT`，before-world-write 与 schemaVersion 2 反例通过；结果 2 pass、1 fail。
  - 隐藏 world 耐久证据接口后，schemaVersion 2 冒名 command 借相同 afterRevision 被错误收口；3 pass、1 fail。另将旧 prepared 的 after facts 改成不匹配其 revision，旧路径同样错误收口；3 pass、1 fail。
- **最小实现**：旧格式来源、记录身份和事实哈希共同构成窄切换证据。
  - transaction journal 在装载 schemaVersion 1 base 时记录 prepared 来源；任一 schemaVersion 2 prepared/committed/aborted event 都会取消该旧来源身份。
  - coordinator 仅在当前世界等于 afterRevision 时验证 command、correlation、world、before/after revision、receipt 及两份 facts 哈希，再向 journal 请求完全匹配的 schemaVersion 1 证据。
  - 删除无耐久接口时的 revision-only 回退；普通新格式仍需 exact durable command evidence。before-world-write 继续走既有 CAS、耐久确认和 receipt 收口，after-world-write 只补 journal 决定，不重写事实。
- **GREEN**：I3 定向与受影响链均使用实现提交候选执行。
  - schemaVersion 1 before/after、schemaVersion 2 冒名及伪造 snapshot 矩阵：4 pass、0 fail、0 skipped，`105.6659ms`。
  - 恢复身份 focused：11 pass、0 fail、0 skipped，`338.9547ms`；完整 transaction + failure recovery：90 pass、0 fail、0 skipped，`3,645.805ms`。
  - 真实 Agent migration operator 的无 local proof schemaVersion 1 after-world-write 子例：1 pass、0 fail，`451.9842ms`；postcommit boundary：46 pass、0 fail、0 skipped，`29,311.2093ms`。
  - I2 提交后的五文件 preservation gate（World Service、transaction、postcommit、Graph migration、failure recovery）：171 pass、0 fail、0 skipped，`33,035.7902ms`。
  - 完整 Agent migration 在 I2 提交前后都为 19/22；I3 旧切换子例持续通过，三个失败是两项 rollback 后 Graph projection `INVALID_ATOM_FIELD` 和一项 forged-receipt current-world revision 断言。该外部红项已通知 I2 与总控，不作为 I3 成功证据，也未越界修改。
- **边界守恒**：旧 before/after 两夹具均证明最终 facts 等于 after、重复 recover 为 0、prepared 清空且 committed event/receipt 只有一份；新格式与无效旧快照保持 prepared 且零 receipt。GitNexus staged change detection 为 MEDIUM，映射到 coordinator 的 recovery/commit/rollback；索引早于当前分支，动态门禁覆盖实际 I3 路径。
