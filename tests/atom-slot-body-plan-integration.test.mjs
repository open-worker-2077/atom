import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { slotProgramInvocationsForEvent } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', contain = [], support = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    contain,
    support
  };
}

function nameOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@#]/u)[0] === 'thing')?.[1];
}

function find(atoms, selector) {
  let children = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = children.find((candidate) => nameOf(candidate) === segment);
    if (!current) return null;
    children = current.contain;
  }
  return current;
}

function world() {
  const calculate = [
    'def run():',
    '    rows = explore({"thing":"./输入/变量料","situation$full":True})',
    '    transform({"thing":"./输出/结果料","situation.rep." + rows[0].situation:None})',
    '    return {"computed":True}',
    'trigger("transform", {"nodes":["./输入"]}, run)'
  ].join('\n');
  const printer = (name) => (
    `use_program({"name":"Root/订单槽体/print","arguments":{"name":"${name}"}})`
  );
  return [atom('Root', '', [
    atom('研发窗口', '', [], [], ['agent']),
    atom('订单槽体', '', [
      atom('候选流', '', [
        atom('输入', '输入槽契约', [], [{ 'if@current': true, then: [{ thing: '输出' }] }]),
        atom('输出', '输出槽契约'),
        atom('备注', '备注槽契约'),
        atom('计算', calculate, [], [], ['program'])
      ])
    ]),
    atom('封装', 'slot_body({"action":"seal","body":"Root/订单槽体"})', [], [], ['program']),
    atom('打印001', printer('订单001'), [], [], ['program']),
    atom('打印002', printer('订单002'), [], [], ['program'])
  ])];
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-plan-integration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  return {
    contextFile,
    projectionFile,
    interaction: { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } }
  };
}

async function run(runtime, source, scheduler) {
  return executeAtomLanguage({ ...runtime, source, programScheduler: scheduler });
}

function conditionalWorld() {
  const predicate = [
    'def main(arguments):',
    '    try:',
    '        left = explore({"thing":"./字段甲/值料","situation$full":True})',
    '        right = explore({"thing":"./字段乙/值料","situation$full":True})',
    '        return left[0].situation == "值甲" and right[0].situation == "值乙"',
    '    except Exception:',
    '        return False'
  ].join('\n');
  const calculate = [
    'def run():',
    '    allowed = use_program({"name":"Root/条件槽体/槽模/判定","arguments":{}})',
    '    if allowed is not True:',
    '        return {"computed":False}',
    '    transform({"thing":"./结果/结果料","situation.rep.已计算":None})',
    '    return {"computed":True}',
    'trigger("transform", {"nodes":["./字段甲","./字段乙"]}, run)'
  ].join('\n');
  const printer = (name) => (
    `use_program({"name":"Root/条件槽体/print","arguments":{"name":"${name}"}})`
  );
  return [atom('Root', '', [
    atom('研发窗口', '', [], [], ['agent']),
    atom('条件槽体', '', [
      atom('候选流', '', [
        atom('字段甲', '字段甲槽契约', [], [{
          'if@current': true,
          if: [{ and: [
            { thing: '字段乙' },
            { 'thing@program': '判定' }
          ] }],
          then: [{ thing: '执行' }]
        }]),
        atom('字段乙', '字段乙槽契约'),
        atom('结果', '结果槽契约'),
        atom('执行', '普通事实后项'),
        atom('判定', predicate, [], [], ['program']),
        atom('计算', calculate, [], [], ['program'])
      ])
    ]),
    atom('封装条件槽体', 'slot_body({"action":"seal","body":"Root/条件槽体"})', [], [], ['program']),
    atom('打印条件001', printer('实例001'), [], [], ['program']),
    atom('打印条件002', printer('实例002'), [], [], ['program'])
  ])];
}

async function setupConditional(t) {
  const runtime = await setup(t);
  await fs.writeFile(runtime.contextFile, JSON.stringify(conditionalWorld(), null, 2), 'utf8');
  return runtime;
}

