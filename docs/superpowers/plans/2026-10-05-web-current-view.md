# 固定原文开关、Web 当前正文更新与刷新恢复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认隐藏左侧选中节点原文，外部写入后当前正文自动更新，F5恢复当前浏览视图。
**Architecture:** 左侧 field-readout 是固定选择信息栏，正文开关独立于悬浮详情亮度；现有 Web 变更通知和视图合同优先复用，先以隔离旅程确定故障边界再修复。
**Tech Stack:** Browser JavaScript、Node.js、node:test、Playwright。
**Spec:** 本计划中的用户已确认主干；沿用 ../specs/2026-08-31-atom-web-spatial-design.md 和提交投影恢复规格；唯一状态见2026-09-03-atom-current-requirement-ledger.md。

## Global Constraints

- I3/U3/D2/E3；问题研讨→持久化与备份→目标模式执行；不修改正式业务世界用于验证。
- 左侧原文不是悬浮详情框。不得通过详情亮度关闭它，也不得隐藏节点名称或操作提示。
- Web更新不阻断CLI，维持当前位置、展开结构、相机；F5不要求用户重新下钻。
- 安全备份 backup/atom-web-live-view-before-repair-20261005 已推送精确4e8c532b06753ca4369ec76c10701fb79f72810f；该提交原main检查37230085591成功，本次仅作为实施前备份。
- Superpowers6.4.2基线已核对；用户明确修改全局using-superpowers核心流程，优先于此前只读约定，原文归档在工作区docs/file-management/2026-10-05-superpowers-entry；不建立第二个Skill。

## 已确认与待验证

- 左侧来自 index.html selectionCopy / spatial-engine.js updateSelectionUI，将 selected.description 直接放进固定 DOM 信息栏，与浮框绘制独立；撤回先前详情亮度归因。
- 正式世界只读和4784/state均返回表格起始的新正文，截图显示旧正文；数据已更新，客户端更新断点仍待隔离复现。
- 放大镜缓存键包含正文且每帧更新；不能将故障归因为缓存键没有正文或鼠标没动。
- 初次页面只pull当前root，importKnowledge不消费knowledge.view；F5视图恢复链待验证。

## Review Focus

1. 默认隐藏仅影响固定原文，开关可用且刷新后保持选择。
2. 复杂Markdown外部写入在已展开深层团的放大镜自动显示。
3. 更新到达拉取期间、后台页面返回或连接恢复不会永久遗失通知。
4. 刷新恢复当前域、展开结构和相机；无效旧位置安全回到可用祖先。
5. 浏览状态不写入业务事实，不泄露真实Situation到Git。

### Task 1：固定原文控制

**Files:** index.html、spatial-engine.js、spatial.css；tests/browser/fulltext-target.spec.mjs及必要独立旅程。
**Interfaces:** 既有selectionCopy固定正文和展示设置路径；采用独立显示偏好，具体位置以现有同类控制验证。
- [x] 隔离旅程复现默认固定原文可见，形成RED。
- [x] 添加正文独立开关、默认关闭和持久化，验证右侧渲染及名称提示。
- [x] 定向GREEN并阶段提交、更新本计划。

### Task 2：外部正文更新与刷新恢复

**Files:** spatial-browser-bridge.js、spatial-engine.js；tests/browser/cli-web-refresh.spec.mjs、tests/browser-bridge-contract.test.js及必要恢复模型。
**Interfaces:** 既有changes SSE、pullKnowledge/importKnowledge、exportField/knowledge.view及visualSnapshot；不另建Graph存储。
- [x] 外部写入+深层展开+放大镜隔离旅程，定位客户端断点；分别验证丢通知、缓存旧节点和重载未恢复假设。
- [x] 为已确认缺陷形成真实RED后实现最小修复；已有有效旅程不重复开发。
- [x] 验证正文自动更新、相机和展开不变；F5恢复位置，记录GREEN并提交。

### Task 3：E3收口

- [x] 受影响链与真实关键旅程通过，fresh独立整体评审，修复实际问题。
- [x] 最终候选必要全量一次；推送精确revision并等待远端终态。
- [x] 正式部署并公共入口回读，证据写回本计划与总账。
- [x] main正式revision远端检查终态成功；目标在最后审计提交的远端检查通过后关闭。
**Task 1 RED**：真实Chromium选择节点后selectionCopy为visible；默认关闭断言失败。**F5 RED**：进入root/子域后reload回root，已确认初始化未恢复浏览快照。团正文测试首轮因evaluate未传groupPath失败，属于测试基础设施错误，修正后单独复现，不算产品RED。
**Ruling:** 固定正文开关采用浏览器独立偏好，不扩展跨端共享显示设置，也不改业务世界；复用现有固定信息栏，在其旁放开关。


**Task 2 根因与RED**：复用已通过的全文命中旅程，importKnowledge收到revision2与新表格后，已剖开团的全文仍显示revision1旧正文。importKnowledge更新workspace投影但未重建clusterScene，renderScene持续用旧团快照；并非未写入或亮度问题。固定原文开关首次GREEN验证发现父信息栏pointer-events:none导致按钮不可点击，已按真实点击失败补样式。


**验证纠偏**：首次团正文断言只读DOM文本，未验证面板开启；诊断发现实际enabled=false，因此撤回该次RED与‘修复未生效’结论。改用真实浏览器协议排队三击，明确验证面板visible/on后再测更新；此前固定原文及F5的真实RED/GREEN有效，不重复。临时渲染诊断已退出测试源码。


