import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

test('external transform refreshes Python Program, emits message, and rejects a condition-filtered locked write', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-e2e-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const world = [
    atom('推进流', '', [
      atom('任务A', '原文', [atom('状态', '已人工冻结')]),
      atom('任务B', '原文', [atom('状态', '执行中')])
    ]),
    atom('冻结程序', [
      "nodes = explore({'name': '推进流', 'children$latitude-2': None, 'detail$full': None})",
      "approved = [node for node in nodes if node.name != '状态' and any(s.name == '状态' and s.detail == '已人工冻结' for s in explore({'name': node.path, 'children$latitude-1': None, 'detail$full': None}))]",
      "if approved:",
      "    lock({'targets': {'refs': [node.ref for node in approved]}, 'mode': 'write', 'fields': ['detail'], 'protect': {'atom': True, 'messages': False}})",
      "    message({'level': 'info', 'text': f'已冻结{len(approved)}个任务'})"
    ].join('\n'), [], 'program')
  ];
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const denied = await executeAtomLanguage({
    source: 'transform {"name":"推进流/任务A","detail.rep.篡改"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED');
  assert.equal(denied.messages[0].text, '已冻结1个任务');

  const allowed = await executeAtomLanguage({
    source: 'transform {"name":"推进流/任务B","detail.rep.可修改"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.changed, true);
  assert.equal(allowed.messages[0].text, '已冻结1个任务');
});

test('Program transform uses the normal Transform executor and is persisted before an external explore', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-transform-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('汇总值', '0'),
    atom('计算程序', [
      "target = explore({'name': '汇总值', 'detail$full': None})[0]",
      "if target.detail != '42':",
      "    transform({'name': '汇总值', 'detail.rep.42': None})",
      "    message({'level': 'info', 'text': '已写入汇总值'})"
    ].join('\n'), [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'explore {"name":"汇总值","detail$full"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.items[0].matches[0].detail, '42');
  assert.deepEqual(result.messages, [], 'query receipts do not publish background Program messages');
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(persisted[0].detail, '42');
});

test('explicit Program run creates a nested four-axis Atom and leaves assignment as None', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('test'),
    atom('Creator', [
      "result = transform({'name': 'test/Created', 'detail': '{\"probe\":true}', 'children': [], 'partners': []})",
      "message({'level': 'info', 'text': str(result)})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'transform {"name.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, true);
  assert.equal(result.messages.some((message) => message.text === 'None'), true);
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(persisted[0].children[0].name, 'Created');
  assert.equal(persisted[0].children[0].detail, '{"probe":true}');
});

test('Program creation rejects a missing parent without persisting a partial Atom', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-missing-parent-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Creator', "transform({'name': 'missing/Created', 'detail': '', 'children': [], 'partners': []})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"name.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false);
  assert.equal(result.warnings[0].code, 'PROGRAM_TRANSFORM_REJECTED');
  assert.equal(result.warnings[0].cause, 'ATOM_NOT_FOUND');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8')).length, 1);
});

test('Program creation rejects a duplicate exact target without overwriting it', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-duplicate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('test', '', [atom('Created', 'original')]),
    atom('Creator', "transform({'name': 'test/Created', 'detail': 'replacement', 'children': [], 'partners': []})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"name.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false);
  assert.equal(result.warnings[0].code, 'PROGRAM_TRANSFORM_REJECTED');
  assert.equal(result.warnings[0].cause, 'DUPLICATE_ATOM_NAME');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].children[0].detail, 'original');
});

