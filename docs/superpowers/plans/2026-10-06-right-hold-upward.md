# 长按右键导航取景与Web诊断

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

- [ ] 隔离及正式只读真实右键按下/等待/松开逐层复现，记录路径、场景与相机的阶段变化。
- [ ] 在所属计划即时写已验证根因及最小修复主干，真实行为RED后产品修复。
- [ ] 单层/多层/异步scope/缓存父域/展开场景行为GREEN；必要受影响链阶段提交。

### Task 2: 集成有界Web诊断

**Files:** spatial-diagnostics.js、spatial-engine.js、spatial-browser-bridge.js、index.html、tests/spatial-diagnostics.test.js、tests/browser/right-hold-upward.spec.mjs。
**Interfaces:** record compact event、snapshot/export；既有导航/import/取景生命周期检查点只观察，不另建场景状态。

- [ ] 先测试有界缓冲、批量调度、坏存储/配额失败不抛到操作、载入/导出及无业务正文。
- [ ] 最小集成诊断，按需导出；证明不每帧写入、事件突发有界且失败不影响关键旅程。
- [ ] 与Task1真实用户旅程组合验证；同代码revision复用旧数据刷新与表格证据，只验证具体影响链。

### Task 3: 评审与正式E3

**Files:** 唯一总账、本计划、实际资源hash。
**Interfaces:** Task1/2最终候选、一次fresh整体评审、精确远端完整门禁、静态部署只读回读。

- [ ] fresh整体评审，实际Important/Critical按RED→GREEN修复；最终候选全量一次。
- [ ] 原服务持续运行，仅正式文件切换；公共真实长按关键旅程与诊断导出回读。
- [ ] main及审计推送精确检查终态成功后完成目标，不无限制造自指审计提交。

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
