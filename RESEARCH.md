# 从表单到多球域：3D 视觉交互范式研究

## 结论

本研究不再讨论“要不要做 3D”，而是把问题收窄为：哪一种 3D 视觉范式能用更少的视图切换、更短的路径和更直接的空间记忆完成任务。

当前最重要的结论有十一条：

1. 球体只是当前原型载体，视觉实体及其范式必须开放扩展，不能被“七种示范”或实体／空体／镜体三类封顶。
2. “左键、右键、滚轮、捏合、凝视”不是功能，只是可替换输入；范式层只定义视觉意图。
3. 候选、聚焦、直接操作和操纵是不同视觉阶段；高频展收、进退与球面切换应一键直达，不经过菜单，但仍由手势仲裁避免误触。
4. 语义缩放应有明确阶段与滞回：当前原型采用 `beacon → identity → preview → interior` 四级，避免阈值附近闪烁。
5. 隧洞表达“可进入”和纵深，不以当前是否已有子节点决定入口资格；同层展开、沉浸进入与独立球面必须保持分工。
6. 域径图、最多两个细节镜、子域背景和视角历史共同维持全域、局部与细节间的对象恒常性。
7. “退出父域”属于层级导航；“视角后退／前进”属于视觉快照历史，二者必须彼此独立。
8. 逻辑层可以开放递归，渲染、候选、镜体、历史、路径和子域缓存都必须有预算与回收边界。
9. 3D 层只处理空间导航、视觉反馈与意图广播，业务流转继续由外部脚本负责。
10. “按下”不是确认：必须先建立候选，以位移阈值区分点击、环绕和抓取，再在松手时确认；否则球体越密集，越难从对象表面起手旋转。
11. 开放性不能只写在文档里：实体、能力、视觉预算和命令要经过白名单注册表接入，引擎中心不能继续堆固定类型和任意载荷。

当前原型采用一个紧凑而可扩展的模型：所有载体球都是可进入的球形隧洞；`hasChildren` 仅记录是否已有种子子内容，无子节点时进入空域并可新增节点。球面显示是独立观察层，不能替代子域拓扑。视觉意图静默、设备无关，由可配置默认预设映射。稀疏曲线链只表达被提供的父子或显式视觉关系，不推断业务含义、流程或箭头。逻辑递归可以无限，但可见实例、预取和历史必须有界。未来数据侧功能球没有被否定，只能由另一个脚本域注册；当前视觉导航不实现数据流。

## 研究依据

