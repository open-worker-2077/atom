import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

function child(parent, name) {
  return parent.children.find((item) => item.name === name || item[`name@program`] === name);
}

function workOrderFact(name = '并发工单', status = '执行中') {
  return atom(name, JSON.stringify({
    template: 'work-order', templateVersion: '1', creationId: 'concurrent', status,
    状态: { 当前: status }, 修订记录: []
  }), [
    atom('Output', JSON.stringify({ 定义: '成果', 交付物: { 名称: null, 接收方: null, 成果引用: null, 版本: null } })),
    atom('Step', JSON.stringify({ 定义: '步骤', 操作: { 状态: '未开始', 实际动作: [], 实际产出: [], 异常: [] } })),
    atom('Criteria', JSON.stringify({ 定义: '验收', 要求: { 条件: [], 边界: [] }, 验收: { 提交: { 成果引用: null, 版本: null, 提交时间: null }, 审核: { 结论: null, 意见: [], 审核人: null, 审核时间: null }, 驳回: { 返回: 'Step', 原因: [] } } }))
  ]);
}

test('a top-level test Program completes create fill validate submit read-back in one central commit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-work-order-e2e-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const source = [
    "order_path = current_atom().path + '/闭环工单'",
    "rows = explore({'name': current_atom().path, 'children$latitude-1': None, 'detail$full': None})",
    "if not any(row.path == order_path for row in rows):",
    "    work_order({'action': 'create', 'title': '闭环工单', 'creation_id': 'e2e-20260820', 'version': '1'})",
    "else:",
    "    state = work_order({'action': 'read-back', 'path': order_path})",
    "    if state['status'] == '待执行':",
    "        work_order({'action': 'fill', 'path': order_path, 'values': {",
    "            'Output': {'交付物': {'名称': '验收报告', '接收方': '测试方', '成果引用': 'doc://e2e.rep.segment', '版本': 'v1'}},",
    "            'Step': {'操作': {'状态': '已完成', '实际动作': ['生成 .sum. 报告'], '实际产出': ['doc://e2e.rep.segment'], '异常': []}},",
    "            'Criteria': {'要求': {'条件': ['内容完整'], '边界': ['不修改业务数据 .rep.']}}",
    "        }})",
    "    elif state['status'] == '执行中':",
    "        checked = work_order({'action': 'validate', 'path': order_path})",
    "        if checked['valid']:",
    "            work_order({'action': 'submit', 'path': order_path, 'submitted_at': '2026-08-20T10:00:00Z'})",
    "    elif state['status'] == '待验收':",
    "        final = work_order({'action': 'read-back', 'path': order_path})",
    "        message({'level': 'info', 'text': final['status'] + '|' + '|'.join(final['available_actions'])})"
  ].join('\n');
  await fs.writeFile(contextFile, `${JSON.stringify([
    atom('test', source, [], 'program')
  ], null, 2)}\n`, 'utf8');

  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, true);
  assert.notEqual(result.revisionAfter, result.revisionBefore);
  assert.equal(
    result.messages.at(-1)?.text,
    '待验收|submit|reject|read-back',
    JSON.stringify(result)
  );

  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(world.length, 1, 'test world remains isolated from business data');
  const order = child(world[0], '闭环工单');
  assert.ok(order, 'the work order is persisted below the dedicated test Atom');
  assert.deepEqual(order.children.map((item) => item.name), ['Output', 'Step', 'Criteria']);
  assert.equal(JSON.parse(order.detail).status, '待验收');
  assert.equal(JSON.parse(child(order, 'Output').detail).交付物.成果引用, 'doc://e2e.rep.segment');
  assert.deepEqual(JSON.parse(child(order, 'Step').detail).操作.实际产出, ['doc://e2e.rep.segment']);
  assert.deepEqual(JSON.parse(child(order, 'Criteria').detail).验收.提交, {
    成果引用: 'doc://e2e.rep.segment', 版本: 'v1', 提交时间: '2026-08-20T10:00:00Z'
  });

  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  assert.equal(journal.prepared.length, 0);
  assert.equal(journal.receipts.length, 1, 'all Program passes persist as one transaction');
  assert.equal(journal.receipts[0].receipt.status, 'committed');
  assert.equal(journal.receipts[0].before.facts.length, 1);
  assert.equal(child(journal.receipts[0].after.facts[0], '闭环工单') !== undefined, true);
});

test('an invalid multi-group fill emits no partial write or transaction receipt', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-work-order-no-partial-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const initial = [
    workOrderFact(),
    atom('invalid-test', [
      "work_order({'action': 'fill', 'path': '并发工单', 'values': {",
      "    'Output': {'交付物': {'成果引用': 'doc://must-not-persist', '版本': 'v1'}},",
      "    'Criteria': {'fields': ['parallel hierarchy']} ",
      "}})"
    ].join('\n'), [], 'program')
  ];
  const original = `${JSON.stringify(initial, null, 2)}\n`;
  await fs.writeFile(contextFile, original, 'utf8');

  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
      && /Unknown Criteria field: fields/u.test(warning.message)
  )), true, JSON.stringify(result.warnings));
  assert.equal(await fs.readFile(contextFile, 'utf8'), original);
  await assert.rejects(fs.readFile(journalFile, 'utf8'), (error) => error?.code === 'ENOENT');
});

test('two work-order writes from one old revision allow at most one central commit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-work-order-conflict-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const initialFacts = [workOrderFact()];
  await fs.writeFile(contextFile, `${JSON.stringify(initialFacts, null, 2)}\n`, 'utf8');
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile, journalFile, worldId: 'work-order-conflict'
  });
  const expectedRevision = revisionOfWorldFacts(initialFacts);
  const candidate = (reference) => {
    const facts = structuredClone(initialFacts);
    const output = JSON.parse(facts[0].children[0].detail);
    output.交付物.成果引用 = reference;
    output.交付物.版本 = 'v1';
    facts[0].children[0].detail = JSON.stringify(output);
    return facts;
  };
  const a = candidate('doc://A');
  const b = candidate('doc://B');

  const settled = await Promise.allSettled([
    persistence.commit({
      correlationId: 'fill-A', expectedRevision,
      nextRevision: revisionOfWorldFacts(a), facts: a, source: 'work_order.fill:A'
    }),
    persistence.commit({
      correlationId: 'fill-B', expectedRevision,
      nextRevision: revisionOfWorldFacts(b), facts: b, source: 'work_order.fill:B'
    })
  ]);

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.equal(rejected?.reason?.code, 'WORLD_REVISION_CONFLICT');
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(['doc://A', 'doc://B'].includes(JSON.parse(persisted[0].children[0].detail).交付物.成果引用), true);
  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  assert.equal(journal.prepared.length, 0);
  assert.equal(journal.receipts.length, 1);
});
