# R7 完整门禁 RED 原始证据（2026-09-22）

- **候选 revision**：`873c031`（分支 `feat/program-reference-index`，含 Task 6 热态零改写修复）
- **命令**：`node --test --test-isolation=none tests/*.test.js tests/*.test.mjs`（即 `npm test`），在隔离工作树执行，未触碰正式 4784
- **状态**：未自然结束。运行至 `atom-transform-postcommit-boundary` 之后进程零 CPU 长时间挂起（两次复现），日志停在“改名验收”断言处，因此本清单为**部分证据**，不含尚未跑到的文件
- **规模**：97 个不同用例失败，分布在 21 个文件；原始日志为 357,889 字节
- **判定纪律**：并行多文件运行会因 CPU 负载产生假失败（同一用例单独运行通过），本清单取自 `--test-isolation=none` 串行运行

## 按文件清单

### atom-generated-slot-print-migration.test.mjs
- leaves the current generated ABI and handwritten print Programs unchanged
- maintenance applies within a 192 MB heap with real historical snapshot objects
- maintenance apply backs up the complete incremental journal, is idempotent, and rolls back exactly
- maintenance automatically rolls back a committed migration when projection postcheck fails
- maintenance dry-run reports the migration without writing world or backup files
- maintenance refuses a hash-invalid private backup without committing
- maintenance refuses an incomplete existing attempt without committing
- maintenance rejects a deployment receipt with a changed migrated-program mapping
- maintenance rejects a linked backup ancestor before writing through it
- maintenance rejects a linked canonical context leaf before dry-run reads it
- maintenance rejects a source change after backup starts before central commit
- maintenance rejects journal bytes changed after their semantic validation
- maintenance rejects rollback after a later world revision
- migrates a generated print whose main body alone was maintained to the renamed layout path
- migrates one exact historical generated print after an ancestor rename without changing source facts
- rejects a generated print whose main body names a third-party path
- rejects an entire candidate when a generated-looking print has extra behavior
- skips sealed print Programs inside an explicitly typed default backup domain

### atom-inline-strut-predicate.test.mjs
- inline predicate requires strict bool and cannot emit effects

### atom-language-cli-graph.test.mjs
- the full isolated public-CLI journey keeps shortcut execution in the moved Agent domain

### atom-language-graph-server.test.mjs
- public concurrent slot instances keep source history and Program failure isolated

### atom-language-operational-cli.test.mjs
- CLI keeps dot-command literals inside a situation rep replacement
- operational Atom Language closes one isolated transform/explore/projection loop

### atom-program-service-e2e.test.mjs
- 4784 exact Explore does not replay an unrelated slot effect after an explicit Program changes the world
- 4784 keeps a plain leaf create local while Program changes stay whole-world

### atom-program-stdlib.test.mjs
- Program form-flow planner creates complete missing forms without overwriting existing content
- Program form-flow planner is a no-op when the generated structure already exists
- Program template planner creates one typed nested instance and then becomes a no-op

### atom-program-strut-endpoint.test.mjs
- inline Strut Program returns strict bool and cannot emit effects

### atom-program-work-order-e2e.test.mjs
- a top-level test Program completes create fill validate submit read-back in one central commit

### atom-projection-pipeline.test.mjs
- identity

### atom-rename-sealed-descendants.test.mjs
- ancestor discard never grants restore into a locked original destination
- ancestor discard preserves the sealed subtree without requiring internal slot authority
- ancestor discard retains root, window, sealed-structure and compound-edit denials
- atomic sibling name swaps preserve existing descendant Agent declarations
- batch ancestor rename preserves a sealed model and its lock
- batch public rename rewrites Program paths without firing business triggers
- public ancestor discard persists one reversible sealed archive and cold-restores its Programs with matching declaration scope
- public ancestor discard persists one reversible sealed archive and cold-restores its Programs with preexisting child-only label
- rename never grants sibling or locked-root authority and compound slot writes remain denied
- single ancestor rename preserves a sealed model and its lock
- single public rename rewrites Program paths without firing business triggers
- trusted restore cannot use an auxiliary log without central evidence
- trusted restore never reuses historical authority after functions changes
- trusted restore never reuses historical authority after labels changes
- trusted restore never reuses historical authority after mixed changes
- trusted restore never reuses historical authority after new-agent changes
- trusted restore never reuses historical authority after source changes
- trusted restore permits independently authorized declaration changes without exemption
- trusted restore preserves historical authority after ordinary archive data edits
- trusted restore reads exact original declarations from injected-at-discard and rejects wrong identities
- trusted restore rechecks subsequent Agent additions before effects commit
- trusted restore recovers historical function scope the ancestor cannot delegate
- trusted restore reports reader failure by interaction without changing delegation refusal

