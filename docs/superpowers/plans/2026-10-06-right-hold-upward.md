# 长按右键导航取景与Web诊断

## 2026-10-08 长按无法进入沉浸：根因已复现、候选验收中

- 用户报告突然无法右键长按进入沉浸，要求继续自主排查；不把新标签正常推断为原页面正常，不要求用户截图代替诊断。
- 基线：main `1be3c9e`，工作树无产品改动；官方 Superpowers 6.4.2 manifest SHA256 `EF99FCE86F655E7B65F9505BDF468C9BCAF9BF49915C72E128ED62BAC40A6586` 与本会话核对基线一致。
- 已验证对照：公开4784新标签 build `sha256-ce88592bcf6e59be`、阈值240ms，实际鼠标右键按下/持续/松开依次进入 atom.json 和 managegraph；日志出现 applyImmersiveInwardView、route-committed、scope-received、camera-settled，无console error。仅证明干净页的这两次操作正常。
- 当前工具可连接的浏览器仅含本任务创建的标签，无法直接读取用户故障标签；继续以源码和展开/连续手势场景定位，不以此宣称全局阻塞。
- 待验证断点：目标选择及portal资格、展开团命中、6px移动取消、修饰键/blur/lostpointercapture取消、过渡锁、编辑状态阻止。当前未裁定根因，未改产品、重启服务或开启新目标。

### 当前已复现的具体分支

公开新页面进入managegraph后PageDown展开子团，在展开团内部、未命中真实子节点的位置实际持续右键按住并松开，路径保持depth2，界面提示子域团已收起，日志intent明确为 `applyParentView`。对照靠近团中心但仍落在子节点扩大的命中范围，实际进入子节点depth4，并非团本体。上述两种行为证明长按识别并未整体失效，展开改变了目标解析。

源码因果链：`findHit` 的blankSensitive分支按 `nodeOwnerPath(node) === domainContext.path` 过滤，子团域壳载体的owner是父域，因此被过滤；未命中内部节点时返回 `{item:null,domainContext}`，mappingContext.onNode为false，hold映射 `fieldHoldSecondary=applyParentView`，随后 `applyParentView` 收缩已展开子团。现存right-hold-upward浏览器回归还明确期望此收缩；不能把变更悄悄写成无行为变化的修复。

既定修复主干：尚未成为当前沉浸范围的已展开子团，长按选择团本体进入沉浸；当前沉浸域的空白仍返回母域，内部节点优先命中，短按收缩不变。用户明确这是早已确认的定论并要求直接执行。撤回“需要再次研讨”的错误裁定：旧测试反映实现偏离，不能覆盖用户定论。未以本复现冒充用户未连接页面的现场证据。移动6px取消为既有明确合同，不改阈值；过渡锁开启函数当前无调用，不作为已确认故障原因。

### 恢复既定长按合同的实施步骤（I3/U3/D2/E3）

使用 writing-plans 补齐此原计划，using-git-worktrees 复用本会话既有隔离checkout，executing-plans 内联执行，test-driven-development 写真实鼠标回归。

- [x] 将本次根因、用户纠偏、步骤持久化，提交原有版本并推送 `backup/atom-before-expanded-hold-repair-20261008`，回读精确远端SHA `904fdaf28bfc6b23afac5550ae1367c8744dce3c`；备份仅保存、尚未验收。
- [x] 开启目标，详情只指向唯一总账和本原计划。
- [x] 浏览器RED：PageDown展开子团→对不含内部节点的团内位置持续右键按住→应在松开前进入该团；保持短按收缩、当前域空白长按上钻和内部节点优先不变；修正旧收缩预期并保留已提交长按后移动不错误拖拽的真实验收。
- [x] 最小实现：仅对长按单独解析已展开子团载体，复用现有domainContext、载体与沉浸入口；不扩大普通短按命中、不把当前域外壳当子节点、不复制空间命中算法。
- [x] GREEN→真实关键旅程→必要合同门禁；一次fresh整包评审，Important/Critical定向RED/GREEN。
- [ ] 最终候选完整测试一次、候选推送与精确远端检查；静态部署不停止健康后端，公共入口实际长按回读；main推送及精确终态后完成目标。保留原始证据及工作树，零删除。

