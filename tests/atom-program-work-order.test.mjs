import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

async function runProgram(source, world = [], programChildren = []) {
  return createProgramRuntimeScheduler().refresh([
    ...world,
    atom('工单函数验收', source, programChildren, 'program')
  ]);
}

function workOrder(name = '现有工单', status = '待执行', overrides = {}) {
  const root = {
    template: 'work-order', templateVersion: '1', creationId: 'existing', status,
    状态: { 定义: '整张工单状态', 当前: status, 可选值: ['待执行', '执行中', '待验收', '已通过', '已驳回', '已暂缓'] },
    修订记录: []
  };
  const details = {
    Output: {
      定义: '要求交付的成果',
      交付物: { 名称: null, 接收方: null, 成果引用: null, 版本: null }
    },
    Step: {
      定义: '实际作业步骤',
      操作: { 定义: '局部执行事实', 状态: '未开始', 实际动作: [], 实际产出: [], 异常: [] }
    },
    Criteria: {
      定义: '验收要求和结果',
      要求: { 定义: '事前条件', 条件: [], 边界: [] },
      验收: {
        提交: { 成果引用: null, 版本: null, 提交时间: null },
        审核: { 结论: null, 意见: [], 审核人: null, 审核时间: null },
        驳回: { 返回: 'Step', 原因: [] }
      }
    }
  };
  for (const [group, value] of Object.entries(overrides)) details[group] = value;
  return atom(name, JSON.stringify(root), [
    atom('Output', JSON.stringify(details.Output)),
    atom('Step', JSON.stringify(details.Step)),
    atom('Criteria', JSON.stringify(details.Criteria))
  ]);
}

function programFor(action) {
  return [
    `result = work_order(${JSON.stringify(action)})`,
    "message({'level': 'info', 'text': str(result)})"
  ].join('\n');
}

function transformedDetail(item) {
  if (typeof item['detail$replace'] === 'string') {
    return JSON.parse(item['detail$replace']);
  }
  const key = Object.keys(item).find((name) => name.startsWith('detail.rep.'));
  assert.ok(key, `missing full detail replacement: ${JSON.stringify(item)}`);
  assert.equal(item[key], null);
  return JSON.parse(key.slice('detail.rep.'.length));
}

test('form compiles only the four authoritative Graph axes', async () => {
  const cycle = await runProgram([
    "compiled = form({'name': '最小单', 'detail': '说明', 'children': [{'name': '内容'}], 'partners': []})",
    "message({'level': 'info', 'text': ','.join(sorted(compiled.keys()))})"
  ].join('\n'));

  assert.equal(cycle.messages[0].text, 'children,detail,name,partners');

  await assert.rejects(
    runProgram("form({'name': '错误单', 'fields': []})"),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && /unsupported Graph axes/i.test(error?.message ?? '')
  );
});

test('work_order creates one versioned Graph-native instance with exactly three groups', async () => {
  const cycle = await runProgram([
    "result = work_order({'action': 'create', 'title': 'ESG计划', 'creation_id': 'esg-2026', 'version': '1'})",
    "message({'level': 'info', 'text': result['template'] + '@' + result['version']})"
  ].join('\n'));

  assert.equal(cycle.transforms.length, 1);
  const [instance] = cycle.transforms[0].children;
  assert.equal(instance.name, 'ESG计划');
  assert.deepEqual(instance.children.map((child) => child.name), ['Output', 'Step', 'Criteria']);
  assert.deepEqual(instance.children.map((child) => child.partners), [
    [{ verb: '提交验收', object: 'Criteria' }],
    [{ verb: '产出', object: 'Output' }],
    [
      { verb: '约束', object: 'Step' },
      { verb: '驳回返工', object: 'Step' }
    ]
  ]);
  assert.equal(JSON.parse(instance.detail).template, 'work-order');
  assert.equal(JSON.parse(instance.detail).templateVersion, '1');
  assert.equal(JSON.parse(instance.detail).creationId, 'esg-2026');
  const [output, step, criteria] = instance.children.map((item) => JSON.parse(item.detail));
  assert.deepEqual(Object.keys(output.交付物), ['名称', '接收方', '成果引用', '版本']);
  assert.deepEqual(Object.keys(step.操作), ['定义', '状态', '实际动作', '实际产出', '异常']);
  assert.deepEqual(Object.keys(criteria.要求), ['定义', '条件', '边界']);
  assert.deepEqual(Object.keys(criteria.验收), ['定义', '提交', '审核', '驳回']);
  assert.equal(cycle.messages[0].text, 'work-order@1');
});

