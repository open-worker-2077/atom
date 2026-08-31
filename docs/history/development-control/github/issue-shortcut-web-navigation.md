## 用户现象

Web 进入一个已成功创建的 `@shortcut` 后，仍停留在快捷入口自身的静态 contain 路径，没有跳转到契约指向的目标节点。

现场记录满足：

- `contract = atom.shortcut`
- `version = 1`
- `referenceId` 存在
- `target.state = linked`
- `target.path` 为现存的多层目标（GitHub 仅记录脱敏合成路径）

因此不是 Program 创建失败；故障位于 Atom 投影到 Web 导航的消费链。

## 根因边界

当前 `graph-4d-projection` 只向 Knowledge node 投影 `atomTypes: [shortcut]`、正文和 Atom path，没有投影已校验的 shortcut target；`spatial-engine.enterNode()` 也没有 shortcut 分支，只按快捷入口本地 child-domain path 进入。

## 验收合同

- [ ] 投影层只从内核已校验的 `atom.shortcut v1` 记录导出只读 `shortcutTargetPath`，不让 Web 自行解释任意 JSON。
- [ ] Web 激活 `linked` 快捷入口时，定位并进入目标 Thing 对应域，面包屑显示目标路径，不停留在快捷入口静态路径。
- [ ] broken / 无权限 / 目标尚未加载时不得伪装成功；显示明确状态并保持原位。
- [ ] 普通节点进入逻辑不变；快捷入口不复制目标事实、不继承额外权限、不重定向 Transform。
- [ ] 使用脱敏合成 Graph 做精准投影单测与浏览器交互测试。

## 状态链

`Shortcut Program 契约 → 内核持久化 → Web 投影目标坐标 → 激活跳转 → 目标域证据`

反链：#1