实施工作树 `.worktrees/web-current-view-20261005`，branch `fix/expanded-group-hold-20261008`，BASE `904fdaf`；原main安全备份已核对，旧有效基线测试复用。测试首次沙箱拒绝本机socket，未形成测试结果，已终止该测试会话并以获准隔离4796临时世界重跑，未涉及正式4784。

**RED**：`red-elevated.log`，新真实长按回归期望进入leftPath，实际仍parentPath，1 failed／32.1秒。最小实现只在beginSecondaryNavigation为未命中真实item的已展开子团复用cluster.parentCarrierNode构造长按目标；短按原action与签名保持，当前域shell不成为carrier。

**定向GREEN／夹具纠正**：长按进入、进入后移动不拖拽、当前域外空白上钻、延迟scope居中、日志限量5项浏览器通过；新增短按回读夹具漏传leftPath引起ReferenceError，界面已实际收缩，补入evaluate参数后单独重验。64/64输入与仲裁合同通过（此前63项夹具需补state依赖，已纠正）；新增可执行合同覆盖子团carrier长按、current shell返回、真实子节点及关系优先。剩余3项关键旅程在隔离端口重验，不升级全量。

**用户增量要求**：排查上午可用后来失效的原因并防止类似回归。当前日志是每标签有界sessionStorage，不含之前原标签的完整事件；没有上午现场证据，不把时间顺序猜测当根因。已验证同一团由未展开变展开时动作从沉浸变收缩，代码build未改变，说明状态依赖可直接解释症状。补充同源非阻断诊断：按下目标类型／长按意图／阈值／稳定opaque目标，实际hold执行，短按释放，移动、pointercancel、lostcapture、blur、modifier取消原因；不逐帧记录、不记业务正文、不引入网络日志任务。回归覆盖展开前后及当前域返回边界，防止旧测试覆盖用户原定论。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 真实长按右键导航后Graph居中可见，逐层上钻不产生漂浮残团；Web提供不阻塞交互的有界诊断。
**Architecture:** 用户手势→既有视图意图→域/展开状态→重建场景→最终几何取景；正文通知仅刷新当前场景。诊断观察这一链路，缓冲/存储/导出不反向改变渲染与服务。
**Tech Stack:** JavaScript、Node tests、Playwright。
**Spec:** ../specs/2026-08-31-atom-web-spatial-design.md。

## Global Constraints

- I3/U3/D3/E3。用户授权自主把控实现，已睡觉，不请求确认或中断任务。
- 实施前原版33fbf8b6b79c0350e759df911a085167954d545d推送安全备份，精确远端核对后目标仅指向总账/本计划。
- 仅静态Web更新，不停止当前健康后端，不用正式世界构造写测试。
- Superpowers6.4.2 obra/superpowers manifest EF99FCE86F655E7B65F9505BDF468C9BCAF9BF49915C72E128ED62BAC40A6586与已核对基线一致。

## 证据与状态边界

用户两张截图：长按右键上钻后无Graph，后滑才在左下看到；继续上钻后root仍有深层散团。上轮exit意图测试未覆盖真实长按及深层异步数据路径，撤回对长按完整旅程已验收的泛化；其他已有效验收证据不重做。
目前浏览器没有覆盖导航/场景/相机链的诊断记录；traceClusterEnvelope仅绘制路径，后端runtime diagnostics不包含Web视觉状态。根因尚待真实手势与分阶段几何复现，不猜测渲染原因。

### 所有权与合同

| 组成 | 所有事实 | 消费合同 |
|---|---|---|
| 手势仲裁 | 本次pointer起点/按键/长按时长 | 单次视图意图，不重复执行 |
| 视图意图/状态 | 当前域、展开分支、历史 | 退出域不残留无授权后代展开 |
| workspace/bridge | 当前revision的节点数据 | 新scope完成加载后与当前域一致 |
| scene adapter | 当前布局及压缩坐标 | 相机只对该次已重建几何取景 |
| 相机 | target/distance/basis | 动作稳定后有效Graph在视野内 |
| 诊断 | 有界元数据事件 | 错误/拥塞/存储失败不阻断上述链路 |

