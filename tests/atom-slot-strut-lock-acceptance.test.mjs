import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { slotProgramInvocationsForEvent } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', slot = [], strut = [], types = []) {
  const agentProgram = types.includes('agent');
  const storedTypes = agentProgram
    ? ['program', ...types.filter((type) => type !== 'agent' && type !== 'program')]
    : types;
  return {
    [`thing${storedTypes.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    slot,
    strut
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
    children = current.slot;
  }
  return current;
}

function world() {
  const root = 'Root/Holder/Unlabelled';
  const body = `${root}/条件槽体`;
  const predicate = [
    'def main(arguments):',
    '    try:',
    '        left = explore({"thing":"./字段甲/值料","situation$full":True})',
    '        right = explore({"thing":"./字段乙/值料","situation$full":True})',
    '        return left[0].situation == "值甲" and right[0].situation == "值乙"',
    '    except Exception:',
    '        return False'
  ].join('\n');
  const action = [
    'def run(delivery):',
    '    if delivery["decision"] is not True:',
    '        return {"locked":False}',
    '    targets = explore({"thing":"./结果/结果料","situation$full":True})',
    "    lock_source = 'lock({\"targets\":{\"paths\":[\"' + targets[0].path + '\"],\"scope\":\"exact\"},\"actions\":[\"transform\"],\"labels\":[\"approved\"]})'",
    '    transform({"thing":"./状态锁","situation.rep." + lock_source:None})',
    '    transform({"thing":"./结果/结果料","situation.rep.已批准":None})',
    '    return {"locked":True}',
    'trigger("strut", {"nodes":["./执行"]}, run)'
  ].join('\n');
  const printer = (name) => `use_program({"name":"${body}/print","arguments":{"name":"${name}"}})`;
  const agent = (labels) => `agent(${JSON.stringify({
    labels,
    functions: { groups: [], names: ['explore', 'json_parse', 'lock', 'slot_body', 'transform', 'trigger', 'use_program'] }
  })})`;

  return [atom('Root', '', [
    atom('Holder', agent(['approved']), [
      atom('Unlabelled', agent([]), [
        atom('条件槽体', '', [
          atom('候选流', '', [
            atom('字段甲', '字段甲槽契约', [], [{
              'if@current': true,
              if: [{ and: [{ thing: '字段乙' }, { 'thing@program': '判定' }] }],
              then: [{ thing: '执行' }]
            }]),
            atom('字段乙', '字段乙槽契约'),
            atom('结果', '结果槽契约'),
            atom('执行', '普通事实后项'),
            atom('判定', predicate, [], [], ['program']),
            atom('执行动作', action, [], [], ['program'])
          ])
        ]),
        atom('封装', `slot_body({"action":"seal","body":"${body}"})`, [], [], ['program']),
        atom('打印001', printer('实例001'), [], [], ['program']),
        atom('打印002', printer('实例002'), [], [], ['program'])
      ], [], ['program', 'agent'])
    ], [], ['program', 'agent'])
  ])];
}

async function execute(runtime, source, agentPath) {
  return executeAtomLanguage({
    ...runtime,
    source,
    interaction: { id: `slot-strut-lock-${crypto.randomUUID()}`, agent: { path: agentPath } }
  });
}

test('a slot strut true lets its own triggered action arm a node lock without locking a sibling example', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-strut-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const runtime = { contextFile, projectionFile, programScheduler: scheduler };
  const unlabelled = 'Root/Holder/Unlabelled';
  const holder = 'Root/Holder';
  const body = `${unlabelled}/条件槽体`;

  for (const source of [
    'transform {"thing.run.":"Root/Holder/Unlabelled/封装"}',
    'transform {"thing.run.":"Root/Holder/Unlabelled/打印001"}',
    'transform {"thing.run.":"Root/Holder/Unlabelled/打印002"}'
  ]) {
    const result = await execute(runtime, source, unlabelled);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
  const printedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.ok(find(printedWorld, `${body}/槽例/实例001/字段甲`), '实例001未形成字段甲槽角色');

  for (const instance of ['实例001', '实例002']) {
    for (const material of [
      { thing: `${body}/槽例/${instance}/字段甲/值料`, situation: '待填写' },
      { thing: `${body}/槽例/${instance}/字段乙/值料`, situation: '待填写' },
      { thing: `${body}/槽例/${instance}/结果/结果料`, situation: '待计算' },
      {
        'thing@program': `${body}/槽例/${instance}/状态锁`,
        situation: 'def main(arguments):\n    return {"locked":False}'
      }
    ]) {
      const created = await execute(runtime, `transform new ${JSON.stringify({
        ...material, slot: [], strut: []
      })}`, unlabelled);
      assert.equal(created.ok, true, JSON.stringify(created.errors));
    }
  }

  let stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.ok(find(stored, `${body}/槽模/判定`));
  assert.ok(find(stored, `${body}/槽例/实例001`));
  assert.ok(find(stored, `${body}/槽例/实例002`));

  const falseResult = await execute(runtime, `transform ${JSON.stringify([
    { thing: `${body}/槽例/实例001/字段甲/值料`, 'situation.rep.值甲': '待填写' }
  ])}`, unlabelled);
  assert.equal(falseResult.ok, true, JSON.stringify(falseResult.errors));
  stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, `${body}/槽例/实例001/状态锁`).situation.includes('lock('), false);

  const trueResult = await execute(runtime, `transform ${JSON.stringify([
    { thing: `${body}/槽例/实例001/字段乙/值料`, 'situation.rep.值乙': '待填写' }
  ])}`, unlabelled);
  assert.equal(trueResult.ok, true, JSON.stringify(trueResult.errors));
  stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, `${body}/槽例/实例001/结果/结果料`).situation, '已批准');
  assert.equal(find(stored, `${body}/槽例/实例001/状态锁`).situation.includes('lock('), true);
  assert.equal(find(stored, `${body}/槽例/实例002/状态锁`).situation.includes('lock('), false);

  const target = `${body}/槽例/实例001/结果/结果料`;
  const denied = await execute(runtime, `transform {"thing":${JSON.stringify(target)},"situation.rep.越权"}`, unlabelled);
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => error.code === 'GRAPH_LOCK_DENIED'), JSON.stringify(denied));

  const allowed = await execute(runtime, `transform {"thing":${JSON.stringify(target)},"situation.rep.已复核"}`, holder);
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
  stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, target).situation, '已复核');
  assert.equal(find(stored, `${body}/槽例/实例002/结果/结果料`).situation, '待计算');

  const consequentPath = `${body}/槽例/实例001/执行`;
  const deliveries = ['clause-a', 'clause-b'].map((clauseId, consequentOrdinal) => ({
    mode: 'strut',
    revision: 'sha256:direct-strut-acceptance',
    clauseId,
    decision: true,
    antecedentPaths: [`${body}/槽例/实例001/字段甲`],
    consequentPath,
    consequentOrdinal
  }));
  assert.deepEqual(slotProgramInvocationsForEvent(stored, {
    mode: 'strut', nodes: [consequentPath]
  }, scheduler.triggerContracts).map((invocation) => invocation.scopeRoot), [
    `${body}/槽例/实例001`
  ]);
  const subscriberCalls = [];
  const runProgram = scheduler.runProgram;
  scheduler.runProgram = async (request) => {
    if (request.program.path === `${body}/槽模/执行动作`) {
      subscriberCalls.push({
        scopeRoot: request.scopeRoot,
        delivery: request.programArguments
      });
    }
    return runProgram(request);
  };
  const directStrut = await scheduler.refresh(stored, {
    agentOrigin: { path: holder },
    isolateFailures: true,
    triggerEvent: { mode: 'strut', nodes: [consequentPath], deliveries }
  });
  assert.deepEqual(subscriberCalls.map((call) => ({
    scopeRoot: call.scopeRoot,
    clauseId: call.delivery.clauseId
  })), [
    { scopeRoot: `${body}/槽例/实例001`, clauseId: 'clause-a' },
    { scopeRoot: `${body}/槽例/实例001`, clauseId: 'clause-b' }
  ]);
  assert.deepEqual(directStrut.failures, [], JSON.stringify(directStrut.failures));
  assert.deepEqual(directStrut.executedProgramPaths, [
    `${body}/槽模/执行动作`,
    `${body}/槽模/执行动作`
  ]);
  assert.equal(directStrut.transforms.length, 4);
});
test('a failing strut subscriber rolls back the warm source Transform', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-rollback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = atom('Source', 'before', [], [{
    'if@current': true,
    if: [{ 'thing@program': 'Predicate' }],
    then: [{ thing: 'Result' }]
  }]);
  const initial = [
    source,
    atom('Result'),
    atom('Predicate', 'def main(arguments):\n    return True', [], [], ['program']),
    atom('FailingSubscriber', [
      'def receive(delivery):',
      '    return delivery["missing"]',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), [], [], ['program'])
  ];
  await fs.writeFile(contextFile, JSON.stringify(initial, null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `strut-rollback-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some((error) => (
    error.code === 'ATOM_PROGRAM_FAILED' && error.type === 'KeyError'
  )), JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, 'Source').situation, 'before');
});

