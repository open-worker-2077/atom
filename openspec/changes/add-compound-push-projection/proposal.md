## Why

Atom 已保留带稳定身份、依赖路径、后项角色和独立 Program 判定的复合 support clause，但 Web 仍可能把同一 clause 展开成彼此无关的二元线，无法让使用方辨认一项复合推支的汇流、共享干线与分流。

## What Changes

- 直接从现有 `supportClauses` 投影复合推支，不增加第五轴、额外事实结构或第二关系存储。
- 以 clause identity 贯穿前项分支、共享干线和后项分支；独立 `thing@program` 仅承担推支判定，普通前后项只承担事实端点角色。
- N→1 在归一化路径 50% 汇合后共享一条干线，1→N 在 50% 分叉前共享一条干线，N→M 形成汇合—共享干线—分叉。
- 保持普通二元 support 的既有直连几何、方向标记、标签和交互语义。
- 仅为当前可见关系团计算并绘制派生几何；不写 `atom.json`，不触发全域事实或投影重算。

## Capabilities

### New Capabilities

- `compound-push-projection`: 定义现有复合 support clause 到 Web 共享干线几何、身份、方向、局部性和二元兼容的投影合同。

### Modified Capabilities

无。

## Impact

- Graph JSON 的复合 clause 规范化与既有 support projection metadata。
- `spatial-visual-model.js` 的复合推支投影计划和可测试几何。
- `spatial-engine.js` 当前可见团的 Canvas 推支绘制。
- 聚焦 Node 合同测试及 Chromium 脱敏复合场景。