async function sealAndPrintConditional(runtime, scheduler, second = false) {
  const sealed = await run(runtime, 'transform {"thing.run.":"Root/封装条件槽体"}', scheduler);
  assert.equal(sealed.ok, true, JSON.stringify(sealed.errors));
  const printed = await run(runtime, 'transform {"thing.run.":"Root/打印条件001"}', scheduler);
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));
  for (const material of [
    { thing: 'Root/条件槽体/槽例/实例001/结果/结果料', situation: '', contain: [], support: [] },
    { thing: 'Root/条件槽体/槽例/实例001/字段甲/值料', situation: '字段甲槽契约', contain: [], support: [] },
    { thing: 'Root/条件槽体/槽例/实例001/字段乙/值料', situation: '字段乙槽契约', contain: [], support: [] }
  ]) {
    const initialized = await run(runtime, `transform new ${JSON.stringify(material)}`, scheduler);
    assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));
  }
  if (second) {
    const printedSecond = await run(runtime, 'transform {"thing.run.":"Root/打印条件002"}', scheduler);
    assert.equal(printedSecond.ok, true, JSON.stringify(printedSecond.errors));
    for (const material of [
      { thing: 'Root/条件槽体/槽例/实例002/结果/结果料', situation: '', contain: [], support: [] },
      { thing: 'Root/条件槽体/槽例/实例002/字段甲/值料', situation: '字段甲槽契约', contain: [], support: [] },
      { thing: 'Root/条件槽体/槽例/实例002/字段乙/值料', situation: '字段乙槽契约', contain: [], support: [] }
    ]) {
      const initializedSecond = await run(runtime, `transform new ${JSON.stringify(material)}`, scheduler);
      assert.equal(initializedSecond.ok, true, JSON.stringify(initializedSecond.errors));
    }
  }
}

function triggerFields(instance, fields = ['字段甲', '字段乙'], sameValue = false) {
  return `transform ${JSON.stringify(fields.map((field) => ({
    thing: `Root/条件槽体/槽例/${instance}/${field}/值料`,
    [`situation.rep.值${field.at(-1)}`]: sameValue ? `值${field.at(-1)}` : `${field}槽契约`
  })))}`;
}

test('generated print Program seals and prints without a blank template in central atomic commits', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();

  const sealed = await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);
  assert.equal(sealed.ok, true, JSON.stringify(sealed.errors));
  const printed = await run(runtime, 'transform {"thing.run.":"Root/打印001"}', scheduler);
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));

  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.deepEqual(slotProgramInvocationsForEvent(committed, {
    mode: 'transform', nodes: ['Root/订单槽体/槽例/订单001/输入']
  }), [], 'support edges alone must not schedule a Program');
  assert.deepEqual(slotProgramInvocationsForEvent(committed, {
    mode: 'transform', nodes: ['Root/订单槽体/槽例/订单001/输入']
  }, scheduler.triggerContracts).map((item) => item.programPath), ['Root/订单槽体/槽模/计算']);
  assert.ok(find(committed, 'Root/订单槽体/print'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/空槽例'), null);
  assert.ok(find(committed, 'Root/订单槽体/槽例/订单001/输入'), JSON.stringify(printed));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单001/计算'), null);
});

test('outside orchestration materializes a local variable Thing before triggering only its owning instance', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印001"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印002"}', scheduler);

  await run(runtime, 'transform new {"thing":"Root/订单槽体/槽例/订单001/输出/结果料","situation":"","contain":[],"support":[]}', scheduler);
  await run(runtime, 'transform new {"thing":"Root/订单槽体/槽例/订单002/输出/结果料","situation":"","contain":[],"support":[]}', scheduler);

  const materialized = await run(
    runtime,
    'transform new {"thing":"Root/订单槽体/槽例/订单001/输入/变量料","situation":"实例一","contain":[],"support":[]}',
    scheduler
  );
  assert.equal(materialized.ok, true, JSON.stringify(materialized.errors));
  let committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单001/输出/结果料').situation, '实例一');
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单002/输出/结果料').situation, '');

  const unrelated = await run(
    runtime,
    'transform new {"thing":"Root/订单槽体/槽例/订单002/备注/旁注料","situation":"不触发","contain":[],"support":[]}',
    scheduler
  );
  assert.equal(unrelated.ok, true, JSON.stringify(unrelated.errors));
  committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单002/输出/结果料').situation, '');
});

