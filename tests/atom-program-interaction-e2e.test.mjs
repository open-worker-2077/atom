import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

test('discard deactivates nested Program indexes and restore rebuilds them from facts', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-backup-deactivation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const watcherSource = [
    "dependency = explore({'thing': 'Dependency', 'situation$full': None})[0]",
    'def on_source_change():',
    "    transform({'thing': 'Target', 'situation.rep.triggered': None})",
    "trigger('transform', {'nodes': ['Source']}, on_source_change)"
  ].join('\n');
  const activeSource = [
    "dependency = explore({'thing': 'Dependency', 'situation$full': None})[0]",
    'def on_source_change():',
    "    message({'level': 'info', 'text': 'active watcher ran'})",
    "trigger('transform', {'nodes': ['Source']}, on_source_change)"
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Source'),
    atom('Dependency'),
    atom('Target', 'stable'),
    atom('Program Container', '', [atom('Watcher', watcherSource, [], 'program')]),
    atom('Active Watcher', activeSource, [], 'program'),
    atom('Default Backup', '', [], 'backup@default')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();
  const execute = (source) => executeAtomLanguage({
    source, contextFile, projectionFile, programScheduler: scheduler
  });

  const discarded = await execute('transform {"thing.dsc.":"Program Container"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const archivedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const archivedContainer = archivedWorld
    .find((candidate) => candidate['thing@backup@default'] === 'Default Backup')
    .contain[0];
  assert.equal(archivedContainer['thing'], 'Program Container');
  assert.equal(archivedContainer.contain[0]['thing@program'], 'Watcher');
  assert.equal(archivedContainer.contain[0].situation, watcherSource);
  assert.deepEqual([...scheduler.triggerContracts.keys()], ['Active Watcher']);
  assert.deepEqual(
    [...scheduler.triggerIndex.values()].map((paths) => [...paths]),
    [['Active Watcher']]
  );
  assert.deepEqual([...scheduler.programReadDependencies.keys()], ['Active Watcher']);

  const restartedScheduler = createProgramRuntimeScheduler();
  const executeAfterRestart = (source) => executeAtomLanguage({
    source, contextFile, projectionFile, programScheduler: restartedScheduler
  });
  const renamedWhileArchived = await executeAfterRestart(
    'transform {"thing.ren.Source Renamed":"Source"}'
  );
  assert.equal(renamedWhileArchived.ok, true, JSON.stringify(renamedWhileArchived.errors));
  assert.deepEqual(
    renamedWhileArchived.messages.map((message) => message.text),
    ['active watcher ran']
  );
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[2].situation, 'stable');
  assert.deepEqual([...restartedScheduler.triggerContracts.keys()], ['Active Watcher']);
  assert.deepEqual([...restartedScheduler.programReadDependencies.keys()], ['Active Watcher']);

  const restored = await executeAfterRestart(
    'transform {"thing.rst.":"Default Backup/Program Container"}'
  );
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.deepEqual(
    new Set(restartedScheduler.triggerContracts.keys()),
    new Set(['Active Watcher', 'Program Container/Watcher'])
  );
  assert.deepEqual(
    new Set(restartedScheduler.programReadDependencies.keys()),
    new Set(['Active Watcher', 'Program Container/Watcher'])
  );

  const renamedAfterRestore = await executeAfterRestart(
    'transform {"thing.ren.Source":"Source Renamed"}'
  );
  assert.equal(renamedAfterRestore.ok, true, JSON.stringify(renamedAfterRestore.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[2].situation, 'triggered');
  assert.deepEqual(
    renamedAfterRestore.messages.map((message) => message.text),
    ['active watcher ran']
  );
});

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
      "nodes = explore({'thing': '推进流', 'contain$latitude-2': None, 'situation$full': None})",
      "approved = [node for node in nodes if node.thing != '状态' and any(s.thing == '状态' and s.situation == '已人工冻结' for s in explore({'thing': node.path, 'contain$latitude-1': None, 'situation$full': None}))]",
      "if approved:",
      "    lock({'targets': {'refs': [node.ref for node in approved]}, 'mode': 'write', 'fields': ['situation'], 'protect': {'atom': True, 'messages': False}})",
      "    message({'level': 'info', 'text': f'已冻结{len(approved)}个任务'})"
    ].join('\n'), [], 'program')
  ];
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const denied = await executeAtomLanguage({
    source: 'transform {"thing":"推进流/任务A","situation.rep.篡改"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED');
  assert.equal(denied.messages[0].text, '已冻结1个任务');

  const allowed = await executeAtomLanguage({
    source: 'transform {"thing":"推进流/任务B","situation.rep.可修改"}',
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
      "target = explore({'thing': '汇总值', 'situation$full': None})[0]",
      "if target.situation != '42':",
      "    transform({'thing': '汇总值', 'situation.rep.42': None})",
      "    message({'level': 'info', 'text': '已写入汇总值'})"
    ].join('\n'), [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'explore {"thing":"汇总值","situation$full"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.items[0].matches[0].situation, '42');
  assert.deepEqual(result.messages, [], 'query receipts do not publish background Program messages');
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(persisted[0].situation, '42');
});

test('Program parses source detail JSON, processes it, and serializes it into a Transform update', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-json-detail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Source', '{"record_key":"R1","label":"旧"}'),
    atom('Target', '{}'),
    atom('JSON Processor', [
      'source = explore({"thing": "Source", "situation$full": True})[0]',
      'value = json_parse({"text": source.situation})',
      'value["label"] = "中文成果"',
      'serialized = json_stringify({"value": value, "indent": 2})',
      'target = explore({"thing": "Target", "situation$full": True})[0]',
      'if target.situation != serialized:',
      '    transform({"thing": "Target", "situation.rep." + serialized: None})'
    ].join('\n'), [], 'program')
  ], null, 2));

  const run = await executeAtomLanguage({
    source: 'transform {"thing.run.":"JSON Processor"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.equal(run.changed, true, JSON.stringify(run));

  const result = await executeAtomLanguage({
    source: 'explore {"thing":"Target","situation$full":true}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(JSON.parse(result.items[0].matches[0].situation), {
    record_key: 'R1', label: '中文成果'
  });
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(JSON.parse(persisted[1].situation), {
    record_key: 'R1', label: '中文成果'
  });
});