test('a rolled-back multi-subscriber delivery releases every claim for a complete retry', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = atom('Source', 'before', [], [{
    'if@current': true,
    if: [{ 'thing@program': 'Predicate' }],
    then: [{ thing: 'Result' }]
  }]);
  const initial = [
    source,
    atom('Result', 'before'),
    atom('Predicate', 'def main(arguments):\n    return True', [], [], ['program']),
    atom('ApplySubscriber', [
      'def receive(delivery):',
      '    transform({"thing":"Result","situation.rep.after":"before"})',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), [], [], ['program']),
    atom('TransientSubscriber', [
      'def receive(delivery):',
      '    return {"accepted": delivery["decision"]}',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), [], [], ['program'])
  ];
  await fs.writeFile(contextFile, JSON.stringify(initial, null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let failTransientOnce = true;
  let applyCalls = 0;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'ApplySubscriber' && request.programArguments?.mode === 'strut') {
      applyCalls += 1;
    }
    if (request.program.path === 'TransientSubscriber'
      && request.programArguments?.mode === 'strut'
      && failTransientOnce) {
      failTransientOnce = false;
      throw Object.assign(new Error('transient subscriber failure'), { code: 'TRANSIENT_FAILURE' });
    }
    return runProgram(request);
  };
  const command = 'transform {"thing":"Source","situation.rep.after":"before"}';

  const failed = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler, source: command,
    interaction: { id: `strut-retry-fail-${crypto.randomUUID()}` }
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Result').situation, 'before');

  const retried = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler, source: command,
    interaction: { id: `strut-retry-pass-${crypto.randomUUID()}` }
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Result').situation, 'after');
  assert.equal(applyCalls, 2);
});

