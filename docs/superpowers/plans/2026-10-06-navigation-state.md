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
- [ ] 按已确认主干逐项最小修复；先上钻，再刷新，再收拢。
- [ ] 原展开恢复断言按新合同更新；验证无展开F5相机、损坏快照及自动正文更新继续有效。
- [ ] 运行navigation-state/current-view-refresh/expanded-reader-refresh关键旅程；受影响模型与桥接合同通过后阶段提交。

### Task 2: 评审、远端与正式E3

**Files:** 既有总账、本计划、入口资源版本；证据仅进入既有SDD工作区。
**Interfaces:** 消费Task1候选及旅程；精确Git revision绑定远端门禁和公共回读。

- [ ] 一次fresh整体评审，实际Important/Critical按RED→GREEN修复。
- [ ] 更新实际资源入口哈希，候选推送PR，必要完整门禁取得精确revision成功。
- [ ] main快进部署；公共4784只读上/下钻与刷新/收拢回读，拦截业务写入。
- [ ] 推送正式main及审计记录，精确远端检查终态成功后关闭目标；不为记录审计检查本身无止境产生新提交。
