# Shared Presentation Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机继承本机已有有效展示配置，后续两端共用同一保存结果，解决浏览器默认0导致团边界消失。

**Architecture:** 空间体验持有展示设置；复用既有 view-state 文档及 JSON repository 保存独立的 presentation-settings.json，不依赖可重建 knowledge 投影。现有展示模型继续唯一规范化参数，浏览器缓存仅承担迁移与离线回显；现有服务增加一个展示设置读写接口。

**Tech Stack:** Node.js标准库、既有Browser IIFE模型、HTTP、Node test runner、已安装Playwright。

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md` §5.5。I3/U3/D2/E3；Transform已完整交付、回告且核对远端备份，现在执行本项，早于旧print及A剩余任务。

**当前执行（2026-09-06）:** 保存反馈已部署e82984d，手机Task2在c2f8510吸收该基线后续接；当前整分支候选b21097a；任务级发现已在cd3335c全部关闭，整分支仅发现自有旧成功回执覆盖较新未保存调节值，正在唯一final-fix。43/43、52/52及build/control和此前R3浏览器1/1证据保留，未全量或部署。最终候选全量在稳定审查后一次执行；真机及实际本机值缺口保留。

**历史RED检查点（2026-09-06）:** 原Task2两个RED测试文件已原样提交为48c79fb安全检查点，未实现产品逻辑、未新增测试运行、未宣称GREEN；待保存反馈交付后安全合入main并续接。

**历史暂停断点（2026-09-06）:** 隔离工作树`.worktrees/shared-presentation-settings`、分支`fix/shared-presentation-settings`，Task1在7b47728实现并经独立审查通过（41/41、2/2）。Task2实施方shared_settings_task2已取得浏览器桥RED：既有30条通过、新5条失败；另有1条新Playwright场景尚未运行。工作树只改测试，未改产品代码/提交。用户要求先核查Superpowers本地记录与实际执行，Task2安全暂停、无运行中测试；核查文档已合入7b2a93d，产品代码与7b47728一致；现按用户更新软件要求继续暂停，恢复后先完成Web保存反馈，再由原Agent从RED续接。真实本机参数及真机边框仍未取得，不写测试值到生产。

**Task1 RED:** 新增真实随机端口隔离服务测试GET共同设置接口得到404而非200，`node --test --test-isolation=none tests/atom-presentation-settings.test.mjs`为0/1通过；保留fixture。接下来实现共同仓储/CAS及HTTP合同；只移除实际必要测试中的fixture递归清理，不扩展为全库清理。

**Task1首轮GREEN（历史阶段）:** 实施方报告新增共同配置测试9/9、约2.38秒，覆盖真实服务接线、网关身份、CAS/过期拒绝、Origin初始化、SSE、冷重启、业务及投影/历史文件hash不变、EIO旧文件和失败临时文件留存；正在完成模型/view-state及既有server具名相邻验证，不宣称已部署或真机完成。

## Global Constraints

- **执行状态**：Task1在7b47728完成，控制方已回读原始41/41及2/2，独立审查Spec符合/质量Approved且无问题；Task2从该提交续接浏览器继承与可见效果验收，服务尚未部署。

- 手机端展示参数以本机已有有效配置为基准；不静默采用另一套默认配置。
- 展示配置属于空间体验，不写入atom.json、不制造Graph修订，不以knowledge投影作为权威。
- 手机空存储或旧默认0不能反向覆盖本机设置；用户明确设置0仍是合法选择。
- 过期响应/并发旧快照不能覆盖较新设置；失败时保留可用场景并明确配置未同步。
- 实际本机数值尚未取得，55/35仅为控制探针，禁止作为生产参数。
- 保留既有Trigger/Strut/权限/视图语义；不新增依赖，不改网络/VPN/Tailscale策略。
- 实施Agent不生产写入、不部署、不push、不删除产物。控制方按既有授权集成部署、私密备份与代码推送。

## 设计裁定

- **来源证据**：spatial-engine loadDemoSettings只读各浏览器v2/v1 localStorage；normalizeSettings默认nestedTunnelPercent=0，绘制alpha与线宽乘此值。原/__spatial/api/view只携带导航/相机/节点，不含展示设置。已有createViewStateRepository尚未与此浏览器链接通。
- **方案比较**：仅修改默认值不能同步用户配置；把设置塞进knowledge.view会使可重建投影成为配置权威。采用现有空间体验仓储保存独立设置，浏览器通过同一公开接口取用，保全业务世界边界。
- **首次迁移**：共同配置不存在时返回明确uninitialized；只允许本机回环页面已有的有效v2/v1记录自动提出一次初始化，expectedRevision=0原子竞争。空记录和远程页面不自动初始化；已有共同配置始终优先。自动迁移前保存原浏览器值的独立备份key，迁移失败保持原值，禁止以规范化默认值冒充本机已有记录。
- **生产缺口**：当前CUA无本机浏览器标签页，agent-browser也未发现可调试Chrome；实际参数仍待本机原页面可读或用户提供。此缺口只阻塞生产种子核对/真机闭环，代码与私有跨端验证可先完成；不能因缺口让手机旧0抢先成为基准。
- **后续写入**：UI每次操作只提交改动字段patch及最后读取的revision；服务在同一文件的短串行区重读、CAS、原子保存。409先回读最新值，显示冲突，禁止自动用整个旧快照重试覆盖。最新共同设置应用到现有模型后同步控件和当前场景。
- **更新通知**：复用既有SSE连接增加具名presentation-settings事件，仅通知设置revision；浏览器首次连接、该事件、断线恢复及页面重新可见时读取设置。不得因此拉全世界或新增永久轮询。

## 合同与恢复

| 入口 | 输入 | 输出 / 错误 | 不变量 |
|---|---|---|---|
| GET /__spatial/api/presentation-settings | 无用户可选路径 | {ok:true,revision:0,initialized:false,settings:null} 或已初始化settings | 只读当前配置的世界，不扫描世界事实 |
| PUT 同一路径 | {expectedRevision,patch}；初始化额外bootstrap:true | {ok:true,revision,initialized:true,settings}；409 PRESENTATION_SETTINGS_CONFLICT | 一次保存最多推进设置revision一次，不推进世界revision |
| settings repository read | 无 | atom.view-state v1或缺失 | worldId由服务配置固定，不由请求选择 |
| settings repository update | 规范化patch、expectedRevision | 已持久文档 | 所有同进程facade按规范化绝对路径共享短串行区；不承诺并行OS writer |

- 请求只允许模型支持的现行字段，拒绝数组、额外字段、非有限数字及不合法类型；有效值复用同一normalizeSettings，保持既有范围/默认值含义。body沿用现有有界JSON读取。
- 浏览器写入要求同源fetch（有Origin时Sec-Fetch-Site须same-origin），拒绝cross-site/site；沿用现有私网入口身份门禁，接口不扩大网关权限。服务器不凭viewport、User-Agent或手机类型授予初始化权；bootstrap的本机自动迁移由实际回环Origin加已有存储事实约束，缺失Origin的调用也不能自动bootstrap。
- settings文档仅view.presentationSettings；保留atom.view-state既有schema。文件位于配置context同目录，路径与atom/graph/knowledge/journal不同；冷重启读取相同文档。现存格式或worldId不符时拒绝覆写。
- 保存失败不广播新revision、不宣称已保存；旧文件有效，失败临时文件保留。缓存命中可临时显示，但不能反向成为服务权威。
- 回退代码不回退业务世界；私密保留新增设置文档及迁移前缓存，旧版本仍可使用原localStorage。不得公开备份用户浏览器其他数据。

---

### Task 1: 共同设置持久化与服务合同

**Files:**
- Modify: `spatial-demo-model.js`（只使同一模型可被Node导入，既有浏览器全局与参数语义保持）
- Modify: `src/atom-system/adapters/json-view-state-repository.mjs`（可选expectedRevision与同路径CAS；保留原write接口行为）
- Create: `src/atom-system/spatial-experience/presentation-settings-service.mjs`
- Modify: `work-engine/atom-language/graph-server.mjs`（配置唯一设置文件并装配服务）
- Modify: `cli/lib/server.mjs`（读写路由、具名SSE通知）
- Create: `tests/atom-presentation-settings.test.mjs`
- Reuse: `tests/spatial-demo-model.test.js`、`tests/atom-view-state-migration.test.mjs`、`tests/spatial-server.test.mjs`

**Interfaces:**
- Consumes: `createViewStateRepository({file,worldId})`、`normalizeSettings(input)`、createSpatialServer既有options和SSE连接。
- Produces: `createPresentationSettingsService({repository})`返回`read()`和`update({expectedRevision,patch,bootstrap})`；read返回上述revision/initialized/settings，update保存成功后返回同形结果。HTTP边界负责实际Origin约束，服务负责类型/CAS/初始化状态。

- [x] **Step 1: 写RED与运行**

```js
assert.deepEqual(await service.read(), {revision:0,initialized:false,settings:null});
const seeded = await service.update({expectedRevision:0,bootstrap:true,patch:hostSettings});
assert.equal(seeded.settings.nestedTunnelPercent, 55); // fixture only
assert.equal((await coldService.read()).settings.nestedTunnelPercent, 55);
await assert.rejects(service.update({expectedRevision:0,patch:{nestedTunnelPercent:0}}),
  {code:'PRESENTATION_SETTINGS_CONFLICT'});
