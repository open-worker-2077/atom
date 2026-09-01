import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

async function runProgram(source, world = []) {
  const scheduler = createProgramRuntimeScheduler();
  return scheduler.refresh([...world, atom('原子函数验收', source, [], 'program')]);
}

test('Program form helpers read direct fields and report missing details', async () => {
  const world = [atom('推进流', '', [
    atom('定向', '', [atom('目标', '交付可验证结果'), atom('边界', '   '), atom('状态', '进行中')])
  ])];
  const cycle = await runProgram([
    "rows = explore({'thing': '推进流/定向', 'slot$latitude-1': None, 'situation$full': None})",
    "field_count = len(direct_children(rows, '推进流/定向'))",
    "missing = missing_details(rows, '推进流/定向', ['目标', '边界', '完成标准'])",
    "message({'level': 'info', 'text': str(field_count) + '|' + child_detail(rows, '推进流/定向', '目标') + '|' + form_status(rows, '推进流/定向') + '|' + ','.join(missing)})"
  ].join('\n'), world);

  assert.equal(cycle.messages[0].text, '3|交付可验证结果|进行中|边界,完成标准');
});

test('Program routing helpers choose the first unfinished form and validate transitions', async () => {
  const cycle = await runProgram([
    "forms = [('定向', '已通过'), ('调研', '进行中'), ('策评', '未进入')]",
    "pending = first_pending(forms, ['已通过', '已冻结'])",
    "rules = {'未进入': ['进行中'], '进行中': ['已提交']} ",
    "allowed = transition_allowed('未进入', '进行中', rules)",
    "blocked = transition_allowed('未进入', '已通过', rules)",
    "message({'level': 'info', 'text': pending[0] + '|' + str(allowed) + '|' + str(blocked)})"
  ].join('\n'));

  assert.equal(cycle.messages[0].text, '调研|True|False');
});

test('Program JSON codecs parse strict JSON and stringify compact or indented Unicode JSON', async () => {
  const cycle = await runProgram([
    'value = json_parse({"text": "{\\"name\\":\\"中文\\",\\"items\\":[1,true,null]}"})',
    'compact = json_stringify({"value": value})',
    'pretty = json_stringify({"value": value, "indent": 2})',
    'scalar = json_parse({"text": "42"})',
    'message({"level": "info", "text": compact + "|" + str(scalar) + "|" + pretty})'
  ].join('\n'));

  assert.equal(
    cycle.messages[0].text,
    '{"name":"中文","items":[1,true,null]}|42|{\n  "name": "中文",\n  "items": [\n    1,\n    true,\n    null\n  ]\n}'
  );
});

test('Program JSON codecs reject non-standard input, unknown options, and non-JSON values', async () => {
  for (const source of [
    'json_parse({"text": "{\\"value\\": NaN}"})',
    'json_parse({"text": "1e400"})',
    'json_parse({"text": "-1e400"})',
    'json_parse({"text": "{\\"truncated\\":"})',
    'json_parse({"text": "{\\"trailing\\": true,}"})',
    'json_parse({"text": "{}", "extra": true})',
    'json_stringify({"value": float("nan")})',
    'json_stringify({"value": {1: "not-a-json-key"}})',
    'json_stringify({"value": ("tuple",)})',
    'json_stringify({"value": [], "indent": true})',
    'json_stringify({"value": [], "indent": 9})',
    'json_stringify({"value": [], "extra": true})',
    'value = []\nvalue.append(value)\njson_stringify({"value": value})'
  ]) {
    await assert.rejects(runProgram(source), { code: 'ATOM_PROGRAM_FAILED' });
  }
});

test('Program JSON transport rejects non-finite effect data without terminating the test runtime', async () => {
  await assert.rejects(runProgram([
    'message({"level": "info", "text": "unsafe", "data": {"value": float("inf")}})'
  ].join('\n')), { code: 'ATOM_PROGRAM_FAILED' });

  const healthy = await runProgram([
    'value = json_stringify({"value": 1.5, "indent": 0})',
    'round_trip = json_parse({"text": value})',
    'message({"level": "info", "text": str(round_trip)})'
  ].join('\n'));
  assert.equal(healthy.messages[0].text, '1.5');
});