test('work_order rejects unsupported versions and unsupported dispatch without effects', async () => {
  for (const [source, expectedMessage] of [
    ["work_order({'action': 'create', 'title': '未固定版本', 'creation_id': 'missing-version'})", /requires an exact version/i],
    ["work_order({'action': 'create', 'title': '错误版本', 'creation_id': 'bad', 'version': '2'})", /unsupported work-order version 2/i],
    ["work_order({'action': 'dispatch', 'path': '工单'})", /unsupported work-order action dispatch/i]
  ]) {
    await assert.rejects(
      runProgram(source),
      (error) => error?.code === 'ATOM_PROGRAM_FAILED'
        && expectedMessage.test(error?.message ?? '')
    );
  }

  await assert.rejects(
    runProgram("work_order({'action': 'validate', 'paths': ['工单甲', '工单乙']})"),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && /unknown work_order\.validate options: paths/i.test(error?.message ?? '')
  );
});

test('work_order create is idempotent by stable creation identity and rejects identity drift', async () => {
  const existing = atom('ESG计划', JSON.stringify({
    template: 'work-order', templateVersion: '1', creationId: 'esg-2026', status: '待执行'
  }), [atom('Output'), atom('Step'), atom('Criteria')]);

  const repeated = await runProgram([
    "result = work_order({'action': 'create', 'title': 'ESG计划', 'creation_id': 'esg-2026', 'version': '1'})",
    "message({'level': 'info', 'text': str(result['created'])})"
  ].join('\n'), [], [existing]);
  assert.deepEqual(repeated.transforms, []);
  assert.equal(repeated.messages[0].text, 'False');

  await assert.rejects(
    runProgram("work_order({'action': 'create', 'title': '另一个标题', 'creation_id': 'esg-2026', 'version': '1'})", [], [existing]),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && /creation identity.*already belongs to ESG计划/i.test(error?.message ?? '')
  );
});

test('work_order validation reports the exact incomplete group paths and emits no write', async () => {
  const world = [atom('现有工单', JSON.stringify({
    template: 'work-order', templateVersion: '1', creationId: 'existing', status: '执行中'
  }), [
    atom('Output', JSON.stringify({ requestedResult: '' })),
    atom('Step', JSON.stringify({ evidence: '' })),
    atom('Criteria', JSON.stringify({ acceptanceRules: '' }))
  ])];
  const cycle = await runProgram([
    "result = work_order({'action': 'validate', 'path': '现有工单'})",
    "message({'level': 'info', 'text': '|'.join(result['missing'])})"
  ].join('\n'), world);

  assert.deepEqual(cycle.transforms, []);
  assert.equal(cycle.messages[0].text, '现有工单/Output|现有工单/Step|现有工单/Criteria');
});

test('work_order fill merges declared group values, preserves guidance, and coordinates root status', async () => {
  const cycle = await runProgram(programFor({
    action: 'fill', path: '现有工单', values: {
      Output: { 交付物: { 名称: 'ESG报告', 成果引用: 'doc://esg', 版本: 'v1' } },
      Step: { 操作: { 状态: '已完成', 实际动作: ['汇总'], 实际产出: ['doc://esg'] } },
      Criteria: { 要求: { 条件: ['指标完整'] } }
    }
  }), [workOrder()]);

  assert.equal(cycle.transforms.length, 4);
  const byName = new Map(cycle.transforms.map((item) => [item.name, item]));
  const output = transformedDetail(byName.get('现有工单/Output'));
  const step = transformedDetail(byName.get('现有工单/Step'));
  const criteria = transformedDetail(byName.get('现有工单/Criteria'));
  const root = transformedDetail(byName.get('现有工单'));
  assert.equal(output.定义, '要求交付的成果');
  assert.equal(output.交付物.接收方, null);
  assert.equal(output.交付物.成果引用, 'doc://esg');
  assert.deepEqual(step.操作.实际产出, ['doc://esg']);
  assert.deepEqual(criteria.要求.条件, ['指标完整']);
  assert.equal(root.status, '执行中');
  assert.equal(root.状态.当前, '执行中');
});

test('work_order fill rejects unknown group content before emitting any effect', async () => {
  await assert.rejects(
    runProgram(programFor({
      action: 'fill', path: '现有工单', values: { Output: { fields: ['旁路'] } }
    }), [workOrder()]),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && /unknown Output field: fields/i.test(error?.message ?? '')
  );
});

test('work_order submit refuses incomplete instances and submits complete outcomes atomically', async () => {
  const incomplete = await runProgram(programFor({ action: 'submit', path: '现有工单' }), [workOrder()]);
  assert.deepEqual(incomplete.transforms, []);
  assert.match(incomplete.messages[0].text, /现有工单\/Output.*现有工单\/Step.*现有工单\/Criteria/u);

  const complete = workOrder('现有工单', '执行中', {
    Output: { 定义: '要求交付的成果', 交付物: { 名称: 'ESG报告', 接收方: '委员会', 成果引用: 'doc://esg', 版本: 'v1' } },
    Step: { 定义: '实际作业步骤', 操作: { 定义: '局部执行事实', 状态: '已完成', 实际动作: ['汇总'], 实际产出: ['doc://esg'], 异常: [] } },
    Criteria: { 定义: '验收要求和结果', 要求: { 定义: '事前条件', 条件: ['指标完整'], 边界: [] }, 验收: { 提交: { 成果引用: null, 版本: null, 提交时间: null }, 审核: { 结论: null, 意见: [], 审核人: null, 审核时间: null }, 驳回: { 返回: 'Step', 原因: [] } } }
  });
  const submitted = await runProgram(programFor({ action: 'submit', path: '现有工单', submitted_at: '2026-08-20T10:00:00Z' }), [complete]);
  assert.equal(submitted.transforms.length, 2);
  const byName = new Map(submitted.transforms.map((item) => [item.name, item]));
  assert.equal(transformedDetail(byName.get('现有工单')).status, '待验收');
  assert.deepEqual(transformedDetail(byName.get('现有工单/Criteria')).验收.提交, {
    成果引用: 'doc://esg', 版本: 'v1', 提交时间: '2026-08-20T10:00:00Z'
  });
});

