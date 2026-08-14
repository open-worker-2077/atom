import assert from 'node:assert/strict';

const stateLogic = '状态流转：未进入→进行中→待人工审核→已通过；需重做时退回；人工确认后可设为已冻结并触发写锁。';

const guides = new Map([
  ['推进流总控', '整条推进流的总入口，按“设标→建标→推进→收尾”组织任务。导航坐标指向首个未完成主干节点；人工负责方向、审核、裁定和冻结，Agent 负责调研、执行、验证与回写。'],
  ['推进流总控/设标/定向', `定向负责把原始意图收束为可验收的方向，是调研与策评的前置。人工主导取舍，Agent 负责消除歧义并检查结果是否可验证。${stateLogic}`],
  ['推进流总控/设标/调研', `调研负责围绕定向中的关键未知，从高价值渠道获取、研究并比较可信素材。其产出必须能支撑后续方法选择，而不是堆积资料。${stateLogic}`],
  ['推进流总控/设标/策评', `策评负责把方法形成与后果评估合并进行，防止只提方案不评估代价。Agent 负责展开候选和权衡，人工负责选定方法。${stateLogic}`],
  ['推进流总控/建标/建表', `建表负责把已选方法编译为可填报、可引用、可校验的信息结构。Agent 主建，人工检查它是否完整承载策评方法。${stateLogic}`],
  ['推进流总控/建标/分层', `分层负责将任务从低成本基础范围逐步扩大到全量范围。每层只在上一层通过后启动，用小范围失败降低全量试错成本。${stateLogic}`],
  ['推进流总控/建标/分片', `分片负责定义当前层如何由预定义脚本生成可独立执行和交验的实际分片。它只规定划分方法，依赖与校验继续由建表结构承载。${stateLogic}`],
  ['推进流总控/推进/试点', `试点是总控向下派发当前层分片的执行入口。下级 Agent 只负责领片、执行并一次性回执，不自行改变整体推进节奏。${stateLogic}`],
  ['推进流总控/推进/回归', `回归是总控对当前分片的审核与验收环节，一次性回写结果。它根据证据决定继续扩层、进入打磨，或在全量层通过后转入总验。${stateLogic}`],
  ['推进流总控/推进/打磨', `打磨负责把回归发现的失败收束为有根因、可验证、可返回当前层重试的改进。它不直接扩大范围，而是优先修复已暴露问题。${stateLogic}`],
  ['推进流总控/收尾/总验', `总验负责在全量层通过后，将成果、历史回归和遗留风险对照定向标准统一验证。Agent 汇总证据，人工检查是否具备裁定条件。${stateLogic}`],
  ['推进流总控/收尾/裁定', `裁定是人工对总验结果作出通过、退回或暂缓决定的最终把关点。退回时必须指定应返回的主干位置，而不是含糊地重做全部。${stateLogic}`],
  ['推进流总控/收尾/沉淀', `沉淀负责将已裁定的成果、适用边界和有证据的经验组织为可定位、可复用的资产。Agent 整理，人工决定哪些经验值得采纳。${stateLogic}`]
]);

async function command(source) {
  const response = await fetch('http://127.0.0.1:4784/__atom/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, interaction: { agent: { ref: 'resolved-by-service', path: '推进流总控' } } })
  });
  const payload = await response.json();
  assert.equal(response.ok && payload.ok && payload.result?.ok, true, JSON.stringify(payload));
  return payload.result;
}

for (const [path, guide] of guides) {
  const visibleGuide = guide.includes(stateLogic)
    ? `${stateLogic}\n${guide.replace(stateLogic, '').trim()}`
    : guide;
  guides.set(path, visibleGuide);
  await command(`transform {"name":${JSON.stringify(path)},${JSON.stringify(`detail.rep.${visibleGuide}`)}}`);
}
for (const [path, guide] of guides) {
  const result = await command(`explore {"name":${JSON.stringify(path)},"detail$full"}`);
  assert.equal(result.items?.[0]?.matches?.[0]?.detail, guide, path);
}
console.log(`主干定位说明已写入并回读：${guides.size} 个节点`);