Bowman 等人把 3D 用户交互拆成三组基本任务：导航、选择／操作、系统控制。这比“鼠标左右键分别做什么”更稳定，因为设备可以更换，任务语义不会改变。[An Introduction to 3-D User Interface Design](https://direct.mit.edu/pvar/article/10/1/96/18291/An-Introduction-to-3-D-User-Interface-Design)

Furnas 与 Bederson 的空间—尺度图把“尺度”本身视为界面维度；Pad++ 随后证明内容可以在连续缩放中逐级显露，而不必每层都跳转页面。这直接支持“信标 → 标签 → 预览 → 内部球域”的语义缩放。[Space-Scale Diagrams](https://doi.org/10.1145/223904.223934)、[Pad++](https://hci.ucsd.edu/hollan/Pubs/pad.pdf)

Cone Trees 说明 3D 层级可以让焦点路径转到观察者前方，同时压低无关分支；H3 进一步展示了大型层级图的焦点上下文、选择性展开与裁剪。这支持“卫星展开 + 活动窗口渲染”，而不是一次画出无限节点。[Cone Trees](https://doi.org/10.1145/108844.108883)、[H3: Laying Out Large Directed Graphs in 3D Hyperbolic Space](https://graphics.stanford.edu/papers/h3/html/h3.htm)

Feiner 与 Beshers 的 Worlds within Worlds 已经提出嵌套世界的直接操作。多球域将这个思路变成可持续递归的球形门户：外部先看见内部场域，随后连续靠近并进入。[Worlds within Worlds](https://www.cs.columbia.edu/~feiner/courses/csw4172/resources/Feiner-Beshers-UIST1990.pdf)

Apple 当前的空间系统已经具备 Window、Volume、Immersive Space、间接凝视选择和 Portal 等底座，但大量生产任务仍是被安置在空间里的二维窗口。可以吸收它的空间输入、渐进沉浸和 Portal，而不照抄“大屏幕漂浮在房间里”的外壳。[Designing for visionOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos)、[Spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout/)、[PortalComponent](https://developer.apple.com/documentation/realitykit/portalcomponent)

W3C Pointer Events 统一鼠标、触控笔和触控指针；WebXR 的 `select` / `squeeze` 同样表达平台无关的主操作与抓握语义。这证明按键配置必须在范式之外。[Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)、[WebXR Device API](https://immersive-web.github.io/webxr/)

OpenXR 进一步把应用定义的 Action 与设备 Interaction Profile、Suggested Binding 分离，运行时还可以按用户偏好覆盖绑定；Unity XR Interaction Toolkit 也把 Hover、Select、Focus、Activate 和 Input Reader 分层。这支持当前的“设备适配器 → 空间意图 → 视觉状态机”，而不是在引擎里判断某个固定按钮。[OpenXR 1.1 Input and Haptics](https://registry.khronos.org/OpenXR/specs/1.1/html/xrspec.html#input)、[Unity XR Interaction Toolkit architecture](https://docs.unity.cn/Packages/com.unity.xr.interaction.toolkit%403.0/manual/architecture.html)

Stoakley、Conway 与 Pausch 的 World-in-Miniature 证明全尺寸世界与微缩动态视口可以共存并共同支持选择、导航和观察；Viega 等人的 3D Magic Lenses 则把局部观察从平面窗口扩展为有影响体积的三维镜体。这分别支持递归域径缩略图和有限数量细节镜。[Virtual Reality on a WIM](https://www.cs.cmu.edu/~stage3/publications/95/conferences/chi/paper.html)、[3D Magic Lenses](https://www.cs.cmu.edu/~stage3/publications/96/conferences/uist/lenses/index.html)

单射线“第一碰撞即选中”在小目标、遮挡和密集场景中并不稳健。SQUAD 通过渐进式精化降低精度负担；FocalSelect 使用小视锥、评分和上下文保持处理遮挡目标。这支持当前原型先构造候选集，再按焦点权重、命中距离、深度和稳定性评分，并在低置信度时保留歧义候选。[SQUAD](https://doi.org/10.1109/3DUI.2011.5759219)、[FocalSelect](https://doi.org/10.1109/TVCG.2025.3549554)

Apple 对空间输入的官方设计说明把眼睛视为目标机制、手势视为确认机制，并要求 hover 反馈克制、目标稳定、不要在确认前制造意外运动。这进一步支持 candidate／focus／preview／commit 分离。[Design for spatial input](https://developer.apple.com/videos/play/wwdc2023/10073/)、[Design hover interactions for visionOS](https://developer.apple.com/videos/play/wwdc2025/303/)

Three.js 的 Raycaster 可以把二维指针和 XR 控制器统一为空间射线，Scene Graph、LOD 与 InstancedMesh 则对应父子局部坐标、语义层级和大批量球体实例。当前 MVP 以无依赖画布完成验证，生产版可平滑迁移到这套 WebGL 底座。[Raycaster](https://threejs.org/docs/pages/Raycaster.html)、[Scene graph](https://threejs.org/manual/en/scenegraph.html)、[LOD](https://threejs.org/docs/pages/LOD.html)、[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)

## 总体分层

```text
物理输入
  ↓
设备适配器
  ↓
按键配置模块
  ↓
空间视觉意图
  ↓
spatial-entity-registry.js
  ├─ 实体／能力／预算白名单
  ├─ 注册式空间命令
  └─ 拒绝业务字段与非视觉意图
  ↓
spatial-view-grammar.js
  ├─ 四级语义尺度与滞回
  ├─ candidate / focus / preview / commit / manipulate
  ├─ 有限 visualMeta 白名单
  ├─ Focus+Context 权重
  └─ 视觉快照与后退／前进历史
  ↓
手势仲裁器
  ├─ down = candidate
  ├─ move threshold = orbit / grab
  └─ up = commit
  ↓
相机／球域／兼容调试菜单／球镜表现
  ↓
可选：向外部业务脚本广播意图
```

这一分层意味着：购买新的手势、戒指、手环或空间控制器后，只增加适配器和映射，不重写球域。

## 开放式视觉实体与能力模型

当前根域的七颗主球只是为了同时展示若干代表行为，不是实体集合或范式上限。语法允许继续引入点、球、簇、壳、云、轨迹、入口、镜体、代理和复合工具。新增实体不需要先挤进一个固定“类型”，只需声明几何表现、局部坐标、视觉能力、状态转移、语义尺度和渲染成本。

### 外壳能力

- `Body`：半透明形体与聚焦轮廓。
- `Portal`：深不见底的球形纵深与进入边界，不缩绘子拓扑。
- `Lens`：观察、放大、剖视和比较。
- `Halo`：命令、提示与局部卫星环。
- `FocusField`：视觉命中包络与反馈。

### 空间角色

- 当前对象；
- 卫星节点；
- 局部入口；
- 观察窗；
- 域径图；
- 细节镜；
- 命令环；
- 历史域节点；
- 递归域路径；
- 视角历史标记；
- 路径标；
- 幽灵代理。

### 表现级别

- `beacon`：远处信标，只保留位置、方向和存在感；
- `identity`：身份轮廓与名称；
- `preview`：子结构、入口深度或镜体内容预览；
- `interior`：完整内域表现和进入准备。

阶段由投影半径决定，并带滞回区间；焦点与兼容 Peek 可以提高表现权重，但不会把业务状态写入尺度规则。一个球可以同时是“半透明外壳 + 局部入口 + 可展开 + 独立球面”，无需切换成互斥类型。

## 空间视图语法（第二轮基础，第三轮修订）

### 开放视觉注册表

当前七个根球和七个命令已经从引擎中心移入 `spatial-entity-registry.js`。注册表只接受名称、预览键、位置、半径、首选视觉意图、能力和视觉预算等白名单字段；命令必须引用已知视觉意图，并可声明所需能力、活动状态标签和渲染成本。新增根球或命令不需要再修改引擎的中心条件分支。

注册表测试故意夹带 `approvalStatus`、`customerId`、嵌套 `payload`、未声明 capability 和 `approve` 命令：业务字段被丢弃，业务意图被拒绝。它不是“把业务脚本塞进插件系统”，而是限制视觉层只能扩展视觉语法。

### 候选—手势仲裁

指针按下现在只建立候选并捕获起点；鼠标移动超过 6px、触控超过 10px 后，主操作转为环绕，显式抓取映射转为节点移动；只有在未越阈值时松手才提交点击。这样球体不再垄断拖动起点，用户可以从节点表面直接旋转场域，也不会因轻微抖动误触首选意图。

事件广播只携带 `visualMeta`，并按意图白名单保留 `dx`、`dy`、`delta`、`targetDepth`、抓取阶段，或 1–3 的最终确认击数 `confirmationCount`；击数只表明视觉承载位，任意对象和业务语义都不会原样穿过视觉层。

### 四级语义尺度与滞回

`spatial-view-grammar.js` 把语义尺度从绘制细节中抽离为独立解析器。当前阈值为身份、预览和内域三条边界，每条边界带同一滞回带；向前跨级必须超过“阈值 + 滞回”，向后退级必须低于“阈值 - 滞回”。因此对象在临界距离附近不会随单帧相机抖动反复切换表现。

这仍是视觉分辨率选择，不是数据筛选。语义层只决定当前看见信标、身份、预览还是内域，不决定某条业务记录是否有效。[Space-Scale Diagrams](https://doi.org/10.1145/223904.223934)、[Pad++](https://hci.ucsd.edu/hollan/Pubs/pad.pdf)

### 候选、聚焦、预览、确认与操纵

推荐的主路径为：

```text
idle
  → candidate / aim
  → focus
  → preview
  → commit
  → stable

focus / preview
  → manipulate
  → focus
```

- `candidate`／`aim` 只是短暂命中，不移动视角、不展开菜单；
- `focus` 建立稳定观察锚，并提升直接关系与祖先上下文；
- `preview` 是可逆 Peek，可以随时取消；
- `commit` 只确认视觉意图，例如进入、展开、切镜或跳转；
- `manipulate` 只改变相机或个人空间布局，默认不写回业务数据。

状态机不认识鼠标左键、右键、手柄按钮或捏合动作。设备配置只把物理信号映射到上述意图。

### 隧洞、球面与兼容 Peek

第二轮曾尝试在入口内缩绘实际子域，但它与右击同层展开、双击沉浸进入和独立球面显示发生语义交叉，第三轮已将其撤出主渲染器。现在隧洞只表达可穿越的深度和方向，不泄露子节点拓扑；球面只显示抽象展示内容。若未来设备需要 `peek`，它只作为可逆的放大、方向提示或预取阶段存在，不能替代展开与进入。[Worlds within Worlds](https://www.cs.columbia.edu/~feiner/courses/csw4172/resources/Feiner-Beshers-UIST1990.pdf)、[PortalComponent](https://developer.apple.com/documentation/realitykit/portalcomponent)

### 域径图与双细节镜

- 域径图从全域向下显示进入入口与当前深度，不承担业务总览表；
- 细节镜显示某一载体及局部卫星拓扑，最多同时存在两个；
- 两个细节镜之间保留弱连接，表达“正在比较”而非生成二维对照卡；
- 第三个细节镜开启时回收最早打开的镜体，使观察工具也受预算约束。

### 递归域径与视角历史

进入子域后，全域与进入节点按层向下组成域径图；选择历史域节点执行的是 `exitToDepth`。`backView` 和 `forwardView` 则恢复有界视觉快照，其中包含域路径、深度、相机、焦点、域径图和细节镜。于是：

```text
exit / exitToDepth = 改变层级位置
backView / forwardView = 恢复观察历史
returnOverview = 直接回到根域
```

三者不能互相冒充，更不能与业务撤销／重做混用。

### Focus+Context 与选择歧义

焦点对象、直接关系、祖先、同级、远端和工具具有不同视觉权重。权重同时影响球体透明度、连接线、标签显著度和命中优先级；外围对象降权但保留方位，不因聚焦而全部消失。[H3](https://graphics.stanford.edu/papers/h3/html/h3.htm)、[Cone Trees](https://doi.org/10.1145/108844.108883)

命中阶段先收集包络内候选，再计算焦点优先级、归一化距离、深度和当前 hover 稳定性。第一、第二候选分差不足时，系统保留最多三个歧义候选，后续可继续发展为显式渐进精化；当前不会把“第一碰撞”直接当作唯一真值。

## 视觉意图词汇

| 分组 | 意图 |
| --- | --- |
| 候选与聚焦 | `aim`、`candidate`、`focus`、`blur`、`nextFocus`、`previousFocus` |
| 预览与确认 | `peek`、`endPeek`、`activate`、`commit`、`confirm`、`cancel` |
| 视角 | `orbit`、`pan`、`dolly`、`roll`、`fly`、`resetView` |
| 层级 | `enter`、`exit`、`exitToDepth`、`reveal`、`collapse`、`returnOverview` |
| 空间操作 | `grab`、`release`、`move`、`rotateObject`、`scaleObject`、`pin` |
| 观察 | `inspect`、`toggleWorldLens`、`magnify`、`compare`、`switchLens` |
| 命令界面 | `summonMenu`、`chooseMenuItem`、`dismissMenu` |
| 视图历史 | `backView`、`forwardView`、`returnAnchor` |

这些词只修改视觉和导航状态，或者向外发出意图；它们不定义业务数据如何流转。

## 当前七个验证种子

以下七项用于覆盖一组有代表性的视觉行为，但研究课题不是制作“七种节点类型”。域径图、细节镜、路径痕迹、候选歧义层和未来新增实体都可与这些种子组合，也可以形成新的范式。

### 轨道视域

用户保持在球体之外，通过环绕、远近与聚焦理解对象和近邻。高频操作不必离开当前场域，子节点以卫星显露。

### 递归球域

球壳是深不见底的球形隧洞。从外部只看到纵深、边界与方向，不提前绘制子节点；进入后子域扩展成新的当前世界，父域保留在右侧递归域径中。

### 球镜观察

镜体是球形观察窗，不是矩形浮窗。它可以局部放大、透视内部结构、切换剖面或承担并排比较，同时保留当前场域。

### 语义尺度

同一载体随距离变化：信标 → 标签 → 结构预览 → 内部球域。尺度成为命令，减少逐层点击。

### 群簇展开

聚合球在原位拆成一组可操作节点，关系通过相对位置、轨道和连接表达。它适合替代表格的行列聚合视图。

### 命令星环

菜单附着当前焦点，以方向和距离承载视觉命令；唤出菜单的物理按键由映射模块配置。它保留为兼容／调试入口，不是当前的核心导航路径。菜单自身仍是球体节点，不退回卡片或下拉框。

### 空间工作台

节点可以抓取、移动、旋转、缩放、固定与临时成组。所有变化先作为个人视图状态存在；若要保存或流转，交给外部脚本。

## 无限递归如何保持经济

逻辑层可以继续生成任意深度；渲染层只实例化：

- 当前球域；
- 当前焦点及直接卫星；
- 少量近邻兄弟；
- 祖先路径代理；
- 一个即将进入的预取子域。

当前第五轮原型沿用多级预算：候选遍历最多 180 个，同屏绘制最多 44 个，卫星最多递归三层；域径图始终绘制当前真实路径的全部层级，并按可用高度连续压缩步距，不再以七项截断；细节镜最多两个，视角历史最多 36 份快照，域缓存最多 24 份，域路径缓存最多 48 条，并且同一时刻最多保留一个预取子域。数字是当前实验预算而非未来标准，但“每一种无限逻辑都必须对应有限活动窗口”应成为范式规则。

未来 WebGL 版可进一步使用视锥剔除、LOD、InstancedMesh、纹理预算和显式资源释放。[Three.js LOD](https://threejs.org/docs/pages/LOD.html)、[Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)

## MVP 的判断标准

后续不要再只问“好不好看”，而要记录：

- 到达目标节点所需的意图次数；
- 在全域、局部与对象间切换的平均时间；
- 返回路径是否依赖记忆；
- 退出父域与视角后退是否始终可区分；
- 缩放是否能替代一次显式进入；
- 隧洞是否始终只表达可进入纵深，球面是否始终不冒充子拓扑；
- 域径图是否能在局部中恢复全域方向并快速返回任意历史层；
- 双细节镜是否比切页更容易比较，同时没有遮挡主场；
- 展开后同屏保留多少有效上下文；
- 低置信度候选能否被看见和继续精化，而不是误选；
- 不同输入设备是否只改映射而不改行为。

第五轮已经完成浏览器实测、关键交互截图和观感／边界迭代。实测覆盖主键最终 1／2／3 击仲裁与光纹、聚焦后空白回拉、镜面覆盖和结构边界分工、右键双击递归进入、增强后的子域背景，以及第 9 层共 10 个环的真实域径。三档主键只广播有限视觉意图与最终击数，未接入数据流脚本。

下一阶段将在真实知识库项目中记录到达意图次数、定位时间和返回错误率，以量化 3D 空间范式相对于表单／卡片的效率优势。本轮先完成可运行的视觉交互框架与验收证据，不提前接入业务数据流。

## 暂缓但保留的质量项

遮挡、迷航、误触、深度选择、晕动和可访问性客观存在，但当前把研发重点放在空间框架，同时保留基本护栏：候选评分、歧义候选集、焦点轮廓、命中包络、静态星点、慢速卫星、可降低动效、域径图、全域返回和独立视角历史。框架成立后再继续优化，不让次级问题吞掉主线研发，也不把尚未解决的问题包装成已经解决。