test('one atomic batch evaluates one owner-local condition and dispatches its consequent once', async (t) => {
  const runtime = await setupConditional(t);
  const diagnostics = [];
  const scheduler = createProgramRuntimeScheduler({
    diagnosticRecorder: { async record(entry) { diagnostics.push(entry); } }
  });
  await sealAndPrintConditional(runtime, scheduler);
  diagnostics.length = 0;

  const before = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.deepEqual(find(before, 'Root/条件槽体/槽例/实例001/字段甲').support, [
    {
      'if@current': true,
      if: [{ and: [
        { thing: 'Root/条件槽体/槽例/实例001/字段乙' },
        { 'thing@program': 'Root/条件槽体/槽模/判定' }
      ] }],
      then: [{ thing: 'Root/条件槽体/槽例/实例001/执行' }]
    }
  ]);
  assert.deepEqual(find(before, 'Root/条件槽体/槽例/实例001/执行').support, []);
  assert.deepEqual(find(before, 'Root/条件槽体/槽模/判定').support, []);
  assert.deepEqual(find(before, 'Root/条件槽体/槽模/计算').support, []);
  const invocations = slotProgramInvocationsForEvent(before, {
    mode: 'transform',
    nodes: [
      'Root/条件槽体/槽例/实例001/字段甲/值料',
      'Root/条件槽体/槽例/实例001/字段乙/值料'
    ]
  }, scheduler.triggerContracts);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].programPath, 'Root/条件槽体/槽模/计算');

  const changed = await run(runtime, triggerFields('实例001'), scheduler);

  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/条件槽体/槽例/实例001/结果/结果料').situation, '已计算');
  assert.equal(
    diagnostics.filter((entry) => entry.program?.path === 'Root/条件槽体/槽模/计算').length,
    1
  );
});

test('a same-value local-material Transform still evaluates and dispatches owner-local support', async (t) => {
  const runtime = await setupConditional(t);
  const diagnostics = [];
  const scheduler = createProgramRuntimeScheduler({
    diagnosticRecorder: { async record(entry) { diagnostics.push(entry); } }
  });
  await sealAndPrintConditional(runtime, scheduler);
  assert.equal((await run(runtime, triggerFields('实例001'), scheduler)).ok, true);
  diagnostics.length = 0;

  const changed = await run(runtime, triggerFields('实例001', ['字段甲'], true), scheduler);

  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/条件槽体/槽例/实例001/结果/结果料').situation, '已计算');
  assert.equal(
    diagnostics.filter((entry) => entry.program?.path === 'Root/条件槽体/槽模/计算').length,
    1
  );
});

test('a strict-false owner-local condition does not dispatch its consequent', async (t) => {
  const runtime = await setupConditional(t);
  const diagnostics = [];
  const scheduler = createProgramRuntimeScheduler({
    diagnosticRecorder: { async record(entry) { diagnostics.push(entry); } }
  });
  await sealAndPrintConditional(runtime, scheduler);
  diagnostics.length = 0;

  const before = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(slotProgramInvocationsForEvent(before, {
    mode: 'transform', nodes: ['Root/条件槽体/槽例/实例001/字段甲/值料']
  }, scheduler.triggerContracts).length, 1);

  const changed = await run(runtime, triggerFields('实例001', ['字段甲']), scheduler);

  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/条件槽体/槽例/实例001/结果/结果料').situation, '');
  assert.equal(
    diagnostics.filter((entry) => entry.program?.path === 'Root/条件槽体/槽模/计算').length,
    1
  );
});