test('a strut subscriber effect rejected after worker success releases its claim for retry', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-effect-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = atom('Source', 'before', [], [{
    'if@current': true,
    if: [{ 'thing@program': 'Predicate' }],
    then: [{ thing: 'Result' }]
  }]);
  await fs.writeFile(contextFile, JSON.stringify([
    source,
    atom('Result', 'before'),
    atom('Predicate', 'def main(arguments):\n    return True', [], [], ['program']),
    atom('ApplySubscriber', [
      'def receive(delivery):',
      '    transform({"thing":"Result","situation.rep.after":"before"})',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), [], [], ['program'])
  ], null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let replaceEffectOnce = true;
  let calls = 0;
  scheduler.runProgram = async (request) => {
    const result = await runProgram(request);
    if (request.program.path === 'ApplySubscriber' && request.programArguments?.mode === 'strut') {
      calls += 1;
      if (replaceEffectOnce) {
        replaceEffectOnce = false;
        return {
          ...result,
          transforms: [{ thing: 'Missing', 'situation.rep.after': 'before' }]
        };
      }
    }
    return result;
  };
  const command = 'transform {"thing":"Source","situation.rep.after":"before"}';

  const failed = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler, source: command,
    interaction: { id: `strut-effect-fail-${crypto.randomUUID()}` }
  });
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Source').situation, 'before');

  const retried = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler, source: command,
    interaction: { id: `strut-effect-pass-${crypto.randomUUID()}` }
  });
  assert.equal(retried.ok, true, JSON.stringify(retried));
  assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Result').situation, 'after');
  assert.equal(calls, 2);
});

test('a successful no-op source Transform confirms message-only strut delivery without hanging', { timeout: 4000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-noop-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = atom('Source', 'before', [], [{
    'if@current': true,
    if: [{ 'thing@program': 'Predicate' }],
    then: [{ thing: 'Result' }]
  }]);
  await fs.writeFile(contextFile, JSON.stringify([
    source,
    atom('Result'),
    atom('Predicate', 'def main(arguments):\n    return True', [], [], ['program']),
    atom('MessageSubscriber', [
      'def receive(delivery):',
      '    message({"level":"info","text":"delivered"})',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), [], [], ['program'])
  ], null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const command = 'transform {"thing":"Source","situation.rep.before":"before"}';

  const first = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler, source: command,
    interaction: { id: `strut-noop-first-${crypto.randomUUID()}` }
  });
  const second = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler, source: command,
    interaction: { id: `strut-noop-second-${crypto.randomUUID()}` }
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.messages.map(({ text }) => text), ['delivered']);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(second.messages, []);
});