test('Program choice registers one multi-select control and returns its selected values', async () => {
  const cycle = await runProgram([
    "selected = choice({'id': '状态', 'options': [{'id': 'todo', 'label': '待办'}, {'id': 'done', 'label': '完成'}], 'selected': ['todo'], 'empty': '未选择'})",
    "message({'level': 'info', 'text': ','.join(selected)})"
  ].join('\n'));

  assert.equal(cycle.messages[0].text, 'todo');
  assert.deepEqual(cycle.choices, [{
    id: '状态',
    options: [
      { id: 'todo', label: '待办' },
      { id: 'done', label: '完成' }
    ],
    selected: ['todo'],
    empty: '未选择',
    multiple: true,
    sourceProgramPath: '原子函数验收'
  }]);
});

test('Program choice rejects duplicate options and unknown selected values', async () => {
  for (const [source, code] of [
    ["choice({'id': '状态', 'options': [{'id': 'same', 'label': 'A'}, {'id': 'same', 'label': 'B'}]})", 'INVALID_PROGRAM_CHOICE_OPTION'],
    ["choice({'id': '状态', 'options': [{'id': 'todo', 'label': '待办'}], 'selected': ['missing']})", 'INVALID_PROGRAM_CHOICE_SELECTED'],
    ["choice({'id': '状态', 'options': [{'id': 'todo', 'label': '待办'}], 'multiple': False})", 'UNSUPPORTED_PROGRAM_CHOICE_MODE']
  ]) {
    await assert.rejects(runProgram(source), { code });
  }
});

test('Program subtree_refs selects only the requested subtree', async () => {
  const world = [atom('世界', '', [
    atom('当前层', '', [atom('分片A'), atom('分片B')]),
    atom('其他层', '', [atom('分片C')])
  ])];
  const cycle = await runProgram([
    "rows = explore({'thing': '世界', 'slot$latitude-2': None})",
    "refs = subtree_refs(rows, '世界/当前层')",
    "lock({'targets': {'refs': refs}, 'mode': 'write', 'fields': ['situation'], 'protect': {'atom': True, 'messages': False}})"
  ].join('\n'), world);

  assert.equal(cycle.locks[0].targets.refs.length, 3);
});

test('Program shard planner supports per-item and fixed-size deterministic plans', async () => {
  const world = [atom('来源', '', [atom('A'), atom('B'), atom('C'), atom('D'), atom('E')])];
  const cycle = await runProgram([
    "rows = explore({'thing': '来源', 'slot$latitude-1': None})",
    "items = [row for row in rows if row.path != '来源']",
    "each = plan_shards(items, {'mode': 'each', 'name_prefix': '片'})",
    "fixed = plan_shards(items, {'mode': 'fixed_size', 'size': 2, 'name_prefix': '批'})",
    "message({'level': 'info', 'text': str(len(each)) + '|' + ','.join([shard['name'] for shard in fixed]) + '|' + str(len(fixed[2]['source_refs']))})"
  ].join('\n'), world);

  assert.equal(cycle.messages[0].text, '5|批01,批02,批03|1');
});

test('Program shard planner rejects invalid specifications and accepts empty sources', async () => {
  const empty = await runProgram([
    "plan = plan_shards([], {'mode': 'fixed_size', 'size': 3})",
    "message({'level': 'info', 'text': str(len(plan))})"
  ].join('\n'));
  assert.equal(empty.messages[0].text, '0');

  await assert.rejects(runProgram("plan_shards([], {'mode': 'unknown'})"), {
    code: 'ATOM_PROGRAM_FAILED'
  });
});

test('Program form-flow planner creates complete missing forms without overwriting existing content', async () => {
  const world = [atom('任务流', '', [
    atom('定向', '人工已修订的说明', [atom('目标', '已填写')])
  ])];
  const cycle = await runProgram([
    "rows = explore({'thing': '任务流', 'slot$latitude-2': None, 'situation$full': None})",
    "standard = {'forms': [",
    "    {'thing': '定向', 'situation': '标准说明', 'status': '未进入', 'fields': ['目标', '边界']},",
    "    {'thing': '调研', 'situation': '调研说明', 'status': '未进入', 'fields': ['渠道'], 'strut': [{'if@current': True, 'then': [{'thing': '策评'}]}]}",
    "]}",
    "plan = plan_form_flow(rows, '任务流', standard)",
    "if plan['slot']:",
    "    transform({'thing': '任务流', 'slot': plan['slot']})",
    "message({'level': 'info', 'text': str(len(plan['slot'])) + '|' + ','.join(plan['conflicts'])})"
  ].join('\n'), world);

  assert.equal(cycle.transforms.length, 1);
  const [directionPatch, researchForm] = cycle.transforms[0].slot;
  assert.deepEqual(directionPatch, {
    thing: '定向',
    slot: [
      { thing: '状态', situation: '未进入', slot: [], strut: [] },
      { thing: '边界', situation: '', slot: [], strut: [] }
    ]
  });
  assert.equal(researchForm.thing, '调研');
  assert.equal(researchForm.slot[0].thing, '状态');
  assert.equal(researchForm.slot[1].thing, '渠道');
  assert.deepEqual(researchForm.strut, [{ 'if@current': true, then: [{ thing: '策评' }] }]);
  assert.equal(cycle.messages[0].text, '2|任务流/定向:situation');
});