test('explore keeps Program computation active without leaking unrelated Program failures into its receipt', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-explore-feedback-scope-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Target', 'before'),
    atom('Working Program', [
      "target = explore({'name': 'Target', 'detail$full': None})[0]",
      "if target.detail != 'after':",
      "    transform({'name': 'Target', 'detail.rep.after': None})"
    ].join('\n'), [], 'program'),
    atom('Unrelated Broken Program', "raise ValueError('unrelated failure')", [], 'program'),
    atom('Unrelated Reporting Program', "message({'level': 'info', 'text': 'background message'})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'explore {"name":"Target","detail$full"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].detail, 'after', 'Program computation remains active');
  assert.deepEqual(result.warnings, [], 'background diagnostics do not masquerade as query feedback');
  assert.deepEqual(result.messages, [], 'background messages do not masquerade as query feedback');

  const diagnostic = await executeAtomLanguage({
    source: 'explore {"name":"Unrelated Broken Program"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(diagnostic.warnings[0].program, 'Unrelated Broken Program', 'a queried Program keeps its own diagnostic');

  const report = await executeAtomLanguage({
    source: 'explore {"name":"Unrelated Reporting Program"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(report.messages[0].text, 'background message', 'a queried Program keeps its own message');
});

test('a name-only Program lock permits detail edits but denies rename', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-field-lock-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('任务A', '原文'),
    atom('名称锁', [
      "target = explore({'name': '任务A'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['name']})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const edit = await executeAtomLanguage({
    source: 'transform {"name":"任务A","detail.rep.新文"}', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(edit.ok, true);

  const rename = await executeAtomLanguage({
    source: 'transform {"name.ren.新名":"任务A"}', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(rename.ok, false);
  assert.equal(rename.errors[0].code, 'PROGRAM_LOCK_DENIED');
});

test('explore returns the applicable write-lock summary before an Agent attempts a change', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-lock-summary-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('框架', '说明'),
    atom('框架锁', [
      "target = explore({'name': '框架'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['name', 'detail'], 'reason': {'code': 'FRAMEWORK_SCHEMA', 'message': '框架名称与说明由模板维护'}})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'explore {"name":"框架","detail$full"}',
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items[0].matches[0].lockState.writeFields, ['detail', 'name']);
  assert.equal(result.items[0].matches[0].lockState.reasons[0].code, 'FRAMEWORK_SCHEMA');
});

test('Program messages are hidden only by explicit message protection', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-message-lock-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('自保护程序', [
      "me = current_atom()",
      "lock({'targets': {'refs': [me.ref]}, 'mode': 'read_write', 'fields': ['messages'], 'protect': {'atom': False, 'messages': True}})",
      "message({'level': 'info', 'text': '不应显示'})"
    ].join('\n'), [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, []);
  assert.equal(result.atomCount, 1, '只保护消息不应隐藏Program Atom本身');
});

test('a transform that satisfies a lock condition refreshes Programs before returning', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-immediate-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('任务', '原文', [atom('状态', '未冻结')]),
    atom('冻结器', [
      "rows = explore({'name': '任务', 'children$latitude-1': None, 'detail$full': None})",
      "if any(row.path == '任务/状态' and row.detail == '已冻结' for row in rows):",
      "    lock({'targets': {'refs': [row.ref for row in rows]}, 'mode': 'write', 'fields': ['name', 'detail'], 'reason': {'code': 'MANUAL_FREEZE', 'message': '任务已人工冻结'}})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const frozen = await executeAtomLanguage({
    source: 'transform {"name":"任务/状态","detail.rep.已冻结"}',
    contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(frozen.ok, true);

  const denied = await executeAtomLanguage({
    source: 'transform {"name":"任务","detail.rep.不应写入"}',
    contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED');
  assert.match(denied.errors[0].message, /任务已人工冻结/u);
  assert.match(denied.errors[0].message, /submit/u);
});

test('a Program cannot rename a locked target in the same stale-ref cycle', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-stale-lock-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('目标', '原文'),
    atom('结构程序', [
      "target = explore({'name': '目标'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['name']})",
      "transform({'name.ren.新目标': '目标'})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings[0].code, 'PROGRAM_TRANSFORM_REJECTED');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].name, '目标');
});

test('transform new reports Program lock denial instead of an undefined decision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-lock-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('已有目标', '原文'),
    atom('创建锁', [
      "target = explore({'name': '已有目标'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['name', 'detail', 'children', 'partners']})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'transform new {"name":"已有目标","detail":"","children":[],"partners":[]}',
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'PROGRAM_LOCK_DENIED');
});

test('renaming an Agent ignores uses on Program data children', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-legacy-validation-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Legacy Agent', '', [
      atom('Legacy Program', '', [atom('Legacy Step')], 'program')
    ], 'agent')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"name.ren.Renamed Agent":"Legacy Agent"}',
    contextFile,
    projectionFile
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0]['name@agent'], 'Renamed Agent');
  assert.equal(result.warnings.some((warning) => warning.code === 'PROGRAM_USES_REQUIRED'), false);
});

test('Program children are data and never require uses even when detail is empty', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-data-children-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Data Program', '', [atom('Field', '')], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"name":"Data Program/Field","detail.rep.value"}',
    contextFile,
    projectionFile
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].children[0].detail, 'value');
});

test('name.run forces the selected Python Program detail to execute again', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-explicit-python-run-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Message Program', "message({'level': 'info', 'text': 'ran detail'})", [], 'program')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const first = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(first.messages.some((message) => message.text === 'ran detail'), true);

  const explicit = await executeAtomLanguage({
    source: 'transform {"name.run.":"Message Program"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });
  assert.equal(explicit.ok, true, JSON.stringify(explicit.errors));
  assert.equal(explicit.messages.some((message) => message.text === 'ran detail'), true);
});

test('name.run returns registered choice controls for the selected Program', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-choice-run-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Choice Program', "choice({'id': '状态', 'options': [{'id': 'todo', 'label': '待办'}], 'selected': ['todo']})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"name.run.":"Choice Program"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.program.choices, [{
    id: '状态',
    options: [{ id: 'todo', label: '待办' }],
    selected: ['todo'],
    empty: '未选择',
    multiple: true,
    sourceProgramPath: 'Choice Program'
  }]);
});

test('name.run accepts the same shortest unique path suffix as explore and transform', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-explicit-suffix-run-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('work', '', [
      atom('ESG项目总结与计划-自研复盘框架', '', [
        atom('推进流', "message({'level': 'info', 'text': 'suffix ran'})", [
          atom('内部路由', "message({'level': 'info', 'text': 'nested suffix ran'})", [], 'program')
        ], 'program')
      ])
    ])
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const result = await executeAtomLanguage({
    source: 'transform {"name.run.":"ESG项目总结与计划-自研复盘框架/推进流"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.messages.some((message) => message.text === 'suffix ran'), true);

  const nested = await executeAtomLanguage({
    source: 'transform {"name.run.":"ESG项目总结与计划-自研复盘框架/推进流/内部路由"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(nested.ok, true, JSON.stringify(nested.errors));
  assert.equal(nested.messages.some((message) => message.text === 'nested suffix ran'), true);
});