test('owner-local support never dispatches the same revision in a sibling instance', async (t) => {
  const runtime = await setupConditional(t);
  const scheduler = createProgramRuntimeScheduler();
  await sealAndPrintConditional(runtime, scheduler, true);

  const changed = await run(runtime, triggerFields('实例001'), scheduler);

  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/条件槽体/槽例/实例001/结果/结果料').situation, '已计算');
  assert.equal(find(committed, 'Root/条件槽体/槽例/实例002/结果/结果料').situation, '');
});

test('re-seal recomputes every synchronized instance with the new shared Program in the same commit', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印001"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印002"}', scheduler);
  await run(runtime, 'transform new {"thing":"Root/订单槽体/槽例/订单001/输出/结果料","situation":"","contain":[],"support":[]}', scheduler);
  await run(runtime, 'transform new {"thing":"Root/订单槽体/槽例/订单002/输出/结果料","situation":"","contain":[],"support":[]}', scheduler);
  await run(runtime, 'transform new {"thing":"Root/订单槽体/槽例/订单001/输入/变量料","situation":"一","contain":[],"support":[]}', scheduler);
  await run(runtime, 'transform new {"thing":"Root/订单槽体/槽例/订单002/输入/变量料","situation":"二","contain":[],"support":[]}', scheduler);
  await run(runtime, 'transform {"thing":"Root/订单槽体/槽例/订单001/输出/结果料","situation.rep.陈旧一"}', scheduler);
  await run(runtime, 'transform {"thing":"Root/订单槽体/槽例/订单002/输出/结果料","situation.rep.陈旧二"}', scheduler);

  const changed = await run(runtime, `transform ${JSON.stringify({
    thing: 'Root/订单槽体/槽模/计算',
    'situation.rep.return {"computed":False}': 'return {"computed":True}'
  })}`, scheduler);
  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const resealed = await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);
  assert.equal(resealed.ok, true, JSON.stringify(resealed.errors));

  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.deepEqual(slotProgramInvocationsForEvent(committed, {
    mode: 'transform', nodes: ['Root/订单槽体/槽例/订单001/输入']
  }, scheduler.triggerContracts).map((item) => item.programPath), ['Root/订单槽体/槽模/计算']);
  assert.equal(
    find(committed, 'Root/订单槽体/槽例/订单001/输出/结果料').situation,
    '一',
    JSON.stringify(resealed)
  );
  assert.equal(
    find(committed, 'Root/订单槽体/槽例/订单002/输出/结果料').situation,
    '二',
    JSON.stringify(resealed)
  );
});

test('one derived recomputation failure rolls back the entire re-seal candidate transaction', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印001"}', scheduler);
  const changed = await run(runtime, `transform ${JSON.stringify({
    thing: 'Root/订单槽体/槽模/计算',
    'situation.rep.raise ValueError("recompute")': 'return {"computed":True}'
  })}`, scheduler);
  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const before = await fs.readFile(runtime.contextFile, 'utf8');

  const resealed = await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);

  assert.equal(resealed.ok, false, JSON.stringify(resealed));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), before);
});

test('exact Explore, cold projection, and unrelated Program creation never replay a print effect', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"thing.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"thing.run.":"Root/打印001"}', scheduler);
  const committedText = await fs.readFile(runtime.contextFile, 'utf8');

  const explored = await run(
    runtime,
    'explore {"thing":"Root/订单槽体/槽例/订单001","contain$latitude-1":true}',
    scheduler
  );
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.equal(explored.changed, false, JSON.stringify(explored));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), committedText);

  const projected = await executeAtomLanguage({
    ...runtime,
    source: 'atom',
    programMode: 'project',
    programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(projected.ok, true, JSON.stringify(projected.errors));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), committedText);

  const created = await run(
    runtime,
    'transform new {"thing@program":"Root/无关程序","situation":"def main(arguments):\\n    return arguments","contain":[],"support":[]}',
    scheduler
  );
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(
    find(committed, 'Root/订单槽体/槽例').contain.filter((child) => nameOf(child) === '订单001').length,
    1
  );
});