test('Program form-flow planner is a no-op when the generated structure already exists', async () => {
  const world = [atom('任务流', '', [
    atom('定向', '说明', [atom('状态', '未进入'), atom('目标')])
  ])];
  const cycle = await runProgram([
    "rows = explore({'thing': '任务流', 'slot$latitude-2': None, 'situation$full': None})",
    "plan = plan_form_flow(rows, '任务流', {'forms': [{'thing': '定向', 'situation': '说明', 'status': '未进入', 'fields': ['目标']}]})",
    "if plan['slot']:",
    "    transform({'thing': '任务流', 'slot': plan['slot']})",
    "message({'level': 'info', 'text': str(plan['complete'])})"
  ].join('\n'), world);

  assert.equal(cycle.transforms.length, 0);
  assert.equal(cycle.messages[0].text, 'True');
});

test('Program form-flow planner rejects duplicate form and field names', async () => {
  for (const standard of [
    "{'forms': [{'thing': '定向', 'fields': []}, {'thing': '定向', 'fields': []}]}",
    "{'forms': [{'thing': '定向', 'fields': ['目标', '目标']}]}",
    "{'forms': [{'thing': '定向', 'fields': ['状态']}]}",
  ]) {
    await assert.rejects(runProgram(`plan_form_flow([], '任务流', ${standard})`), {
      code: 'ATOM_PROGRAM_FAILED'
    });
  }
});

test('Program form-flow planner reports an existing route mismatch without resetting runtime status', async () => {
  const existingForm = atom('定向', '说明', [atom('状态', '进行中'), atom('目标')]);
  existingForm.strut = [{ 'if@current': true, then: [{ thing: '旧节点' }] }];
  const world = [atom('任务流', '', [existingForm])];
  const cycle = await runProgram([
    "rows = explore({'thing': '任务流', 'slot$latitude-2': None, 'situation$full': None})",
    "standard = {'forms': [{'thing': '定向', 'situation': '说明', 'status': '未进入', 'fields': ['目标'], 'strut': [{'if@current': True, 'then': [{'thing': '调研'}]}]}]}",
    "plan = plan_form_flow(rows, '任务流', standard)",
    "message({'level': 'warning', 'text': ','.join(plan['conflicts']) + '|' + str(len(plan['slot']))})"
  ].join('\n'), world);

  assert.equal(cycle.messages[0].text, '任务流/定向:strut|0');
});

test('Program template planner creates one typed nested instance and then becomes a no-op', async () => {
  const template = "{'thing': '推进流', 'situation': '任务推进入口', 'slot': [{'thing': '定向', 'situation': '填写方向'}, {'thing': '路由', 'types': ['program'], 'situation': \"message({'level': 'info', 'text': '路由已运行'})\"}]}";
  const missing = await runProgram([
    `plan = plan_template_instance([], '项目A', ${template})`,
    "transform({'thing': '项目A', 'slot': plan['slot']})",
    "message({'level': 'info', 'text': plan['slot'][0]['slot'][1]['thing@program']})"
  ].join('\n'), [atom('项目A')]);
  assert.equal(missing.transforms[0].slot[0].thing, '推进流');
  assert.equal(missing.transforms[0].slot[0].slot[1]['thing@program'], '路由');
  assert.equal(missing.messages[0].text, '路由');

  const existingRowsWorld = [atom('项目A', '', [atom('推进流')])];
  const existing = await runProgram([
    "rows = explore({'thing': '项目A', 'slot$latitude-1': None})",
    `plan = plan_template_instance(rows, '项目A', ${template})`,
    "message({'level': 'info', 'text': str(plan['exists']) + '|' + str(len(plan['slot']))})"
  ].join('\n'), existingRowsWorld);
  assert.equal(existing.messages[0].text, 'True|0');
});
