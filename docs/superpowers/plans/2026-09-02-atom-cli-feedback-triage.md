# Atom CLI 反馈裁定账本

**Goal:** 对`submissions.jsonl`中的 45 条 Agent 反馈逐条保全、去伪、复现和收束；任何反馈都不因被提交而自动成为用户需求、当前缺陷或完成证据。

**Authority:** 用户当前定论与产品规格 > 当前可复现事实 > 当前代码与测试证据 > Agent `submit` 线索。历史术语`name/detail/children/partners/contain/support`不能直接投影为现行`thing/situation/slot/strut`缺陷。

**Source snapshot:** `C:\Users\worker\AppData\Local\AtomGraph\worlds\primary\submissions.jsonl`，2026-09-02 回读共 45 条（bug 33、requirement 7、pain 3、optimization 2）。本账本只保存裁定与恢复断点，不复制会话 history。

## 当前主干

- **当前功能项**：通用点击次数、统一Transform`$click`动作及Strut内嵌判定均已实现、测试和部署；独立click trigger计划已被替代，不再执行。
- **首个现场缺口**：手机仍无法稳定使用`https://worker.tail33a2eb.ts.net/`；IP仅是内部诊断探针。用户当前以ToDesk替代使用，因此保留未解决但降低优先级。
- **后续功能**：点击次数采用“单次点击为原子事件、同目标序列次数不设上限、Program 精确声明次数”的已批准设计；不得把“三点击用途”硬编码进输入层。

## 逐条裁定

### 无效、撤回或不属于软件缺陷

- **21 `62cf03a5`**：正文只有字面量`$feedback`，无可复现对象，判无效。
- **40 `ff7a62f9`**：已被 41 `b811f1af`明确更正为“不构成当前业务阻断”；保留历史，不进入修复。
- **01 `251959ab`**：调研成果评价方法建议，属于信息生产规范，不是 Atom 软件缺陷。
- **03—06 `3190653d`、`0781db81`、`3df24e3f`、`8b0cc220`**：旧推进流具体业务收口与模板措辞；需按现行推进流规格重新提出，不能据旧世界实例直接改软件。
- **17 `ad9aece9`**：PM²实例的数据建模请求；只有其中的通用关系能力合同可进入软件裁定，实例内容不自动成为产品需求。
- **29 `8d314032`**：把视频写入“网络”节点的具体业务操作受窗口截断；不是当前软件修复授权。

### 现行合同已替代的历史反馈

- **08、14、15、18—20、22—25**：`children/detail/partners/name`路线与方向冲突已由四轴`thing/situation/slot/strut`、`slot$latitude/longitude`、`strut`回读及“世界之外”顶层选择器替代；当前 Help 已公开现行合同。若现行语法复现失败，必须新建当前 RED，不能复活旧错误。
- **10—13**：空 Agent、旧`name.run`和旧推进流创建方式已由“Agent 是含顶层`agent({...})`声明的 Program”、`thing.run.`及 Help 的推进流两步配方替代。
- **34 `e0da948b`**：当前 Help 已公开递归 Form 的输入、activation、missing 与返回合同。
- **02 `2373ffae`、27 `4c44ef9b`**：当前 CLI 已提供`--stdin`和 PowerShell长文本路径；旧 cmd 引号/长 JSON 痛点不再作为现行缺陷，但保留后续真实长中文回归入口。

### 已有直接修复证据，待需要时做旧场景再验

