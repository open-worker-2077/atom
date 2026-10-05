# 上钻、刷新与团收拢导航修复

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上钻无下级团残留，刷新后子团不自动展开，右键收拢总节点居中可见。
**Architecture:** 沿既有视图意图、团场景和相机取景逻辑修复；同会话显式后退历史仍可恢复完整快照，刷新只恢复所在域。数据到达自动更新不清除正在使用的展开状态。
**Tech Stack:** JavaScript、Node.js、Playwright。
**Spec:** ../specs/2026-08-31-atom-web-spatial-design.md；本计划的用户2026-10-06新裁定优先于2026-10-05展开恢复测试。

## Global Constraints

- I3/U3/D2/E3。研讨→Superpowers持久化与原版本推送备份→目标模式→实施。
- 原版本d3775d356ad8a84865e33f1597811f6933b6839d；正式世界只读，隔离合成数据复现，不把业务正文写入Git。
- 目标仅指向既有唯一总账及本计划；不另建产品状态源。
- 官方Superpowers6.4.2来源obra/superpowers，manifest SHA256 EF99FCE86F655E7B65F9505BDF468C9BCAF9BF49915C72E128ED62BAC40A6586，与已核对基线一致。

## 问题、证据与已确认主干

1. 上钻：退出左团后当前path已回父域，clusterPaths仍含两个下级团；returnClusterToDepth仅替换当前域，保留expandedClusterDomains且没有父层取景。上钻结束子团展开状态，并取景到父层。
2. 刷新：原F5测试明确恢复expandedClusters，新反馈明确要求不再恢复；隔离PageDown后reload仍出现两个展开子团。保持所在域，清除临时展开；布局被重置时重新取景，未展开时保留原相机。
3. 收拢：真实PageDown后在子团空白右键，团已收拢，但返回节点距屏幕中心约206px；collapseClusterDomain重建团场景后recenterLatestInteraction仍从旧hitRegions取位置。按重建后的节点取景居中，复用既有相机功能。

首轮PageDown未将十字移入团内，属于诊断前提错误；随后已补齐。最初KeyX实际绑定前进，退出上层改为真实exit意图后确认上钻残留；不将这些测试错误计为产品RED。

## Review Focus

- 上钻连续两层，离开团不再漂浮或断开，父层可见。
- 刷新旧版保存快照兼容；当前域保留但展开清零，不因旧expandedPaths预取并再次激活。
- 清除展开后的相机不能继续停在旧团中心或极端远距离。
- 收拢某团时其他仍展开团保持可操作；PageUp、批量收拢共用重建后的取景链。
- 自动正文更新保持正在使用的展开与相机，同会话后退/前进历史不受F5规则影响。

### Task 1: 导航状态生命周期与收拢取景

**Files:** spatial-engine.js、spatial-browser-bridge.js（仅必要时）、tests/browser/navigation-state.spec.mjs、tests/browser/current-view-refresh.spec.mjs、必要的view-mode-engine合同。
**Interfaces:** restoreBrowserView(saved)、returnClusterToDepth(targetDepth,previous)、collapseClusterDomain(path)、clusterSpatialFrame(path)；不新增业务存储。

- [x] 合成多层世界复现三项RED；修正无效诊断前提。
- [x] 按已确认主干逐项最小修复；先上钻，再刷新，再收拢。
- [x] 原展开恢复断言按新合同更新；无展开F5相机GREEN，损坏快照及自动正文更新进入组合验证。
- [x] 运行navigation-state/current-view-refresh/expanded-reader-refresh关键旅程；受影响模型与桥接合同通过后阶段提交。

### Task 2: 评审、远端与正式E3

**Files:** 既有总账、本计划、入口资源版本；证据仅进入既有SDD工作区。
**Interfaces:** 消费Task1候选及旅程；精确Git revision绑定远端门禁和公共回读。

- [x] 一次fresh整体评审，实际Important/Critical按RED→GREEN修复。
- [ ] 更新实际资源入口哈希，候选推送PR，必要完整门禁取得精确revision成功。
- [ ] main快进部署；公共4784只读上/下钻与刷新/收拢回读，拦截业务写入。
- [ ] 推送正式main及审计记录，精确远端检查终态成功后关闭目标；不为记录审计检查本身无止境产生新提交。

**上钻首个修复定向验证**：两次上钻路径与子团清零断言已通过；整条多层旅程触及默认30秒总时限，在最终居中断言前超时，未得到居中有效结果。旅程总时限按既有复杂浏览器旅程设90秒，各行为断言仍5秒，不放宽产品可见性条件。

**上钻GREEN**：真实多层exit旅程1/1通过（16.1秒），连续上钻path正确、两次下级团清零、总节点屏幕居中。刷新修复只在读取浏览快照时清临时展开，并在布局重置时复用refitCurrentDomain；视图历史restoreVisualSnapshot不变。

