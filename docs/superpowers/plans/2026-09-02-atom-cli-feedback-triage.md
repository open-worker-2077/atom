# Atom CLI 反馈裁定账本

**Goal:** 对`submissions.jsonl`中的 45 条 Agent 反馈逐条保全、去伪、复现和收束；任何反馈都不因被提交而自动成为用户需求、当前缺陷或完成证据。

**Authority:** 用户当前定论与产品规格 > 当前可复现事实 > 当前代码与测试证据 > Agent `submit` 线索。历史术语`name/detail/children/partners/contain/support`不能直接投影为现行`thing/situation/slot/strut`缺陷。

**Source snapshot:** `C:\Users\worker\AppData\Local\AtomGraph\worlds\primary\submissions.jsonl`，2026-09-02 回读共 45 条（bug 33、requirement 7、pain 3、optimization 2）。本账本只保存裁定与恢复断点，不复制会话 history。

## 当前主干

- **首个代码缺口**：全文`situation.rep`的 Help 示例不是标准 JSON，历史记录 26、28 也证明使用`:null`会被当作局部替换。先以当前 CLI 写 RED，统一“可复制的标准 Graph-JSON”与执行器合同。
- **首个现场缺口**：手机只验收`https://worker.tail33a2eb.ts.net/`；IP 仅是内部诊断探针。当前无 ADB 设备，服务端、Tailscale Serve 和 peer 连通均已证实，缺手机 DNS/浏览器侧证据。
- **后续功能**：点击次数作为通用输入事实、Program 声明三点击运行仍未设计实现；完成当前 CLI 缺口后先执行`superpowers:brainstorming`，不得把“三点击用途”硬编码进输入层。

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
- **37 `f163b30f`、39 `dbc95b90`**：固定窗口、受控迁窗与跳窗隔离已有系列实现和验收；最新真实 ESG 初态也已部署。只等待真实业务完成事件，不伪造`✅`。
- **42 `46e7f1a8`**：`5c79dad fix(transform): copy frozen snapshots before discard`及同名归档补丁`fc5e09c`直接覆盖冻结数组崩溃。
- **43 `b2824f62`**：Agent Program身份与子树移动已由`d5e1bb6`、`57230c0`等修复并经真实工务迁移/ESG部署使用；仍保留一个“后代普通改造”最小回归，避免用相近场景代替原报告。
- **44 `327e3858`**：`0fb665d fix(transform): keep situation replacement text opaque`及正文不透明规格直接覆盖嵌套`.ren.`误解析。

### 必须用当前版本复现后才能裁定

- **07、09 `244fc9de`、`7cacb888`**：Windows备份任务可见终端；先检查当前计划任务 action 和真实弹窗，不能从 2026-08-11 环境直接判现状。
- **16 `567796a1`**：旧 advancement-flow 填表触发`PROGRAM_USES_REQUIRED`；现行模板和四轴已大改，需创建隔离槽例重跑。
- **26、28 `c1f35b6f`、`d7fd2bb2`**：全文 replacement 当前 Help 示例仍不可作为标准 JSON 复制，列为当前第一代码缺口；旧路由回退部分另行隔离，不与语法修复混做。
- **31 `89a8a3a7`**：提交后 Explore 无回执；需当前版本加入有界超时与 revision 证据重跑。
- **33 `02932576`**：旧`name.run.`路径已退役；需用当前`thing.run.`对深层 Program 做最小回归，只验证现行运行选择器。
- **45 `946650ae`**：Explore 与 Transform 对同名 Thing 的候选集可能不一致；先用不会写入真实业务正文的测试 fixture 复现，重点比较隐藏/backup候选与“世界之外”选择器。

## 执行顺序

- [ ] **Task 1 — 全文 replacement 合同**：RED证明 Help 给不出可执行标准 JSON；定位 parser/executor边界，作最小修复并跑相关测试。
- [ ] **Task 2 — Explore/Transform唯一性**：为反馈 45 写隔离 RED；若不能复现则记录当前候选集证据而不改代码。
- [ ] **Task 3 — 剩余当前回归**：依次验证 43、33、31、16、07/09，每项单独 RED/裁定，禁止合并猜修。
- [ ] **Task 4 — 通用点击次数设计**：完成 brainstorming、规格和计划后 TDD 实现，三点击运行由 Program 声明。
- [ ] **Task 5 — 手机正式域名验收**：取得手机侧错误后修复首个断点，以正式 HTTPS 域名完成只读 Graph 请求收口。

每完成一项都更新本页证据、提交并推送`main`；未完成项持续由 15 分钟巡守从本页恢复。