诊断仅记动作、revision、匿名路径ID、展开路径、布局计数/压缩/几何及相机；不记正文/凭据。有限环形缓冲，批量空闲持久化，容量溢出丢旧记录；导出按需。禁止每帧console/网络/存储写入。存储失败仍能以内存诊断正常使用。

## Review Focus

真长按节点下钻与空白上钻、连续多层、PageDown后退、非居中/旋转相机、深层scope异步到达、缓存scope回到父域、旧展开分支归属、运行中正文更新不抢相机；诊断拥塞/配额失败/旧坏日志不能影响Web操作。

### Task 1: 根因与导航修复

**Files:** spatial-engine.js、spatial-browser-bridge.js/scene adapter仅根因必要处、tests/browser/right-hold-upward.spec.mjs。
**Interfaces:** pointerhold→applyParentView/exitDomain/returnClusterToDepth；importKnowledge/refitCurrentDomain；真实最终投影几何。

- [x] 隔离及正式只读真实右键按下/等待/松开逐层复现，记录路径、场景与相机的阶段变化。
- [x] 在所属计划即时写已验证根因及最小修复主干，真实行为RED后产品修复。
- [x] 单层/多层/异步scope/缓存父域/展开场景行为GREEN；必要受影响链阶段提交。

### Task 2: 集成有界Web诊断

**Files:** spatial-diagnostics.js、spatial-engine.js、spatial-browser-bridge.js、index.html、tests/spatial-diagnostics.test.js、tests/browser/right-hold-upward.spec.mjs。
**Interfaces:** record compact event、snapshot/export；既有导航/import/取景生命周期检查点只观察，不另建场景状态。

- [x] 先测试有界缓冲、批量调度、坏存储/配额失败不抛到操作、载入/导出及无业务正文。
- [x] 最小集成诊断，按需导出；证明不每帧写入、事件突发有界且失败不影响关键旅程。
- [x] 与Task1真实用户旅程组合验证；同代码revision复用旧数据刷新与表格证据，只验证具体影响链。

### Task 3: 评审与正式E3

**Files:** 唯一总账、本计划、实际资源hash。
**Interfaces:** Task1/2最终候选、一次fresh整体评审、精确远端完整门禁、静态部署只读回读。

- [x] fresh整体评审，实际Important/Critical按RED→GREEN修复；最终候选全量一次。
- [x] 原服务持续运行，仅正式文件切换；公共真实长按关键旅程与诊断导出回读。
- 最终收口门槛：最后main审计HEAD的精确远端检查必须completed/success；终态以该revision远端实际结果裁定后关闭目标，不无限制造自指审计提交。

## 即时证据 2026-10-06

- 正式入口新页面、真实节点长按下钻六层及空白长按上钻六层，稳定相机均居中；29次写请求被测试拦截。该证据只排除干净页面的简单旅程，不把用户截图判为已修复。
- 现场需要诊断记录才能比较旧页面、展开与异步重建的状态。因此Task2诊断先形成必要依赖，再完成Task1复杂旅程根因；不是跳过导航问题。
- 诊断RED：缺少模块。GREEN：3个单测，100事件缓冲限8/丢旧92/单批写入；坏JSON、配额失败仍能导出；字段白名单去除正文和token。

## 已验证根因与修复主干

- RED `current-expanded-red.log`：PageDown展开左/右团→进入已展开左团→真实空白右键长按，路径仍为左团，未返回父域。
- `applyParentView`先检查expandedClusterDomains.has(path)，进入前的展开描述仍含当前域，导致当前域被误判为子团收缩；`frameCollapsedCluster`找父域载体时父域已在当前视图外，无法取景，沿用旧相机。历史复杂展开与当前域导航混在同一分支是主干断点。
- 最小修复：当前域优先走退出到真实父层；仅当前视图内的其他展开子域走收缩。沿用既有父域重建、清除离开域展开及取景逻辑，不新建导航系统。
- 干净六层、延迟scope及持键轻移测试均通过，故不对这些链路猜测性改写。

