import assert from 'node:assert/strict';

const sharedStatus = '状态选项：未进入｜进行中｜待人工审核｜已通过｜已冻结｜退回。Program 仅将“已通过/已冻结”视为越过当前表；“已冻结”同时投射写锁。';

const guides = new Map([
  ['推进流总控', [
    '推进流总控是整条半自动流水线的入口。',
    '主干：设标（定向→调研→策评）→建标（建表→分层→分片）→推进（试点→回归→打磨）→收尾（总验→裁定→沉淀）。',
    '使用：先读“导航坐标”，进入同名主干表，按该表 detail 说明填写直接子字段，最后更新“状态”。',
    '人工负责方向、决定、审核、冻结/解冻；Agent 负责调研、结构化填写、执行、验证和回写。',
    sharedStatus
  ].join('\n')],
  ['推进流总控/设标/定向', [
    '填表目的：把原始意图收束为可验收的方向；人工主填，Agent 辅助整理。',
    '需求：为什么做及真实痛点。目标：要得到的结果。边界：范围、资源上限与不可违反项。达标：可观察的完成标准。',
    '完成判断：四个字段无关键歧义，且达标可以被验证。', sharedStatus
  ].join('\n')],
  ['推进流总控/设标/调研', [
    '填表目的：从定向目标出发，在高价值渠道中寻找并评估素材；Agent 主填，人工审核。',
    '目标：本轮要消除的未知。渠道：优先权威、一手及 GitHub 高星等高位来源。高价值素材：保存候选及引用。素材评估：从匹配度、成熟度、证据、成本、风险等维度研究。结论：回答目标并标注不确定性。',
    '完成判断：渠道足够可信，高价值素材已被多维评估，结论可支撑策评。', sharedStatus
  ].join('\n')],
  ['推进流总控/设标/策评', [
    '填表目的：同时形成方法和评估后果；Agent 提供脑暴与分析，人工决定。',
    '脑暴：可行方法组合。后果：每个方法的收益、成本、风险和可逆性。权衡：对照定向标准比较。决定：人工选定的方法及理由。',
    '完成判断：决定有调研证据支撑，已说明代价和退回条件。', sharedStatus
  ].join('\n')],
  ['推进流总控/建标/建表', [
    '填表目的：把策评方法编译为可执行表单；Agent 主建，人工检查。',
    '表单：需要哪些业务表。字段：每张表的必填输入和产出。引用：表之间如何传递事实。校验：如何判断字段完整和结果有效。',
    '完成判断：策评方法的关键输入、产出和验收均有载体。', sharedStatus
  ].join('\n')],
  ['推进流总控/建标/分层', [
    '填表目的：从低成本基础层逐步扩大到全量层；Agent 设计，人工检查。',
    '层序：各层先后。范围：本层覆盖多少。进入条件：上一层需满足什么。通过条件：本层何时允许扩大。',
    '完成判断：每层都有明确范围和递进门槛，不直接跳到全量。', sharedStatus
  ].join('\n')],
  ['推进流总控/建标/分片', [
    '填表目的：定义由脚本生成真实分片的划分法；Agent 主建，人工检查。',
    '划分规则：按什么维度拆分。生成脚本：调用哪个预定义自动化。粒度：单片大小上限。完成条件：单片交验要求。',
    '完成判断：脚本能重复生成当前层分片，分片依赖由建表引用和校验统一承载。', sharedStatus
  ].join('\n')],
  ['推进流总控/推进/试点', [
    '填表目的：总控派发当前层分片，下级 Agent 领片执行并一次性回执。',
    '当前层：本轮所在层。派发：分片、执行方、输入和验收要求。下级回执：产出、证据、问题和资源消耗。',
    '完成判断：当前层应执行分片均有可审核回执。', sharedStatus
  ].join('\n')],
  ['推进流总控/推进/回归', [
    '填表目的：总控对当前分片统一审核验收；Agent 主审，必要时人工把关。',
    '总控审核：检查回执完整性。验收：按建表校验和定向达标验证。审核结果：一次性写回当前分片。升层结论：依分层条件决定扩层、打磨或进总验。',
    '完成判断：审核结果已回写，下一路由唯一且有证据。', sharedStatus
  ].join('\n')],
  ['推进流总控/推进/打磨', [
    '填表目的：把回归发现的问题收束为可验证改进；Agent 主填。',
    '问题：失败现象和证据。根因：与现象区分的原因判断。改进：要修改的方法、表或执行。重试：返回当前层试点的条件。',
    '完成判断：根因有证据，改进可回归，重试范围明确。', sharedStatus
  ].join('\n')],
  ['推进流总控/收尾/总验', [
    '填表目的：全量层通过后汇总整体验收；Agent 汇总，人工检查。',
    '成果：全部已交付范围。回归：各层及历史基线验证汇总。风险：遗留问题与适用边界。结论：是否满足定向达标。',
    '完成判断：全部层级和分片已完成，结论可提交人工裁定。', sharedStatus
  ].join('\n')],
  ['推进流总控/收尾/裁定', [
    '填表目的：由人工对总验作最终决定。',
    '结论：通过、退回或暂缓。理由：引用总验证据。冻结：确认锁定的范围。退回：指定返回的主干节点及条件。',
    '完成判断：结论、理由和后续路由一致，并由人工确认。', sharedStatus
  ].join('\n')],
  ['推进流总控/收尾/沉淀', [
    '填表目的：保存可复用成果和有证据的经验；Agent 整理，人工决定是否采纳。',
    '成果：最终交付物。边界：适用条件与不适用场景。经验：有回归证据支持的经验候选。归档：成果、证据和决定的引用。',
    '完成判断：成果可定位，边界清楚，经验没有脱离证据。', sharedStatus
  ].join('\n')]
]);

async function command(source) {
  const response = await fetch('http://127.0.0.1:4784/__atom/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source,
      interaction: { agent: { ref: 'resolved-by-service', path: '推进流总控' } }
    })
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.result?.ok, true, JSON.stringify(payload.result));
  return payload.result;
}

for (const [path, guide] of guides) {
  assert.equal(guide.includes('.rep.'), false, `Guide conflicts with Transform marker: ${path}`);
  await command(`transform {"name":${JSON.stringify(path)},${JSON.stringify(`detail.rep.${guide}`)}}`);
}

for (const [path, guide] of guides) {
  const result = await command(`explore {"name":${JSON.stringify(path)},"detail$full"}`);
  assert.equal(result.items?.[0]?.matches?.[0]?.detail, guide, path);
}

console.log(`推进流填表说明已写入并回读验证：${guides.size} 个节点`);