test('explicit Program run creates a nested four-axis Atom and leaves assignment as None', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('test'),
    atom('Creator', [
      "result = transform({'thing': 'test/Created', 'situation': '{\"probe\":true}', 'contain': [], 'support': []})",
      "message({'level': 'info', 'text': str(result)})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, true);
  assert.equal(result.messages.some((message) => message.text === 'None'), true);
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(persisted[0].contain[0].thing, 'Created');
  assert.equal(persisted[0].contain[0].situation, '{"probe":true}');
});

test('Program creation rejects a missing parent without persisting a partial Atom', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-missing-parent-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Creator', "transform({'thing': 'missing/Created', 'situation': '', 'contain': [], 'support': []})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Creator"}',
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
    atom('Creator', "transform({'thing': 'test/Created', 'situation': 'replacement', 'contain': [], 'support': []})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false);
  assert.equal(result.warnings[0].code, 'PROGRAM_TRANSFORM_REJECTED');
  assert.equal(result.warnings[0].cause, 'DUPLICATE_ATOM_NAME');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].contain[0].situation, 'original');
});

test('Program creation cannot append a child through a parent children write lock', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-parent-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Parent'),
    atom('Creator', [
      "parent = explore({'thing': 'Parent'})[0]",
      "lock({'targets': {'refs': [parent.ref]}, 'mode': 'write', 'fields': ['contain']})",
      "transform({'thing': 'Parent/Unauthorized', 'situation': '', 'contain': [], 'support': []})"
    ].join('\n'), [], 'program')
  ], null, 2));

  const before = await fs.readFile(contextFile, 'utf8');
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false, JSON.stringify(result));
  assert.equal(result.warnings.some((warning) => (
    warning.code === 'PROGRAM_TRANSFORM_REJECTED'
      && warning.cause === 'PROGRAM_LOCK_DENIED'
  )), true, JSON.stringify(result.warnings));
  assert.equal(await fs.readFile(contextFile, 'utf8'), before);
});