## 定向GREEN与候选评审

- 导航既有4项+新增3项7/7通过；诊断接入与节流最终专项4/4通过（原3项有效同路径证据复用），Node诊断4/4。
- 1000事件浏览器突发：即时0次存储，随后1批；128事件与96k字符双上限，坏存储/配额失败仍以内存记录导出。帮助页新增“导出诊断”。记录build、匿名路由、scope拉取、意图、几何重建、相机请求及稳定落点；不包含正文/令牌，不发网络日志，不每帧写存储。
- 诊断仅观察既有生命周期；未创建新的导航或场景事实源。正式服务健康回读ok，开发期间未重启。
- Task1、Task2完成，进入一次fresh整体评审；最终候选完整门禁和静态正式E3待完成。新增父层最终居中断言纳入最终旅程。

## 正式入口修复前因果回读

`public-current-expanded-red.log`：PageDown展开managegraph→进入其中已展开的办套域(depth3)→真实空白长按，path仍为该域，未回到depth2父域；10次API写入全部拦截。证明不是隔离夹具独有的问题。普通物理点选壳中心可能命中壳内叶节点，故因果验证以既有applyImmersive入口明确进入目标团，上钻仍走真实鼠标手势；此执行区别已向fresh reviewer披露。

## Fresh整体评审结果及修复

02ed57c相对0803b1c，一次fresh整体只读评审：Critical0、Important0、Minor1，Declined to judge无；当前域优先及旧F5/历史过滤合同确认。Minor：刷新后丢弃计数归零；定向RED actual0/expected6，恢复非负安全整数dropped并累加本次裁剪，GREEN5/5。最终公共帮助按钮真实下载是E3必验，不用API自调用代替。

## 远端基础设施失败与独立必要工作

42195f5精确run37372990156首次尝试：2026-10-05T21:13:11Z completed/failure，test job cancelled，steps为空；官方check注释“The job was not acquired by Runner of type hosted even after multiple attempts”。没有产生任何测试结果，不裁为代码失败。按SP-L03允许基础设施无有效结果同revision重跑，按SP-L05记录并等待重试终态。

Ruling：为不让远端运行器局部阻塞软件修复，本机同最终候选完整npm test一次正在执行。若GREEN，既有批准的正式静态部署/公共回读可继续，不重启后端；远端合入/推送收口与目标完成仍受精确检查终态成功约束，不把本机结果冒充远端成功。

## 最终候选Windows完整门禁

42195f5 `npm test` 一次最终完整结果：2432 tests /2431 pass/0 fail/1 skip，exit0，696114ms。最终Windows长按父域居中及日志突发2/2，日志单测5/5；既有其余导航、F5、收缩同实现有效证据复用。正式监听PID46016不变。

按已记录Ruling，正式main本地仅快进该已验证候选，执行静态公共回读；远端main尚不合入推送，等待同revision检查有效终态。没有用基础设施失败作为代码失败或目标完成依据。

## 正式静态E3产品验收GREEN

正式本地main快进42195f5；正式监听PID46016在切换前后相同，没有重启后端。公共新页面build `sha256-ce88592bcf6e59be`，`public-e3.log` exit0：PageDown展开managegraph→明确进入已展开域depth3→真实空白右键长按返回depth2父域；仅该父域1团、中心误差0px。进入目标团使用既有immersive入口以排除壳中心被内部叶节点占据造成的点选差异；上钻用真实按下/等待/松开。

公共“帮助→导出诊断”按钮实际下载 `atom-web-diagnostics.json`，51条事件，含build/scene-built/camera-settled，无正文；12次API写入全被拦截，没有业务Graph改动。公共服务/CLI健康最终回读仍须在收口再核对一次。

**当前断点**：软件产品E3已部署验收完成；PR79原精确42195f5远端run37372990156第二次尝试等待runner，main远端发布/最终检查未完成，目标保持active。原版33fbf8b备份与新产品42195f5功能分支均在远端，当前审计记录另以本地提交保全；不将基础设施无测试结果判为通过。