### atom-slot-body-mirror-runtime.test.mjs
- four-axis references, slot locks, and inverse local rollback survive an unrelated commit

### atom-slot-body-plan-integration.test.mjs
- a same-value local-material Transform still evaluates and dispatches owner-local strut
- a strict-false owner-local condition does not dispatch its consequent
- exact Explore, cold projection, and unrelated Program creation never replay a print effect
- generated print Program seals and prints without a blank template in central atomic commits
- one atomic batch evaluates one owner-local condition and dispatches its consequent once
- one derived recomputation failure rolls back the entire re-seal candidate transaction
- outside orchestration materializes a local variable Thing before triggering only its owning instance
- owner-local strut never dispatches the same revision in a sibling instance
- re-seal recomputes every synchronized instance with the new shared Program in the same commit

### atom-slot-body-program-integration.test.mjs
- Program seals then prints one instance with shared Program and owner-local strut
- unrelated Program creation does not replay an existing print effect

### atom-slot-body-reseal.test.mjs
- deleting a mapped slot containing local material reports exact paths and rolls back the whole seal
- first seal does not turn an external same-prefix endpoint into a local role
- first seal preserves exact candidate-local Program strut endpoints without renaming
- one failed automatic reseal rolls back plan replacement and all instance changes
- re-seal deletes an empty mapped slot from every instance
- re-seal updates every mapped slot while preserving two nested material subtrees byte-for-byte
- seal rejects removed batch inputs and never returns continuation fields

### atom-slot-body-runtime.test.mjs
- current print Program binds its visible revision when the internal effect carries only the instance name
- print rejects duplicate, stale revision and forged caller atomically
- print rewrites complete strut AST to the current instance and preserves inline Program
- seal and print preserve one shared Program as the strut receiver
- seal preserves the model name and creates a visible print plan plus empty example container
- seal stores a deterministic complete owner-local strut AST and no default material
- self-declared seal keeps the candidate DataFlow name instead of renaming it to a program convention

### atom-slot-body-structure-lock-integration.test.mjs
- a Program cannot borrow reseal capability from another slot body
- authorized reseal replaces its own mapped projections without a structural-lock bypass for callers
- central Transform permits instance data but protects mapped structure and rejects forged roles
- one Program may edit its model and reseal the same slot body atomically
- structure-preserving edits reuse slot locks only when changed paths stay outside slot domains

### atom-slot-body-structure-lock.test.mjs
- explicit human Web authority crosses ordinary locks but cannot forge kernel slot roles
- reseal still requires the caller lock intersection and denial rolls back every projection
- slot structure locks reuse one compiled result per mutable world revision
- slot structure plans compile their adopted revision into the shared Graph authorizer
- slot_body seal always locks structure without freezing instance situation
- slot_body seal lock protects mapped structure but permits instance data and material

### atom-slot-body-two-step-flow.test.mjs
- public CLI preserves one completed mirrored instance across a cold restart
- two-step slot instance unlocks without touching template or sibling

### atom-slot-strut-lock-acceptance.test.mjs
- a rolled-back multi-subscriber delivery releases every claim for a complete retry
- a slot strut true lets its own triggered action arm a node lock without locking a sibling example
- a strut subscriber effect rejected after worker success releases its claim for retry

### atom-transform-postcommit-boundary.test.mjs
- rename-copy acceptance rereads one stable interaction and proves Strut and shortcut conservation

## 附：本轮同时观察到的两处独立现象

- **确定性产品缺陷（已修）**：`scripts/accept-rename-world-copy.mjs` 仍导入 R6 已删除的 `rewriteProgramSourcePathLiterals`，脚本必然 `SyntaxError`，对应上面 `rename-copy acceptance` 用例。
- **全量无法自然结束**：上述 21 个文件跑完后（`atom-transform-postcommit-boundary` 之后）进程进入零 CPU 挂起，两次复现；该现象与文件级失败分开记录，修复后需重新验证全量可自然退出。