test('Program creation rejects an introduced Program that violates the sandbox grammar', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-invalid-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('test'),
    atom('Creator', "transform({'thing@program': 'test/Bad Program', 'situation': 'import os', 'contain': [], 'support': []})", [], 'program')
  ], null, 2));

  const before = await fs.readFile(contextFile, 'utf8');
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Creator"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false, JSON.stringify(result));
  assert.equal(result.warnings.some((warning) => (
    warning.code === 'PROGRAM_TRANSFORM_REJECTED'
      && warning.cause === 'INVALID_PROGRAM_SOURCE'
  )), true, JSON.stringify(result.warnings));
  assert.equal(await fs.readFile(contextFile, 'utf8'), before);
});

test('a caught JSON codec failure discards effects registered earlier in the Program', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-json-failure-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Target', 'original'),
    atom('Catching Program', [
      "transform({'thing': 'Target', 'situation.rep.changed': None})",
      'try:',
      '    json_parse({"text": "NaN"})',
      'except ValueError:',
      '    pass'
    ].join('\n'), [], 'program')
  ], null, 2));

  const before = await fs.readFile(contextFile, 'utf8');
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Catching Program"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false, JSON.stringify(result));
  assert.equal(result.warnings.some((warning) => warning.code === 'ATOM_PROGRAM_FAILED'), true);
  assert.equal(await fs.readFile(contextFile, 'utf8'), before);
});