2026-10-05T21:29:56Z：run37372990156第二次尝试实际获得runner；安装与开发入口门禁通过，完整测试正在运行。分配阻塞已解除，目标继续等待测试终态，未改变产品代码或重启服务。

## 远端候选GREEN与最终main门槛

42195f5精确run37372990156第二次尝试 completed/success：2432 tests、2410 pass、0 fail、22平台条件skip；原始完整日志remote-candidate.log已回读。托管runner阻塞解除且形成有效结果。

软件产品E3与fresh评审、Windows本机全量/关键旅程均完成，开始合入PR79并推送main审计。后续main文件仅审计和合并元数据，产品代码相对42195f5不得漂移；最后审计main HEAD的精确远端检查成功后关闭目标。最后检查终态直接从该精确revision远端读取，不为记录审计提交自身结果再制造新审计提交。

## 最后审计封包

PR79已MERGED，mergeCommit e9741a010fc89659a091cc08e6cda8fa4354cac8，时间2026-10-05T21:40:11Z。正式main接回该合并，相对已验证42195f5仅两份Superpowers记录有差异，产品代码无漂移；公共版本ce88592bcf6e59be有效证据复用，健康/投影published/PID46016最终回读正常。

本次封包是最后main审计：其后只有推送、读取该精确HEAD远端检查并在成功后关闭目标。无需再生成自指提交来记录该提交自身检查。软件需求/部署/评审均已验收；最后main门槛始终依赖外部真实结果，不预写成功。

**2026-10-08 相邻旅程GREEN**：additional-green.log 的短按收缩、内部真实节点进入、当前沉浸壳内空白返回3/3通过；与green-browser.log已通过5项共同覆盖8条实际旅程。取消日志单测先RED（0条事件≠1），实现后direct-final.log 70/70通过，涵盖输入、仲裁、中键与既有日志失败隔离。浏览器日志夹具pauseAt用了主机时间而浏览器时钟已前进，出现Cannot fast-forward to the past；首次改为浏览器Date.now()+1000仍被工具延迟超过；改为+60秒后browser-cancel-final.log 1/1通过，真实移动产生一次movement/distance=12，无hold/tap且不导航；保留两次原失败trace。实际展开团按下及hold日志在browser-diagnostics-corrected.log通过。9条关键浏览器旅程已取得有效结果。

**正式切换前只读基线**：4784 HTTP200，当前监听PID8956（与上次历史PID46016不同）；本次没有重启服务，不将历史PID用作当前进程证据。正式main工作树干净。开发入口check:development-control通过；fresh整包评审进行中。

**fresh整包评审**：expanded_hold_fresh_review 无Critical/Important；Minor为已提交hold后移动仍记cancel，导致日志语义误导。定向修复以secondaryCommitted区分pending取消与已提交动作；旧guard回放review-cancel-red.log exit1，恢复guard直接70/70 GREEN；browser-review-green.log实际已提交后移动1/1通过，camera不漂移且无取消误报。评审修复关闭，开始最终候选全量一次。

**候选封包**：713ac748701ac8273a4e56ea4a6440ba86958b01 已推送功能分支并创建PR80；精确远端run37722659284运行中。本机同候选完整npm test运行中，尚未形成终态。评审定向确认Minor已关闭。后续记录只改Superpowers审计，不漂移产品代码；远端main检查仍须对最终精确审计revision通过。

**构建封包补齐**：npm test首步build:browser已按新spatial-engine内容更新index.html的内容hash/资源版本参数；将该确定性构建输出纳入候选，测试过程正在验证的工作树即此输出。只补stamp和审计，不改变已评审逻辑；精确远端改跟踪新的候选revision，旧713ac检查不作为最终门禁。

**远端失败即时入账**：精确728c32c/run37722878938完整2434项：2411pass、1fail、22skip；唯一失败view-mode-engine-contract的functionSource夹具将新注释中的单引号误作JS字符串，导致函数边界提取失败。定向view-parser-red.log可重现；夹具跳过行/块注释后view-parser-green.log通过，产品代码未变。本机完整尚在运行，已出现两项未改后端的性能断言失败，需终态后定向排查；不当作远端全局通过或完成。
