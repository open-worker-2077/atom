# Ancestor Discard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合法上级能把包含封装槽模的旧版本子树整体可逆归档，保持内部结构、真实权限、引用及恢复能力。

**Architecture:** 修正现有Transform executor把纯`.dsc.`归档错误当成逐后代slot编辑的边界；继续复用唯一默认备份仓、原中央事务和归档记录。不得给manage名称、顶级标签或维护入口添加新旁路。

**Tech Stack:** 现有Node.js executor、Graph访问控制、JSON中央事务、Node测试和私有世界副本。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-agent-authorization-design.md` §4.4新增用户确认段；世界规格§4.4；运行规格§2.4。I3/U3/D2/E3。用户已在具体方案问题下明确“可以按这个修复”，并将本项置于当前最高优先。

## Global Constraints

- 合法上级对所选子树根发出纯`.dsc.`，整棵树进入唯一默认备份仓，内部结构并未被逐项编辑。不能为这次整体迁移再向每个后代申请slot编辑权。
- 根的实际权限与锁、封装结构保护、引用完整性、备份停用和可逆恢复各自成立。直接编辑封装结构或混合编辑不得借归档获得旁路。
- 不推导新的顶级权限通吃规则，不退役锁，不修改生产业务正文。当前固定Agent窗口、函数scope及既有mov/ren行为保持。
- 不关闭Trigger/Strut/阶段接棒，不复活备份域Program。来源提交与后续结果继续按已评审生命周期合同独立裁定。
- 实施方不部署、不push、不操作生产归档、不删除任何文件。所有世界副本与探针保留。生产最终写入与来源任务由控制方协调，只执行一次并回读。

## 已确认事实与局限

- 工单`922cf490-8f6d-45a7-b2e8-f2b8afd02ebf`，原失败关联`b7fc5c3e-528e-422b-8578-8e8fd9e9b8eb`，Agent `🧊manage`，目标`🧊manage/办包/究谋/个务/外务/旧版本`。公开Explore仍在原位，根无编译锁，下辖429节点；旧反馈428按最新回读校准。
- root保留的`archive-evaluation-probe.mjs`对真实世界只做内存executor与派生slot/window锁判定，`.dsc.`复现同一WINDOW_ACCESS_DENIED；具体拒绝为后代`槽体｜语义Flow工单/槽模`的SLOT_STRUCTURE_LOCK_DENIED/slot。`.mov.`同树到`个务`在内存中通过。源hash前后`f92b5b85d4609345d55d10bdb8c006e82126f8efe623ca4c76a08aef274f395c`相同。
- 此探针不提供自定义Program锁投影，不冒充完整公开运行；完整公共副本应作为修复验收。错误发生于transform-executor现有后代鉴权分支，尚未执行备份仓归档。
- 现有普通mov及纯ren已将不变后代路径迁移归属于根操作；dsc漏在该边界之外。默认备份仓本身已有内核限定归档合同，不应新加浏览/任意写备份仓权限。
- b9802de代码基线含已独立复核的来源/后续/投影分离，最终全量正在原工作区运行且已有其他失败；本项使用独立工作区，基线并非全量洁净。仅按用户已批准最高优先修本项，保留其他失败给原计划处理，不顺手改其它内核行为。

---

### Task 1: 纯整体归档的实际权限与守恒

**Files:**
- Modify: `work-engine/atom-language/transform-executor.mjs`
- Modify only for proven dependent defect: `work-engine/atom-language/engine.mjs`（先报告控制方具体根因，不能扩展新调度/授权）
- Test: `tests/atom-rename-sealed-descendants.test.mjs`（复用真实封装结构fixture与访问控制）
- Reuse tests: `tests/atom-language-transform-p1.test.mjs`、`tests/atom-language-transform-receipt.test.mjs`、`tests/atom-program-runtime-scheduling.test.mjs`
- Controller-owned: 本计划、当前唯一总账、既有反馈裁定页、规格与恢复断点。

**Interfaces:**
- Consumes: `applyTransform({atoms,item,contextFile,authorize,...})`、`createAccessController`实际slot/window锁、已有`createRuntimeCliExecutor`与中央journal。
- Produces: 同一公开`.dsc.`成功回执及原archive identity/restoreCoordinate；没有新API。纯整树迁移不逐后代申请内部结构编辑权，复合编辑保持真实拒绝。

- [ ] **Step 1: 精确RED与影响核对**

沿现有sealed fixture加入唯一typed default backup，用实际控制器的合法上级dsc父节点，断言应成功、原输入不变、整棵封装结构保全；原代码应复现WINDOW_ACCESS_DENIED，记录实际被拒对象。另证明直接修改封装节点及外域/锁住的所选根仍拒绝。

Run: `node --test --test-isolation=none --test-name-pattern='ancestor discard' tests/atom-rename-sealed-descendants.test.mjs`。修改前做GitNexus上游影响及具体调用核对，UNKNOWN不作无影响。避免为本项重跑原82/127/15项全链。

- [ ] **Step 2: 最小边界修正**

严格辨认纯归档与混入slot/situation/strut等编辑，沿现有根操作授权实现整树归档。所有内部结构保持不变，仍检查所选根真实权限/锁并限定唯一default backup。若自动引用维护还错误请求业务逐项编辑权，先给控制方具体证据与所需最小接线，不扩大直接业务写权限。

- [ ] **Step 3: 真实持久回归**

以公开runtime/CLI fixture验证包含封装槽模、后代Agent/Program的父子树归档，中央来源只提交一次、内部事实和关系守恒、备份Program不运行；冷读取及`.rst.`恢复原位置后封装锁仍有效。同名旧归档保留且新归档身份唯一，恢复冲突不覆盖。复用原有archive/restore/备份停用测试，不造新后台服务或并行账本。

- [ ] **Step 4: 定向GREEN、提交、独立评审**

Run上述新具名链；按实际改动运行p1/receipt相关归档恢复具名用例及备份Program停用用例。保留完整工具yield及completion输出，GitNexus/diff检查后只提交明确代码文件，报告基线、SHA、所有未决缺口。任务评审由控制方派独立评审方，实施方不自派评审。

- [ ] **Step 5: 原始现场私有副本与交付**

任务复核后对最新生产世界只读生成私有副本，使用生产同款公共入口及普通`🧊manage`完整归档原目标，核对源/目标、原子回执、四轴/引用/封装守恒及冷恢复；生产源hash核对，不--cleanup、不重放生产失败。若外部合法写入改变源hash，区分外部变化而非还原旧世界。完整原始问题GREEN后由控制方整合当前Transform候选、处理最终候选必要失败、部署与公共回读，再协调来源任务完成用户的唯一生产归档并回告。

## 状态

- 具体内核方案已获用户反馈许可；尚未实现。其它CLI反馈仍须逐条评估，新的内核方案不得借本项授权自动实施。