**有效团正文RED**：真实CDP按键队列确保三击窗口，面板visible且canvas标记on；未重建团场景的基线import成功、revision2新表格已在workspace，但右侧仍旧正文。已确认import后团场景未同步，现补回同一数据导入内的场景重建，不移动相机。


**恢复边界RED**：sessionStorage中expandedClusters含null导致初始化不能加载当前世界；已增加浏览快照结构与边界验证，坏快照回到正常入口，不影响业务事实。F5展开团与相机已GREEN。

**Task 1/2 GREEN**：真实Windows Chromium固定原文默认隐藏、真实点击开关与刷新偏好通过；F5恢复当前域/展开团/相机通过。有效团正文旅程在面板visible/on条件下，旧实现保持旧正文为RED，同一导入内重建团场景后显示新Markdown表格为GREEN，camera/clusterPaths完全相等。损坏快照边界RED→GREEN。真实CLI异步Web旅程1/1通过；受影响合同132/132通过。测试手势采用排队真实浏览器协议输入，避免逐次工具响应超过1.6秒三击窗口；不改变产品手势合同。上一轮补回场景重建时Windows换行使补丁未匹配，源码确认未应用后重新精确应用；不计为另一产品修复假设。

**阶段断点**：产品与隔离旅程准备提交，随后一次fresh整体评审。最终完整npm test由候选远端CI执行一次，Windows已运行真实UI旅程和132项受影响合同，不因汇报重复旧全量。

**整体评审与修复**：fresh只读整体评审1个Important，未发现Critical/Minor：F5初始化跨scope遇到CLI新revision，原实现丢弃混合数据后不再消费通知，会永久加载。最小VM真实桥接源码复现RED（仅root、root/a两次读、0导入）。修复在pull解锁后，对跨revision最多补拉2次，并消费拉取期间新到通知；持续版本不一致边界RED→GREEN证明请求数固定6，不失败紧循环。受影响链134/134通过。评审未判断：前进后退全部历史（本次仅当前视图）、跨设备原文同步（独立浏览器偏好）、失效路径相机（可用祖先重新取景合理）、无差异的服务鉴权/手机/投影性能；这些均按现有任务边界裁定，不增加工作。

**Ruling:** 最终完整npm test使用精确候选远端CI一次；Windows真实浏览器及134项直接链提供当前平台证据。构建生成的无源码变化bundle已保存官方计划工作区build后恢复原已验收bundle，再对实际部署资源重算入口哈希；不引入无关依赖输出差异。

**最终候选定向GREEN**：整体评审修复后134/134；Windows Chromium六条关键旅程6/6、0失败、1.1分钟：真实CLI非阻断Web、固定原文独立开关、F5当前域相机、F5展开团相机、坏快照正常加载、可见已剖开团Markdown自动更新。开发控制检查通过。进入精确候选远端完整门禁，仍未声明正式E3完成。

**候选远端**：509b9214efdc3404553c29a2757c971166143727已推送，PR#77，精确run37288462743进行中。正式公共入口将只读导航及渲染，拦截view PUT与其他写请求，不用正式世界构造更新用例。


**完整门禁失败**：候选509b921的run37288462743终态failure；2426项中2404通过、1失败、21跳过。唯一失败为atom-program-service-e2e的4784编辑异步发布，在重命名阶段2秒内未观察到精确投影revision。Windows隔离运行同一用例1/1通过（874ms）；尚不能据此认定偶发或扩大等待，先定向检查发布状态与等待链。正式部署仍未执行。

**失败定向诊断**：同一服务文件按CI的test-isolation=none运行14/14通过，失败用例1103ms。现有失败消息没有实际projectionStatus，无法区分待发布、实际发布错误、revision变化；只补实际状态到失败消息，不放宽2秒时限或降低精确revision验收。以远端候选获取必要环境证据。


**候选完整GREEN**：119cd819d66cee5b5a7536a1ace3e3aaa3e480af精确远端run37290193485 completed/success；2426项，2405通过、0失败、21条件跳过，417048ms。首轮单项投影等待失败未在同用例、同文件或补诊断后的完整远端再现；根因未能确认，不称作已修复的服务故障，保留实际状态诊断，断言与2秒时限均未放宽。

**正式E3回读**：正式main从ba97001快进到119cd81，4784加载sha256-c13c85fc0cf4e023。只读浏览器进入真实每日排期，原文默认隐藏、右侧Markdown表格可见、F5当前域与相机严格相等全部通过。拦截16次view保存和1次其他写入，未通过验收修改业务事实。CLI非阻断及正文变更旅程沿用隔离6/6证据，正式世界不用于构造写测试。main最终推送审计提交与检查待终态；保留工作树及忽略的执行证据，不删除文件。旧页面首次需要加载新版本一次，此后F5可恢复当前位置；旧版本未保存的浏览快照不能由新代码追溯恢复。


**正式main收口GREEN**：f17beca261f5609e21a40215f544c2f50fb995ea精确run37291276500 completed/success，正式目录干净，PR#77已MERGED。所有产品验收完成；本条只持久化收口记录，无产品代码变化。最后审计HEAD推送后复用同代码的公共回读与定向旅程，远端检查成功即可关闭目标，不为记录该审计提交自身的成功继续产生新提交。原始远端终态和浏览回读保留于本次既有SDD执行证据。