**刷新GREEN**：原文偏好、未展开F5当前域与相机、展开后F5清零并居中、刷新上钻再下钻子团仍清零，4/4通过。startupBrowserView消费的快照先清展开，桥接不会按旧expandedClusters重新预取；同会话历史恢复函数未变。收拢按新collectClusterNodes的carrier几何调用既有spatialEnvelopeFrame与startCameraTween，不读旧hitRegions。

**收拢GREEN**：真实PageDown/子团空白右键1/1通过（15.8秒），返回carrier在5px内居中。补验证另一未收拢分支仍展开；接下来受影响链与组合旅程。

**合同裁定**：受影响链170项169通过/1失败，唯一旧合同禁止上钻调用任何相机取景，与本次用户要求父层居中冲突。按新规格退出该旧源码禁用断言，并退出同文件收拢不得取景的误导性标题/弱源码断言；保留展开、清选择等边界，居中行为由真实浏览器RED→GREEN覆盖，不用新源码文字替代行为证据。

**Task1组合GREEN**：Windows Chromium8/8（2分钟），真实上钻、刷新清零再下钻、PageDown右键收拢居中且另一分支仍展开、旧原文偏好、无展开F5相机、坏快照、展开团正文实时更新不移动相机全部通过。受影响Node170/170。复用同产品revision有效证据，不因task-done包装重复运行整组旅程；实际命令与完整输出已在所属SDD目录留存。入口按实际资源重算版本，无bundled源码变化，不重新引入无关vendor构建差异。进入fresh整体评审和精确远端完整门禁。

**整体评审同源发现与RED**：PageUp仍在重建场景后调用旧hitRegions的recenterLatestInteraction。真实合成浏览器先收拢左团、取景父域再PageUp，团数已收为1但父团不居中；pageup-red.log保留行为失败。按Review Focus纳入同一修复，使用frameClusterDomain(anchor.path)，退出要求旧recenter调用的过期源码断言。

**最终评审裁定**：1项Important，无Critical/Minor。PageUp同源旧hitRegions取景，行为RED父团偏中心约213px。按冻结父域锚点调用frameClusterDomain，保留其他分支和既有历史边界。评审仅搁置远端完整门禁及正式E3（后续必须执行），未搁置其他合理用户行为。

**补充研讨，尚未实施**：截图4用户询问Markdown表格单元格内换行，明确待沟通；先核对现有自动折行与主动换行支持，不在尚未确认时改写业务排期或表格语法。此补充不替代正在执行的导航修复。

**评审修复GREEN**：PageUp真实浏览器1/1（19.8秒），父域收拢后在5px内居中；同源修复后Node170/170。独立评审完成，仅此1项Important已按RED→GREEN修复，无新增评审席。用户随后授权补充表格换行研究与解决，作为独立渲染任务接入当前总账和目标，导航仍按原顺序收口。

**表格新增授权任务**：已研究并复现三项有效RED，独立渲染计划见[2026-10-06-table-line-breaks.md](2026-10-06-table-line-breaks.md)。当前目标通过本计划间接承接；共同候选门禁和正式E3，导航不重新开发。

**导航与表格最终候选**：共用最终组合14/14与Node162/162，导航fresh评审唯一Important已修、表格fresh评审无缺陷。完整门禁使用最终候选远端CI一次，正式世界回读只读。

**候选远端**：PR#78，888f62690a38f6302f58ddc793170d997cd90ab1，Test run37343655556进行中。正式main仍8d1f037，公共入口产品仍旧版；终态GREEN前不部署。

**候选完整门禁GREEN**：888f62690a38f6302f58ddc793170d997cd90ab1的Test run37343655556 completed/success；完整npm test与开发控制通过。按已授权E3切换正式main并只读公共回读，业务数据不用于构造写测试。

**部署事故，恢复优先**：仅Web静态文件变化却重启正式后端，停止后计划任务启动未在短等待内监听，导致用户公共CLI不可用。首次端口读取遇到退出竞态、拿不到进程身份，安全停止后未继续Start；随后任务启动状态Running但未就绪。当前同一正式入口隐藏恢复进程46016持续CPU初始化，保留stdout/stderr，watchdog启用。不宣称服务已恢复。原产品无后端改动，禁止把本次静态部署与服务重启捆绑；后端重启须预验启动、明确就绪与自动回退后才实施。此事故未归因于表格代码，持续排查实际启动耗时。

恢复与杜绝复发新增授权见[2026-10-06-runtime-deployment.md](2026-10-06-runtime-deployment.md)，健康进程保持运行，静态切换禁止再次重启。