test('explore keeps Program computation active without leaking unrelated Program failures into its receipt', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-explore-feedback-scope-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Target', 'before'),
    atom('Working Program', [
      "target = explore({'thing': 'Target', 'situation$full': None})[0]",
      "if target.situation != 'after':",
      "    transform({'thing': 'Target', 'situation.rep.after': None})"
    ].join('\n'), [], 'program'),
    atom('Unrelated Broken Program', "raise ValueError('unrelated failure')", [], 'program'),
    atom('Unrelated Reporting Program', "message({'level': 'info', 'text': 'background message'})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'explore {"thing":"Target","situation$full"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].situation, 'after', 'Program computation remains active');
  assert.deepEqual(result.warnings, [], 'background diagnostics do not masquerade as query feedback');
  assert.deepEqual(result.messages, [], 'background messages do not masquerade as query feedback');

  const diagnostic = await executeAtomLanguage({
    source: 'explore {"thing":"Unrelated Broken Program"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(diagnostic.warnings[0].program, 'Unrelated Broken Program', 'a queried Program keeps its own diagnostic');

  const report = await executeAtomLanguage({
    source: 'explore {"thing":"Unrelated Reporting Program"}',
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
      "target = explore({'thing': '任务A'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['thing']})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const edit = await executeAtomLanguage({
    source: 'transform {"thing":"任务A","situation.rep.新文"}', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(edit.ok, true);

  const rename = await executeAtomLanguage({
    source: 'transform {"thing.ren.新名":"任务A"}', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(rename.ok, false);
  assert.equal(rename.errors[0].code, 'PROGRAM_LOCK_DENIED');
});

test('batch rename preflights descendant locks with authoritative full paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-batch-rename-lock-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('域', '', [
      atom('甲', '', [atom('受保护后代')]),
      atom('乙')
    ]),
    atom('后代锁', [
      "target = explore({'thing': '域/甲/受保护后代'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['contain']})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const before = await fs.readFile(contextFile, 'utf8');

  const result = await executeAtomLanguage({
    source: `transform ${JSON.stringify([
      { 'thing.ren.新甲': '域/甲' },
      { 'thing.ren.新乙': '域/乙' }
    ])}`,
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'WINDOW_ACCESS_DENIED');
  assert.equal(await fs.readFile(contextFile, 'utf8'), before);
});

test('explore returns the applicable write-lock summary before an Agent attempts a change', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-lock-summary-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('框架', '说明'),
    atom('框架锁', [
      "target = explore({'thing': '框架'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['thing', 'situation'], 'reason': {'code': 'FRAMEWORK_SCHEMA', 'message': '框架名称与说明由模板维护'}})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'explore {"thing":"框架","situation$full"}',
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items[0].matches[0].lockState.writeFields, ['situation', 'thing']);
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
      "rows = explore({'thing': '任务', 'contain$latitude-1': None, 'situation$full': None})",
      "if any(row.path == '任务/状态' and row.situation == '已冻结' for row in rows):",
      "    lock({'targets': {'refs': [row.ref for row in rows]}, 'mode': 'write', 'fields': ['thing', 'situation'], 'reason': {'code': 'MANUAL_FREEZE', 'message': '任务已人工冻结'}})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const frozen = await executeAtomLanguage({
    source: 'transform {"thing":"任务/状态","situation.rep.已冻结"}',
    contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(frozen.ok, true);

  const denied = await executeAtomLanguage({
    source: 'transform {"thing":"任务","situation.rep.不应写入"}',
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
      "target = explore({'thing': '目标'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['thing']})",
      "transform({'thing.ren.新目标': '目标'})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings[0].code, 'PROGRAM_TRANSFORM_REJECTED');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].thing, '目标');
});

test('transform new reports Program lock denial instead of an undefined decision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-lock-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('已有目标', '原文'),
    atom('创建锁', [
      "target = explore({'thing': '已有目标'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['thing', 'situation', 'contain', 'support']})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const result = await executeAtomLanguage({
    source: 'transform new {"thing":"已有目标","situation":"","contain":[],"support":[]}',
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
    source: 'transform {"thing.ren.Renamed Agent":"Legacy Agent"}',
    contextFile,
    projectionFile
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0]['thing@agent'], 'Renamed Agent');
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
    source: 'transform {"thing":"Data Program/Field","situation.rep.value"}',
    contextFile,
    projectionFile
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].contain[0].situation, 'value');
});

test('thing.run forces the selected Python Program detail to execute again', async () => {
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
    source: 'transform {"thing.run.":"Message Program"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });
  assert.equal(explicit.ok, true, JSON.stringify(explicit.errors));
  assert.equal(explicit.messages.some((message) => message.text === 'ran detail'), true);
});

test('thing.run returns registered choice controls for the selected Program', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-choice-run-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Choice Program', "choice({'id': '状态', 'options': [{'id': 'todo', 'label': '待办'}], 'selected': ['todo']})", [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Choice Program"}',
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

test('thing.run accepts the same shortest unique path suffix as explore and transform', async () => {
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
    source: 'transform {"thing.run.":"ESG项目总结与计划-自研复盘框架/推进流"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.messages.some((message) => message.text === 'suffix ran'), true);

  const nested = await executeAtomLanguage({
    source: 'transform {"thing.run.":"ESG项目总结与计划-自研复盘框架/推进流/内部路由"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(nested.ok, true, JSON.stringify(nested.errors));
  assert.equal(nested.messages.some((message) => message.text === 'nested suffix ran'), true);
});

test('thing.run keeps every active Program available to use_program', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-explicit-library-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Library', [
      'def main(arguments):',
      '    return {"value": arguments["value"] + "-library"}'
    ].join('\n'), [], 'program'),
    atom('Caller', [
      'result = use_program({"name": "Library", "arguments": {"value": "active"}})',
      'message({"level": "info", "text": result["value"]})'
    ].join('\n'), [], 'program')
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Caller"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.messages.some((message) => message.text === 'active-library'), true);
});

test('thing.run cannot select a Program below the typed default backup', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-explicit-backup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Default Backup', '', [
      atom('Archived', "message({'level': 'info', 'text': 'must not run'})", [], 'program')
    ], 'backup@default')
  ], null, 2));
  const before = await fs.readFile(contextFile, 'utf8');

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Default Backup/Archived"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'PROGRAM_NOT_FOUND');
  assert.deepEqual(result.messages ?? [], []);
  assert.equal(await fs.readFile(contextFile, 'utf8'), before);
});