```

Run: `node --test --test-isolation=none tests/atom-presentation-settings.test.mjs`。真实fixture先证明公共GET缺路由或共同保存尚不存在；两facade同expectedRevision竞争只一笔成功，EIO/格式冲突不改原文件，合法0可保存。

- [x] **Step 2: 最小实现**

把现有demo model包成浏览器全局/Node CommonJS均可使用的同一个factory，禁止复制两份默认值。repository仅在调用者传expectedRevision时开启CAS及自动+1，未传时维持旧write(view,{revision})合同。settings service合并当前settings与patch后规范化；首次只接受bootstrap及0修订；服务文件名固定，HTTP不能选路径。

```js
const current = await service.read();
const updated = await service.update({expectedRevision:current.revision,
  patch:{nestedTunnelPercent:37}});
// Publish presentation-settings revision only after update resolves durably.
```

绑定API/网关后用真实随机端口验证空读取、初始化、手机读取、更新、过期拒绝、跨站拒绝、服务重启；同时hash核对atom/graph不变。拒绝Bootstrap来源时必须零文件写入。

- [x] **Step 3: 定向GREEN并提交**

Run: `node --test --test-isolation=none tests/atom-presentation-settings.test.mjs tests/spatial-demo-model.test.js tests/atom-view-state-migration.test.mjs`。随后仅运行新增路由影响的server具名测试。GitNexus/diff检查后明确文件git add及commit，报告命令、输出、私有证据路径；独立任务复核。

### Task 2: 浏览器继承、更新与部署验收

**Files:**
- Modify: `spatial-engine.js`（设置公开适配器、应用服务结果与变更事件）
- Modify: `spatial-browser-bridge.js`（GET/PUT及迁移、SSE/可见性恢复）
- Modify: `index.html`（设置同步状态的可访问提示，沿用既有设置面板）
- Modify: `tests/browser-bridge-contract.test.js`
- Create: `tests/browser/presentation-settings.spec.mjs`
- Modify: 本计划、既有Web规格、唯一总账、恢复断点（控制方持有）

**Interfaces:**
- Consumes: Task1唯一GET/PUT与presentation-settings SSE事件。
- Produces: `spatialLab.presentationSettings()`读取当前设置与原缓存存在标记；`spatialLab.applyPresentationSettings(settings)`规范化并应用且不产生反向保存事件；用户updateDemoSettings发`spatial-presentation-settings-changed`，detail仅含改动字段patch。迁移原值单独保存为`graph-4d.presentation-settings.pre-shared.v1`，不覆写已有备份key。

- [x] **Step 1: 浏览器RED**

两独立浏览器context：host使用实际回环入口且预置v2 fixture55/35，mobile用同一私有测试服务、独立browser context与存储；实际入口两端可以同origin，手机先开不初始化的设备来源分支由bridge VM fixture明确远程hostname验证，禁止把browser context隔离误称为真实手机，存储预置0/0。先由host迁移，mobile GET继承；不得共享Playwright storageState冒充同步。

```js
assert.equal(await mobilePage.locator('#nestedTunnelStrength').inputValue(), '55');
assert.equal(await mobilePage.locator('#nestedTunnelInteriorStrength').inputValue(), '35');
assert.equal(await hostPage.locator('#nestedTunnelStrength').inputValue(), '55');
```

再覆盖仅手机先开时不初始化、断线保存失败不反写、旧GET晚到不覆盖较高revision、真实合法0保存并重载保留。使用既有A展开fixture检查最终Canvas边界alpha/线宽或像素结果；模型值通过不替代可见边框。

- [x] **Step 2: 接通浏览器链**

首次GET优先共同配置；仅uninitialized且回环页面真实有效raw缓存时备份后bootstrap。applyingShared标记只阻止回声写入，不关闭用户操作。用户patch串行送往服务，冲突回读而不自动覆写；保存失败显示未同步。SSE同一连接监听新事件，恢复时独立读设置，应用后按实际布局字段更新可见场景。

```js
const snapshot = await request('/presentation-settings');
if (snapshot.initialized && snapshot.revision >= settingsRevision) {
  settingsRevision = snapshot.revision;
  lab.applyPresentationSettings(snapshot.settings);
}
```

- [ ] **Step 3: 受影响链与最终候选**

Run: `node --test tests/browser-bridge-contract.test.js tests/atom-presentation-settings.test.mjs`；随后`npx playwright test tests/browser/presentation-settings.spec.mjs --config=playwright.config.mjs --output="$env:TEMP/atom-shared-settings-$(Get-Date -Format yyyyMMdd-HHmmss)"`，复用既有4796隔离服务器（本身调用startAtomGraphServer），不把Playwright spec当Node test运行。当前层GREEN后development-control与最终候选npm test各一次，任务及全分支独立评审。若A未合入仍用当前生产模式验收；A后续集成须保留共同配置链和新增secondaryNavigationDelayMs字段，不撤回为纯localStorage。

- [ ] **Step 4: 部署与真实手机收口**

控制方核对实际本机基准来源、私密迁移前备份、候选SHA，复用既有Atom Graph Runtime受控部署；正式域名GET回读与缓存恢复验证。真实手机读同一revision、参数与边框显示后才关闭；缺实际本机值或手机屏幕入口时明确局部缺口，继续与其独立的已批准任务，不宣称真机完成。完成后旧print迁移、A余项继续，阶段汇报不停止持续任务。

## 自审与状态

- 所有§5.5要求映射到两项任务：共同权威/迁移/CAS/恢复为Task1+2；实际屏幕和真机为Task2。已知生产种子缺口明确保留，没有虚构实际参数。
- 只复用展示模型与空间体验仓储；新接口隐藏存储路径，不重写Graph/Program/授权。并行OS写入、账号多租户与全配置平台不在本轮范围。
- Task1已完成并独立Approved；Task2 d760145实现，f773287经两轮时序修正，原始40/40、49/49、browser1/1及build/control已核对，范围复审进行中；最终候选全量、生产部署及真机结果尚未完成。

- **R2裁定（2026-09-06）**：根Agent核对现有PUT catch/finally与GET源码后采纳Astra咨询中的开始/完成双门控：写入期间仅合并deferred read，catch只记回读需求，finally清inFlight后统一回读并阻止旧队列插入；不能等待自身delivery。外部权威世代推进即重置新事件queue base，旧世代项保持失效。属于既有过期写拒绝/同设备连续操作合同的实现修正，不改内核或服务API。

- **最终全量结果（2026-09-06）**：候选62a194c任务与整分支复审已关闭；npm test完整结束exit1，1826项/1823通过/3失败，426594ms。原始证据保存在settings工作树的.superpowers/sdd/2026-09-05-shared-presentation-settings/final-full-62a194c.txt。失败分别为默认路径精确断言未纳入新增settings文件、空间体验服务直接导入外部展示模型违反既有依赖边界、旧偏好迁移测试引用已替换函数。当前仅定向回修三项，保留架构门禁与旧迁移语义，不部署、不重跑已通过全量；settings_task2_r4实施，root独立裁定。