- **30 `695b8cb2`**：`2f4013c fix(atom): preserve split utf8 stdin commands`，CLI 使用`StringDecoder('utf8')`且已有分块边界测试；旧 1746 节点导入尚未整树重放，故只裁定代码根因已有回归，不宣称旧数据自动修复。
- **32 `216cfcc5`**：`2f57021 feat(atom): add atomic batch transform`及现行 Help 已公开原子批量 Transform。
- **35、36、38 `1de10c7d`、`7870bf52`、`bf1cd480`**：`3014382 fix(atom): keep unrelated failed programs dormant`及后续 trigger/changed 隔离合同覆盖“无关 Program 冷重放污染”。
- **37 `f163b30f`、39 `dbc95b90`**：固定窗口、受控迁窗与跳窗隔离已有系列实现和验收；隔离测试世界已跑通五阶段连续解锁与四次自动迁窗，真实 ESG 初态也已部署。真实业务`✅`只用于后续生产观察，不再作为软件功能验收阻塞。
- **42 `46e7f1a8`**：`5c79dad fix(transform): copy frozen snapshots before discard`及同名归档补丁`fc5e09c`直接覆盖冻结数组崩溃。
- **43 `b2824f62`**：Agent Program身份与子树移动已由`d5e1bb6`、`57230c0`等修复并经真实工务迁移/ESG部署使用；2026-09-02 现行 Agent 登记/固定窗口回归`35/35`通过，正文、Strut、丢弃三类后代 Transform 均不会再触发错误登记。
- **44 `327e3858`**：`0fb665d fix(transform): keep situation replacement text opaque`及正文不透明规格直接覆盖嵌套`.ren.`误解析。

### 必须用当前版本复现后才能裁定

- **07、09 `244fc9de`、`7cacb888`**：2026-09-02 现场回读“Atom Data Private Backup”计划任务，Action 为`wscript.exe`→`run-atom-data-backup-hidden.vbs`→PowerShell备份脚本，已采用无窗口宿主；旧弹窗路径不再存在。
- **16 `567796a1`**：2026-09-02 现行 advancement-flow 的完整实例化、两步创建、修复挂接、严格布尔迁移和无 legacy uses 的数据填写回归`7/7`通过；旧`PROGRAM_USES_REQUIRED`阻断已不存在。
- **26、28 `c1f35b6f`、`d7fd2bb2`**：根因不是执行器损坏，而是 Agent 把 Graph-JSON 的“无 Value”误写成`:null`；当前执行器与测试已证明无 Value 全文替换正常。2026-09-02 新增 Help 合同，明确“全文键无 Value，null 是已提供的局部替换 Value”；旧路由回退部分另行隔离。
- **31 `89a8a3a7`**：2026-09-02 通过真实 4784 测试服务器验证“创建 Program 后立即 exact Explore”及“显式 Program 改世界后立即回读”，`2/2`均在有界时间内返回且不重放无关 Program。
- **33 `02932576`**：旧`name.run.`路径已退役；2026-09-02 现行`thing.run.`强制重跑及与 Explore/Transform 共用的最短唯一深层路径回归`2/2`通过，测试包含原反馈的 ESG 路径形态。
- **45 `946650ae`**：旧短名在顶层与子树同名时不足以安全写入；现行“世界之外/顶层名”合同已提供全局唯一顶层选择。2026-09-02 顶层同名、完整路径与移动回归`12/12`通过，不增加“按可见候选猜 Transform 目标”的第二套逻辑。

## 执行顺序

- [x] **Task 1 — 全文 replacement 合同**：RED证明 Help 未区分无 Value 与 null；根因定位为合同表达而非 parser/executor，最小修复后`atom-agent-cli-contract`为`19/19`。
- [x] **Task 2 — Explore/Transform唯一性**：现行“世界之外”选择器已覆盖旧反馈，相关回归`12/12`；无需生产代码改动。
- [x] **Task 3 — 剩余当前回归**：43、33、31、16、07/09 均取得现行代码测试或现场任务证据；没有把旧 submit 直接当成新缺陷猜修。
- [x] **Task 4 — 通用点击次数实现**：同一exact Thing的点击次数可无上限累计，CLI/Web统一提交Transform动作；三点击由Strut内嵌Program判定，不硬编码用途。
- [ ] **Task 5 — 手机正式域名验收（已降级）**：手机仍会卡住；用户当前以ToDesk替代使用。后续恢复时取得手机侧首个断点，以正式HTTPS域名完成只读Graph请求收口。

每完成一项都更新本页证据并在最小验证后提交；推送仍须用户授权。未完成项由每小时巡守先从当前需求总账恢复，再把本页CLI反馈作为待复核线索，不得越过用户定论直接实施。
