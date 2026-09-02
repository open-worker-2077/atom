import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProgramRuntimeScheduler,
  validateProgramResult
} from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function program(path, situation, slot = []) {
  const names = path.split('/');
  let value = atom(names.pop(), situation, slot, 'program');
  while (names.length) value = atom(names.pop(), '', [value]);
  return value;
}

function receiver(from, labels, match = 'all') {
  return [
    'def receive():',
    '    notice = signal()',
    '    message({"level":"info","text":notice["from"] + ":" + ",".join(notice["labels"])})',
    `trigger("slot", {"from":"${from}","labels":${JSON.stringify(labels)},"match":"${match}"}, receive)`
  ].join('\n');
}

function delivery(id, recipientPath, from, labels) {
  return {
    mode: 'slot', id, revision: 'sha256:r1', sourcePath: 'Sender', recipientPath, from, labels
  };
}

function slotEvent(signals) {
  return {
    mode: 'slot', nodes: [...new Set(signals.map(({ recipientPath }) => recipientPath))], signals
  };
}

test('slot trigger declares receiver-owned labels without nodes', async () => {
  const world = [program('Root/Receiver', [
    'def receive():',
    '    notice = signal()',
    'trigger("slot", {"from":"up","labels":["状态上报"]}, receive)'
  ].join('\n'))];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);
  assert.deepEqual(scheduler.triggerContracts.get('Root/Receiver').contract, {
    mode: 'slot',
    parameters: { from: 'up', labels: ['状态上报'], match: 'all' },
    entrypoint: 'receive'
  });
});

test('slot effect contains direction and labels but no destination', async () => {
  const cycle = await createProgramRuntimeScheduler().refresh([
    program('Sender', 'slot({"to":"down","labels":["受伤通告","紧急"]})')
  ], { programSelector: 'Sender', force: true });
  assert.deepEqual(cycle.slotSignals, [{
    sourceProgramPath: 'Sender', to: 'down', labels: ['受伤通告', '紧急']
  }]);
});

test('slot trigger source validation rejects positional-only and keyword-only callback parameters', async () => {
  for (const signature of ['value, /', '*, value']) {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.validateProgramSources([program('Receiver', [
        `def receive(${signature}):`,
        '    signal()',
        'trigger("slot", {"from":"up","labels":["A"]}, receive)'
      ].join('\n'))]),
      (error) => error?.code === 'ATOM_PROGRAM_FAILED'
        && /slot entrypoint must accept no arguments/u.test(error.message)
    );
  }
});

test('cached producers never replay slot signals and mixed cycles include only uncached producers', async () => {
  const calls = [];
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program: source }) => {
      calls.push(source.path);
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [],
        slotSignals: [{ sourceProgramPath: source.path, to: 'up', labels: [source.detail] }],
        choices: [], jumps: [], jumpAuthorizations: [], agentRegistrations: [],
        changedThings: [], trigger: null
      };
    }
  });
  const firstWorld = [program('A', 'a-v1'), program('B', 'b-v1')];
  const cold = await scheduler.refresh(firstWorld);
  const cached = await scheduler.refresh(firstWorld);
  const mixed = await scheduler.refresh([program('A', 'a-v1'), program('B', 'b-v2')]);

  assert.deepEqual(cold.slotSignals.map(({ sourceProgramPath }) => sourceProgramPath), ['A', 'B']);
  assert.deepEqual(cached.slotSignals, []);
  assert.deepEqual(mixed.slotSignals, [{
    sourceProgramPath: 'B', to: 'up', labels: ['b-v2']
  }]);
  assert.deepEqual(calls.sort(), ['A', 'B', 'B']);
});

test('slot effects reject a non-array Python effect envelope', () => {
  assert.throws(() => validateProgramResult(
    { ok: true, slotSignals: {} },
    [{ ref: 'sender', path: 'Sender', types: ['program'] }],
    { ref: 'sender', path: 'Sender' }
  ), { code: 'INVALID_SLOT_SIGNAL_EFFECT' });
});

test('all and exact match independently on the receiver path', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    program('Root/All', receiver('up', ['A'], 'all')),
    program('Root/Exact', receiver('up', ['A'], 'exact')),
    program('Other', receiver('up', ['A'], 'all'))
  ];
  await scheduler.refresh(world);
  const cycle = await scheduler.refresh(world, { triggerEvent: slotEvent([
    delivery('s1', 'Root/All', 'up', ['A', 'B']),
    delivery('s2', 'Root/Exact', 'up', ['A', 'B'])
  ]) });
  assert.deepEqual(cycle.messages.map(({ text }) => text), ['up:A,B']);
  assert.deepEqual(cycle.executedProgramPaths, ['Root/All']);
});

test('signal context is invocation-local during concurrent refreshes', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [program('Receiver', receiver('up', ['A'], 'all'))];
  await scheduler.refresh(world);
  const cycles = await Promise.all([
    scheduler.refresh(world, { triggerEvent: slotEvent([delivery('s1', 'Receiver', 'up', ['A'])]) }),
    scheduler.refresh(world, { triggerEvent: slotEvent([delivery('s2', 'Receiver', 'up', ['A', 'B'])]) })
  ]);
  assert.deepEqual(cycles.flatMap((cycle) => cycle.messages.map(({ text }) => text)).sort(), [
    'up:A', 'up:A,B'
  ]);
});