test('work_order submit records a passing Criteria outcome and closes a pending order', async () => {
  const pending = workOrder('现有工单', '待验收', {
    Output: { 定义: '要求交付的成果', 交付物: { 名称: 'ESG报告', 接收方: '委员会', 成果引用: 'doc://esg', 版本: 'v1' } },
    Step: { 定义: '实际作业步骤', 操作: { 定义: '局部执行事实', 状态: '已完成', 实际动作: ['汇总'], 实际产出: ['doc://esg'], 异常: [] } },
    Criteria: { 定义: '验收要求和结果', 要求: { 定义: '事前条件', 条件: ['指标完整'], 边界: [] }, 验收: { 提交: { 成果引用: 'doc://esg', 版本: 'v1', 提交时间: '2026-08-20T10:00:00Z' }, 审核: { 结论: null, 意见: [], 审核人: null, 审核时间: null }, 驳回: { 返回: 'Step', 原因: [] } } }
  });
  const cycle = await runProgram(programFor({
    action: 'submit', path: '现有工单', decision: '通过', reviewer: '审核人', reviewed_at: '2026-08-20T12:00:00Z'
  }), [pending]);

  assert.equal(cycle.transforms.length, 2);
  const byName = new Map(cycle.transforms.map((item) => [item.name, item]));
  assert.equal(transformedDetail(byName.get('现有工单')).status, '已通过');
  assert.deepEqual(transformedDetail(byName.get('现有工单/Criteria')).验收.审核, {
    结论: '通过', 意见: [], 审核人: '审核人', 审核时间: '2026-08-20T12:00:00Z'
  });
});

test('work_order reject and revise preserve responsible-node facts and enforce lifecycle states', async () => {
  const pending = workOrder('现有工单', '待验收');
  const rejected = await runProgram(programFor({
    action: 'reject', path: '现有工单', reasons: ['缺少签章'], reviewer: '审核人', reviewed_at: '2026-08-20T11:00:00Z'
  }), [pending]);
  assert.equal(rejected.transforms.length, 2);
  const rejectedByName = new Map(rejected.transforms.map((item) => [item.name, item]));
  assert.equal(transformedDetail(rejectedByName.get('现有工单')).status, '已驳回');
  const rejectedCriteria = transformedDetail(rejectedByName.get('现有工单/Criteria'));
  assert.equal(rejectedCriteria.验收.审核.结论, '驳回');
  assert.deepEqual(rejectedCriteria.验收.驳回.原因, ['缺少签章']);

  const revised = await runProgram(programFor({
    action: 'revise', path: '现有工单', note: '补充签章', values: {
      Step: { 操作: { 状态: '已完成', 实际动作: ['补充签章'], 实际产出: ['doc://signed'] } }
    }
  }), [workOrder('现有工单', '已驳回')]);
  assert.equal(revised.transforms.length, 2);
  const revisedByName = new Map(revised.transforms.map((item) => [item.name, item]));
  const revisedRoot = transformedDetail(revisedByName.get('现有工单'));
  assert.equal(revisedRoot.status, '执行中');
  assert.equal(revisedRoot.修订记录.at(-1).说明, '补充签章');
  assert.deepEqual(transformedDetail(revisedByName.get('现有工单/Step')).操作.实际产出, ['doc://signed']);
});

test('work_order read-back exposes current guidance and actions without emitting writes or source', async () => {
  const cycle = await runProgram([
    "result = work_order({'action': 'read-back', 'path': '现有工单'})",
    "message({'level': 'info', 'text': result['status'] + '|' + '|'.join(result['available_actions']) + '|' + '|'.join(result['missing'])})",
    "message({'level': 'info', 'text': ','.join(sorted(result.keys()))})"
  ].join('\n'), [workOrder()]);

  assert.deepEqual(cycle.transforms, []);
  assert.equal(cycle.messages[0].text, '待执行|fill|validate|read-back|现有工单/Output|现有工单/Step|现有工单/Criteria');
  assert.equal(cycle.messages[1].text, 'available_actions,guidance,missing,path,status,template,valid,values,version');
});