test('one slot signal executes its receiver once across duplicate, sequential, and concurrent refreshes', async () => {
  const world = [program('Receiver', receiver('up', ['A'], 'all'))];
  const signal = delivery('s1', 'Receiver', 'up', ['A']);
  const event = slotEvent([signal, structuredClone(signal)]);

  const sequential = createProgramRuntimeScheduler();
  await sequential.refresh(world);
  const first = await sequential.refresh(world, { triggerEvent: event });
  sequential.confirmSlotSignals(first.slotSignalClaims);
  const second = await sequential.refresh(world, { triggerEvent: event });
  assert.deepEqual(first.messages.map(({ text }) => text), ['up:A']);
  assert.deepEqual(second.messages, []);

  const concurrent = createProgramRuntimeScheduler();
  await concurrent.refresh(world);
  const firstConcurrent = concurrent.refresh(world, { triggerEvent: event });
  const secondConcurrent = concurrent.refresh(world, { triggerEvent: event });
  const firstCycle = await firstConcurrent;
  concurrent.confirmSlotSignals(firstCycle.slotSignalClaims);
  const cycles = [firstCycle, await secondConcurrent];
  assert.equal(cycles.flatMap((cycle) => cycle.messages).length, 1);
});

test('a failed slot receiver is blocking and releases its signal claim for retry', async () => {
  const world = [program('Receiver', [
    'def receive():',
    '    signal()',
    '    message("receiver failed")',
    'trigger("slot", {"from":"up","labels":["A"]}, receive)'
  ].join('\n'))];
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let calls = 0;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Receiver' && request.programArguments?.mode === 'slot') calls += 1;
    return runProgram(request);
  };
  await scheduler.refresh(world, { isolateFailures: true });
  const options = {
    isolateFailures: true,
    triggerEvent: slotEvent([delivery('s1', 'Receiver', 'up', ['A'])])
  };

  const first = await scheduler.refresh(world, options);
  const second = await scheduler.refresh(world, options);
  assert.equal(first.failures[0]?.blocking, true);
  assert.equal(second.failures[0]?.blocking, true);
  assert.equal(calls, 2);
});

test('a context-dependent slot result filtered without Agent scope releases its signal claim', async () => {
  const subscriber = program('Subscriber', [
    'def receive():',
    '    signal()',
    '    explore({"thing":"./Result"})',
    '    message({"level":"info","text":"filtered"})',
    'trigger("slot", {"from":"up","labels":["A"]}, receive)'
  ].join('\n'));
  const world = [atom('Result'), subscriber];
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let calls = 0;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Subscriber' && request.programArguments?.mode === 'slot') calls += 1;
    return runProgram(request);
  };
  await scheduler.refresh(world);
  const options = {
    triggerEvent: slotEvent([delivery('s1', 'Subscriber', 'up', ['A'])]),
    executeExplore: async () => []
  };

  assert.deepEqual((await scheduler.refresh(world, options)).messages, []);
  assert.deepEqual((await scheduler.refresh(world, options)).messages, []);
  assert.equal(calls, 2);
});

test('slot trigger events reject fields outside the internal routing contract', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [program('Receiver', receiver('up', ['A'], 'all'))];
  await scheduler.refresh(world);
  await assert.rejects(scheduler.refresh(world, {
    triggerEvent: {
      ...slotEvent([delivery('s1', 'Receiver', 'up', ['A'])]),
      deliveries: []
    }
  }), { code: 'INVALID_PROGRAM_TRIGGER_EVENT' });
});

test('the owning runtime can confirm a slot signal claimed by its candidate runtime', async () => {
  const owner = createProgramRuntimeScheduler();
  const world = [program('Receiver', receiver('up', ['A'], 'all'))];
  await owner.refresh(world);
  const candidate = owner.createCandidateRuntime();
  const event = slotEvent([delivery('s1', 'Receiver', 'up', ['A'])]);

  const first = await candidate.refresh(world, { triggerEvent: event });
  owner.confirmSlotSignals(first.slotSignalClaims);
  const second = await owner.refresh(world, { triggerEvent: event });
  assert.deepEqual(first.messages.map(({ text }) => text), ['up:A']);
  assert.deepEqual(second.messages, []);
});

test('slot routing nodes cannot execute a Program without a matching slot trigger', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [program('Receiver', 'message({"level":"info","text":"unexpected"})')];

  const cycle = await scheduler.refresh(world, {
    triggerEvent: slotEvent([delivery('s1', 'Receiver', 'up', ['A'])])
  });

  assert.deepEqual(cycle.messages, []);
  assert.deepEqual(cycle.executedProgramPaths, []);
});

test('prepared indexes cannot bypass strict slot trigger event validation', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [program('Receiver', receiver('up', ['A'], 'all'))];
  await scheduler.refresh(world, { prepareAllIndexes: true });

  await assert.rejects(scheduler.refresh(world, {
    triggerEvent: {
      mode: 'slot', nodes: [], signals: [], preparedIndexesValid: true
    }
  }), { code: 'INVALID_PROGRAM_TRIGGER_EVENT' });
});
