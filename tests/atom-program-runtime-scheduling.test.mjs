import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return {
    [`thing${type ? `@${type}` : ''}`]: thing,
    situation: situation,
    slot: slot,
    strut: []
  };
}

test('an exact strut subscriber receives one typed true argument while unrelated Programs stay idle', async () => {
  const subscriber = atom('Subscriber', [
    'def receive(delivery):',
    '    message({"level":"info","text":delivery["clauseId"] + ":" + str(delivery["decision"])})',
    'trigger("strut", {"nodes":["Result"]}, receive)'
  ].join('\n'), [], 'program');
  const unrelated = atom('Unrelated', [
    'def receive(delivery):',
    '    message({"level":"info","text":"must-not-run"})',
    'trigger("strut", {"nodes":["Other"]}, receive)'
  ].join('\n'), [], 'program');
  const world = [atom('Result'), atom('Other'), subscriber, unrelated];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);
  const delivery = {
    mode: 'strut', revision: 'sha256:r1', clauseId: 'strut:Source:0', decision: true,
    antecedentPaths: ['Source'], consequentPath: 'Result', consequentOrdinal: 0
  };

  const cycle = await scheduler.refresh(world, {
    triggerEvent: {
      mode: 'strut',
      nodes: ['Result'],
      deliveries: [delivery, structuredClone(delivery)]
    }
  });

  assert.deepEqual(cycle.executedProgramPaths, ['Subscriber']);
  assert.deepEqual(cycle.messages.map(({ text }) => text), ['strut:Source:0:True']);
});

test('one strut delivery executes its direct subscriber once across sequential and concurrent refreshes', async () => {
  const subscriber = atom('Subscriber', [
    'def receive(delivery):',
    '    message({"level":"info","text":delivery["clauseId"]})',
    'trigger("strut", {"nodes":["Result"]}, receive)'
  ].join('\n'), [], 'program');
  const world = [atom('Result'), subscriber];
  const delivery = {
    mode: 'strut', revision: 'sha256:r1', clauseId: 'strut:Source:0', decision: true,
    antecedentPaths: ['Source'], consequentPath: 'Result', consequentOrdinal: 0
  };
  const event = { mode: 'strut', nodes: ['Result'], deliveries: [delivery] };

  const sequential = createProgramRuntimeScheduler();
  await sequential.refresh(world);
  const first = await sequential.refresh(world, { triggerEvent: event });
  sequential.confirmStrutDeliveries(first.strutDeliveryClaims);
  const second = await sequential.refresh(world, { triggerEvent: event });
  assert.deepEqual(first.messages.map(({ text }) => text), ['strut:Source:0']);
  assert.deepEqual(second.messages, []);

  const concurrent = createProgramRuntimeScheduler();
  await concurrent.refresh(world);
  const firstConcurrent = concurrent.refresh(world, { triggerEvent: event });
  const secondConcurrent = concurrent.refresh(world, { triggerEvent: event });
  const firstCycle = await firstConcurrent;
  concurrent.confirmStrutDeliveries(firstCycle.strutDeliveryClaims);
  const cycles = [firstCycle, await secondConcurrent];
  assert.equal(cycles.flatMap((cycle) => cycle.messages).length, 1);
});

test('a context-dependent strut result filtered without Agent scope releases its delivery claim', { timeout: 3000 }, async () => {
  const subscriber = atom('Subscriber', [
    'def receive(delivery):',
    '    explore({"thing":"./Result"})',
    '    message({"level":"info","text":"filtered"})',
    'trigger("strut", {"nodes":["Result"]}, receive)'
  ].join('\n'), [], 'program');
  const world = [atom('Result'), subscriber];
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let calls = 0;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Subscriber' && request.programArguments?.mode === 'strut') calls += 1;
    return runProgram(request);
  };
  await scheduler.refresh(world);
  const delivery = {
    mode: 'strut', revision: 'sha256:r1', clauseId: 'strut:Source:0', decision: true,
    antecedentPaths: ['Source'], consequentPath: 'Result', consequentOrdinal: 0
  };
  const options = {
    triggerEvent: { mode: 'strut', nodes: ['Result'], deliveries: [delivery] },
    executeExplore: async () => []
  };

  assert.deepEqual((await scheduler.refresh(world, options)).messages, []);
  assert.deepEqual((await scheduler.refresh(world, options)).messages, []);
  assert.equal(calls, 2);
});

test('localized strut evaluation reuses only the exact base-revision graph after a structural edit', async () => {
  const source = (consequent) => {
    const value = atom('Source', 'before');
    value.strut = [{
      'if@current': true,
      if: [{ 'thing@program': 'Predicate' }],
      then: [{ thing: consequent }]
    }];
    return value;
  };
  const subscriber = (name, result) => atom(name, [
    'def receive(delivery):',
    `    message({"level":"info","text":"${result}"})`,
    `trigger("strut", {"nodes":["${result}"]}, receive)`
  ].join('\n'), [], 'program');
  const initial = [
    source('OldResult'), atom('OldResult'), atom('NewResult'),
    atom('Predicate', 'def main(arguments):\n    return True', [], 'program'),
    subscriber('OldSubscriber', 'OldResult'), subscriber('NewSubscriber', 'NewResult')
  ];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(initial);

  const structural = structuredClone(initial);
  structural[0] = source('NewResult');
  await scheduler.refresh(structural, {
    triggerEvent: {
      mode: 'transform', nodes: ['Source'], affectedPaths: ['Source'],
      preparedIndexesValid: false, preparedStrutIndexValid: false
    }
  });

  const localized = structuredClone(structural);
  localized[0].situation = 'after';
  const cycle = await scheduler.refresh(localized, {
    triggerEvent: {
      mode: 'transform', nodes: ['Source'], affectedPaths: ['Source'],
      preparedIndexesValid: true, preparedStrutIndexValid: true,
      strutBaseRevision: revisionOfWorldFacts(structural)
    }
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['NewResult']);
  assert.deepEqual(cycle.executedProgramPaths, ['NewSubscriber']);
});

test('an explicit run cannot manufacture a strut delivery', async () => {
  const subscriber = atom('Subscriber', [
    'def receive(delivery):',
    '    message({"level":"info","text":"must-not-run"})',
    'trigger("strut", {"nodes":["Result"]}, receive)'
  ].join('\n'), [], 'program');
  const world = [atom('Result'), subscriber];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);

  const cycle = await scheduler.refresh(world, {
    programSelector: 'Subscriber',
    force: true,
    isolateFailures: true
  });

  assert.equal(cycle.failures.length, 1);
  assert.equal(cycle.failures[0].code, 'STRUT_DELIVERY_REQUIRED');
  assert.deepEqual(cycle.messages, []);
});

test('strut selection consumes exact affected paths instead of a legacy bare result name', async () => {
  const topLevelSource = atom('Leaf', '', [], '');
  topLevelSource.strut = [{
    'if@current': true,
    if: [{ 'thing@program': 'Predicate' }],
    then: [{ thing: 'Result' }]
  }];
  const world = [
    topLevelSource,
    atom('Result'),
    atom('Predicate', 'def main(arguments):\n    return True', [], 'program'),
    atom('Subscriber', [
      'def receive(delivery):',
      '    message({"level":"info","text":"wrong-domain"})',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), [], 'program'),
    atom('Root', '', [atom('Leaf', 'changed')])
  ];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);

  const cycle = await scheduler.refresh(structuredClone(world), {
    triggerEvent: {
      mode: 'transform',
      nodes: ['Root/Leaf', 'Leaf'],
      affectedPaths: ['Root/Leaf'],
      preparedIndexesValid: true,
      preparedStrutIndexValid: true
    }
  });

  assert.deepEqual(cycle.messages, []);
  assert.deepEqual(cycle.executedProgramPaths, []);
});

test('ordinary fact edits reuse the compiled Agent security directory', async () => {
  let inspections = 0;
  const inspectedProgramCounts = [];
  const scheduler = createProgramRuntimeScheduler({
    inspectProgram: async ({ programs, program, agentDeclarationOnly }) => {
      inspections += 1;
      inspectedProgramCounts.push(programs.length);
      if (agentDeclarationOnly && program.path === 'Unrelated Program') {
        return { agentRegistrations: [] };
      }
      return {
        agentRegistrations: [{
          labels: ['^'],
          functionScopes: { groups: [], names: ['explore'] },
          functions: ['explore']
        }]
      };
    }
  });
  const agentProgram = atom(
    'Worker',
    'agent({"labels":["^"],"functions":{"groups":[],"names":["explore"]}})',
    [],
    'program'
  );

  const unrelatedProgram = atom('Unrelated Program', 'pass', [], 'program');
  await scheduler.rebuildAgentSecurity([
    agentProgram, unrelatedProgram, atom('Fact', 'before')
  ]);
  await scheduler.rebuildAgentSecurity([
    structuredClone(agentProgram), structuredClone(unrelatedProgram), atom('Fact', 'after')
  ]);

  assert.equal(inspections, 2);
  assert.deepEqual(inspectedProgramCounts, [1, 1]);
  assert.deepEqual(scheduler.agentSecurity.get('Worker')?.labels, ['^']);
});

test('one mutable world revision shares one prepared record snapshot across index builders', async () => {
  const recordSnapshots = [];
  const scheduler = createProgramRuntimeScheduler({
    inspectProgram: async ({ records, program, agentDeclarationOnly }) => {
      recordSnapshots.push(records);
      if (agentDeclarationOnly) {
        return program.path === 'Worker'
          ? {
              agentRegistrations: [{
                labels: ['^'],
                functionScopes: { groups: [], names: ['explore'] },
                functions: ['explore']
              }]
            }
          : { agentRegistrations: [] };
      }
      return program.path === 'Worker'
        ? {
            agentRegistrations: [{
              labels: ['^'],
              functionScopes: { groups: [], names: ['explore'] },
              functions: ['explore']
            }]
          }
        : {
            locks: [{
              sourceProgramPath: 'Guard',
              targets: { paths: ['Fact'], scope: 'exact' },
              actions: ['explore'],
              labels: ['team']
            }]
          };
    }
  });
  const world = [
    atom(
      'Worker',
      'agent({"labels":["^"],"functions":{"groups":[],"names":["explore"]}})',
      [],
      'program'
    ),
    atom(
      'Guard',
      'lock({"targets":{"paths":["Fact"],"scope":"exact"},"actions":["explore"],"labels":["team"]})',
      [],
      'program'
    ),
    atom('Fact')
  ];

  await scheduler.activeRequestDrivenLocks(world);

  assert.equal(recordSnapshots.length, 3);
  assert.equal(recordSnapshots[0], recordSnapshots[1]);
});

test('prepared runtime indexes are reusable only for the exact authoritative world revision', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = Object.freeze([
    Object.freeze(atom('Fact', 'before'))
  ]);
  await scheduler.refresh(world);

  assert.equal(
    scheduler.hasPreparedIndexesForRevision(revisionOfWorldFacts(world), world),
    true
  );

  const changedWorld = Object.freeze([
    Object.freeze(atom('Fact', 'after'))
  ]);
  assert.equal(
    scheduler.hasPreparedIndexesForRevision(revisionOfWorldFacts(changedWorld), changedWorld),
    false
  );

  const prepared = scheduler.prepareRuntimeRecords(changedWorld);
  await scheduler.installPreparedRuntimeIndexes(changedWorld, prepared);
  assert.equal(
    scheduler.hasPreparedIndexesForRevision(revisionOfWorldFacts(changedWorld), changedWorld),
    true
  );
});

test('a literal path lock below a non-Agent synthetic test root recompiles into the active index', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const root = '世界之外/test/夜巡-lock-index-regression';
  const resultPath = `${root}/RESUME-05/补事实后继续/恢复结果`;
  const world = [atom('test', '', [
    atom('夜巡-lock-index-regression', '', [
      atom('RESUME-05', '', [
        atom('补事实后继续', 'pass', [atom('恢复结果', 'synthetic')], 'program'),
        atom('结果锁定', `lock({"targets":{"paths":["${resultPath}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`, [], 'program')
      ])
    ])
  ])];

  const locks = await scheduler.activeRequestDrivenLocks(world);

  assert.equal(locks.length, 1, JSON.stringify(locks));
  assert.equal(locks[0].kind, 'node');
  assert.equal(locks[0].path, 'test/夜巡-lock-index-regression/RESUME-05/补事实后继续/恢复结果');
  assert.deepEqual(locks[0].actions, ['transform']);
  assert.deepEqual(locks[0].labels, ['^']);
});

test('path changes rebuild request-driven locks while ordinary fact edits reuse them', async () => {
  let inspections = 0;
  const inspectedProgramCounts = [];
  const scheduler = createProgramRuntimeScheduler({
    inspectProgram: async ({ programs, agentDeclarationOnly }) => {
      if (agentDeclarationOnly) return { agentRegistrations: [] };
      inspections += 1;
      inspectedProgramCounts.push(programs.length);
      return {
        locks: [{
          sourceProgramPath: 'Guard',
          targets: { paths: ['Fact'], scope: 'exact' },
          actions: ['explore'],
          labels: ['team']
        }]
      };
    }
  });
  const guard = atom(
    'Guard',
    'lock({"targets":{"paths":["Fact"],"scope":"exact"},"actions":["explore"],"labels":["team"]})',
    [],
    'program'
  );
  const unrelatedProgram = atom('Unrelated Program', 'pass', [], 'program');

  await scheduler.rebuildRequestDrivenLocks([guard, unrelatedProgram, atom('Fact', 'before')]);
  await scheduler.rebuildRequestDrivenLocks([
    structuredClone(guard), structuredClone(unrelatedProgram), atom('Fact', 'after')
  ]);
  assert.equal(inspections, 1);

  await scheduler.rebuildRequestDrivenLocks([
    structuredClone(guard), structuredClone(unrelatedProgram), atom('Fact Moved', 'after')
  ]);
  assert.equal(inspections, 2);
  assert.deepEqual(inspectedProgramCounts, [1, 1]);
});

test('request-driven locks rebuild when an allowed Program path loses its Program type', async () => {
  let inspections = 0;
  const scheduler = createProgramRuntimeScheduler({
    inspectProgram: async ({ agentDeclarationOnly }) => {
      if (agentDeclarationOnly) return { agentRegistrations: [] };
      inspections += 1;
      return {
        locks: [{
          sourceProgramPath: 'Guard',
          targets: { paths: ['Fact'], scope: 'exact' },
          allowed_programs: { paths: ['Scheduler'] },
          mode: 'write',
          fields: ['situation'],
          protect: { atom: true, messages: false }
        }]
      };
    }
  });
  const guard = atom(
    'Guard',
    'lock({"targets":{"paths":["Fact"]},"allowed_programs":{"paths":["Scheduler"]},"mode":"write"})',
    [],
    'program'
  );

  await scheduler.rebuildRequestDrivenLocks([
    guard, atom('Scheduler', 'pass', [], 'program'), atom('Fact')
  ]);
  await scheduler.rebuildRequestDrivenLocks([
    structuredClone(guard), atom('Scheduler'), atom('Fact')
  ]);

  assert.equal(inspections, 2);
});

test('transform trigger runs only Programs whose declared node list intersects the event', async () => {
  const triggeredProgram = (name, monitoredNode, text) => atom(name, [
    'def main():',
    `    message({'level': 'info', 'text': '${text}'})`,
    `trigger('transform', {'nodes': ['${monitoredNode}']}, main)`
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();

  const cycle = await scheduler.refresh([
    atom('A'),
    atom('B'),
    triggeredProgram('A Program', 'A', 'ran-a'),
    triggeredProgram('B Program', 'B', 'ran-b')
  ], {
    triggerEvent: { mode: 'transform', nodes: ['A'] }
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['ran-a']);
  assert.deepEqual(cycle.failures, []);
});

test('a refresh exposes only bounded anonymous reconcile timing summary', async () => {
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      if (program.path === 'Slow Program') await new Promise((resolve) => setTimeout(resolve, 8));
      return { locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [], trigger: null };
    }
  });
  const cycle = await scheduler.refresh([
    atom('Fast Program', 'pass', [], 'program'),
    atom('Slow Program', 'pass', [], 'program')
  ], { force: true });

  assert.deepEqual(Object.keys(cycle.reconcileSummary).sort(), [
    'candidateProgramCount', 'executedProgramCount', 'slowestProgramDurationMs',
    'slowestProgramFingerprint', 'triggerIndexBackfilled'
  ]);
  assert.equal(cycle.reconcileSummary.candidateProgramCount, 2);
  assert.equal(cycle.reconcileSummary.executedProgramCount, 2);
  assert.equal(cycle.reconcileSummary.triggerIndexBackfilled, 0);
  assert.match(cycle.reconcileSummary.slowestProgramFingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(cycle.reconcileSummary.slowestProgramDurationMs >= 0, true);
  assert.equal(JSON.stringify(cycle.reconcileSummary).includes('Slow Program'), false);
});

test('one transform event runs a matching Program once when several monitored nodes match', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const program = atom('Combined Program', [
    'def main():',
    "    message({'level': 'info', 'text': 'ran-once'})",
    "trigger('transform', {'nodes': ['A', 'B']}, main)"
  ].join('\n'), [], 'program');

  const cycle = await scheduler.refresh([
    atom('A'),
    atom('B'),
    program
  ], {
    triggerEvent: { mode: 'transform', nodes: ['A', 'B'] }
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['ran-once']);
});

test('an explicit Program run executes the trigger entrypoint without waiting for a Transform event', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const program = atom('Explicit Trigger Program', [
    'def main():',
    "    message({'level': 'info', 'text': 'explicit-run'})",
    "trigger('transform', {'nodes': ['A']}, main)"
  ].join('\n'), [], 'program');

  const cycle = await scheduler.refresh([atom('A'), program], {
    programSelector: 'Explicit Trigger Program',
    force: true
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['explicit-run']);
});

test('a Transform event bypasses a persisted projection after scheduler restart', async () => {
  let stored = null;
  const projectionRepository = {
    async load() { return structuredClone(stored); },
    async save(value) { stored = structuredClone(value); }
  };
  const world = [
    atom('A'),
    atom('Legacy Unrelated', "message({'level': 'info', 'text': 'legacy-must-not-replay'})", [], 'program'),
    atom('Restart Trigger', [
      'def main():',
      "    message({'level': 'info', 'text': 'cold-start-trigger'})",
      "trigger('transform', {'nodes': ['A']}, main)"
    ].join('\n'), [], 'program')
  ];
  await createProgramRuntimeScheduler({ projectionRepository }).refresh(world);

  const cycle = await createProgramRuntimeScheduler({ projectionRepository }).refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['A'] }
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['cold-start-trigger']);
});

test('a matched Transform trigger does not revalidate cached unrelated Programs', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const legacy = atom('Legacy Reporter', [
    "value = explore({'thing': 'Legacy Input'})[0].situation",
    "message({'level': 'info', 'text': 'legacy:' + value})"
  ].join('\n'), [], 'program');
  const triggered = atom('Indexed Trigger', [
    'def main():',
    "    message({'level': 'info', 'text': 'indexed-only'})",
    "trigger('transform', {'nodes': ['Trigger Input']}, main)"
  ].join('\n'), [], 'program');

  await scheduler.refresh([atom('Legacy Input', 'before'), atom('Trigger Input'), legacy, triggered]);
  const cycle = await scheduler.refresh([
    atom('Legacy Input', 'after'), atom('Trigger Input'),
    structuredClone(legacy), structuredClone(triggered)
  ], {
    triggerEvent: { mode: 'transform', nodes: ['Trigger Input'] }
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['indexed-only']);
});

test('trigger contract discovery isolates an unrelated Program denied by the current window', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const inaccessible = atom('Outside Scope');
  const unrelated = atom('Unrelated Trigger', [
    "outside = explore({'thing': 'Outside Scope'})[0]",
    'changed([outside])'
  ].join('\n'), [], 'program');

  const cycle = await scheduler.refresh([
    atom('Writable Child'), inaccessible, unrelated
  ], {
    triggerEvent: { mode: 'transform', nodes: ['Writable Child'] },
    executeExplore: async () => {
      throw Object.assign(new Error('fixed Agent cannot read outside scope'), {
        code: 'WINDOW_ACCESS_DENIED'
      });
    }
  });

  assert.deepEqual(cycle.executedProgramPaths, []);
  assert.deepEqual(cycle.failures, []);
});

test('literal trigger discovery sends only the declaring Program to its worker', async () => {
  let discoveryProgramCount = null;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, programs, validateOnly }) => {
      if (program.path === 'Trigger' && validateOnly) discoveryProgramCount = programs.length;
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: program.path === 'Trigger'
          ? { mode: 'transform', parameters: { nodes: ['Target'] } }
          : null,
        changedThings: []
      };
    }
  });
  const unrelated = Array.from(
    { length: 100 },
    (_, index) => atom(`Unrelated ${index}`, 'pass', [], 'program')
  );

  await scheduler.refresh([
    atom('Target'),
    atom('Trigger', "trigger('transform', {'nodes': ['Target']}, main)", [], 'program'),
    ...unrelated
  ], { triggerEvent: { mode: 'transform', nodes: ['Target'] } });

  assert.equal(discoveryProgramCount, 1);
});

test('changed discovery without Program reuse sends only the declaring Program to its worker', async () => {
  let discoveryProgramCount = null;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, programs, changedNodes }) => {
      if (program.path === 'Changed' && changedNodes.length === 0) {
        discoveryProgramCount = programs.length;
      }
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: null,
        changedThings: program.path === 'Changed' ? ['Target'] : []
      };
    }
  });
  const unrelated = Array.from(
    { length: 100 },
    (_, index) => atom(`Unrelated ${index}`, 'pass', [], 'program')
  );

  await scheduler.refresh([
    atom('Target'), atom('Changed', 'changed([])', [], 'program'), ...unrelated
  ], { triggerEvent: { mode: 'transform', nodes: ['Target'] } });

  assert.equal(discoveryProgramCount, 1);
});

test('a triggered Program without Program reuse executes with only its own source', async () => {
  let executionProgramCount = null;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, programs, triggered }) => {
      if (program.path === 'Trigger' && triggered) executionProgramCount = programs.length;
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: program.path === 'Trigger'
          ? { mode: 'transform', parameters: { nodes: ['Target'] } }
          : null,
        changedThings: []
      };
    }
  });
  const unrelated = Array.from(
    { length: 100 },
    (_, index) => atom(`Unrelated ${index}`, 'pass', [], 'program')
  );

  await scheduler.refresh([
    atom('Target'),
    atom('Trigger', "trigger('transform', {'nodes': ['Target']}, main)", [], 'program'),
    ...unrelated
  ], { triggerEvent: { mode: 'transform', nodes: ['Target'] } });

  assert.equal(executionProgramCount, 1);
});

test('TC-PERF-AFFECTED-CLOSURE: a warm trigger event counts only indexed candidates', async () => {
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => ({
      locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
      trigger: program.path === 'Trigger'
        ? { mode: 'transform', parameters: { nodes: ['Target'] } }
        : null,
      changedThings: []
    })
  });
  const unrelated = Array.from(
    { length: 100 },
    (_, index) => atom(`Unrelated ${index}`, 'pass', [], 'program')
  );
  const world = [
    atom('Target'),
    atom('Trigger', "trigger('transform', {'nodes': ['Target']}, main)", [], 'program'),
    ...unrelated
  ];
  await scheduler.refresh(world);

  const cycle = await scheduler.refresh(structuredClone(world), {
    triggerEvent: { mode: 'transform', nodes: ['Target'] }
  });

  assert.equal(cycle.reconcileSummary.candidateProgramCount, 1);
  assert.equal(cycle.reconcileSummary.executedProgramCount, 1);
  assert.deepEqual(cycle.executedProgramPaths, ['Trigger']);
});

test('TC-PERF-AFFECTED-CLOSURE: a warm unrelated event returns from prepared indexes', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      executions += 1;
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: program.path === 'Trigger'
          ? { mode: 'transform', parameters: { nodes: ['Watched'] } }
          : null,
        changedThings: []
      };
    }
  });
  const world = [
    atom('Watched'),
    atom('Unrelated'),
    atom('Trigger', "trigger('transform', {'nodes': ['Watched']}, main)", [], 'program')
  ];
  await scheduler.refresh(world);
  executions = 0;

  const cycle = await scheduler.refresh(structuredClone(world), {
    triggerEvent: {
      mode: 'transform', nodes: ['Unrelated'], preparedIndexesValid: true
    }
  });

  assert.equal(executions, 0);
  assert.equal(cycle.reconcileSummary.preparedIndexHit, true);
  assert.equal(cycle.reconcileSummary.candidateProgramCount, 0);
  assert.equal(cycle.reconcileSummary.executedProgramCount, 0);
});

test('TC-PERF-AFFECTED-CLOSURE: prepared indexes preserve explore-read dependency triggers', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    atom('Watched', 'wait'),
    atom('Dependency Watcher', [
      "watched = explore({'thing': 'Watched', 'situation$full': None})[0]",
      "if watched.situation == 'go':",
      "    message({'level': 'info', 'text': 'dependency fired'})"
    ].join('\n'), [], 'program')
  ];
  await scheduler.refresh(world);
  const changed = structuredClone(world);
  changed[0].situation = 'go';

  const cycle = await scheduler.refresh(changed, {
    triggerEvent: {
      mode: 'transform', nodes: ['Watched'], preparedIndexesValid: true
    }
  });

  assert.deepEqual(cycle.executedProgramPaths, ['Dependency Watcher']);
  assert.equal(cycle.messages[0]?.text, 'dependency fired');
});

test('TC-PERF-COLD-INDEX: startup prepares changed dependencies outside request Agent windows', async () => {
  let requestScopedReads = 0;
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    atom('Watched'),
    atom('Unrelated'),
    atom('Scoped Watcher', [
      "watched = explore({'thing': 'Watched'})[0]",
      'def main():',
      "    message({'level': 'info', 'text': 'ran'})",
      'if changed([watched]):',
      '    main()'
    ].join('\n'), [], 'program')
  ];

  await scheduler.refresh(world, {
    prepareAllIndexes: true,
    isolateFailures: true,
    executeExplore: async () => {
      requestScopedReads += 1;
      throw Object.assign(new Error('no request Agent may read Watched'), {
        code: 'WINDOW_ACCESS_DENIED'
      });
    }
  });
  const readsAfterStartup = requestScopedReads;

  const cycle = await scheduler.refresh(structuredClone(world), {
    triggerEvent: {
      mode: 'transform', nodes: ['Unrelated'], preparedIndexesValid: true
    },
    executeExplore: async () => {
      requestScopedReads += 1;
      throw new Error('steady-state dependency discovery must not run');
    }
  });

  assert.equal(scheduler.triggerContractsInitialized, true);
  assert.deepEqual(scheduler.triggerContracts.get('Scoped Watcher')?.changedThings, ['Watched']);
  assert.equal(requestScopedReads, readsAfterStartup);
  assert.equal(cycle.reconcileSummary.preparedIndexHit, true);
  assert.equal(cycle.reconcileSummary.candidateProgramCount, 0);
});

test('TC-PERF-COLD-INDEX: persisted projection cannot bypass startup dependency preparation', async () => {
  let stored = null;
  const projectionRepository = {
    async load() { return structuredClone(stored); },
    async save(value) { stored = structuredClone(value); }
  };
  const world = [
    atom('Watched'),
    atom('Unrelated'),
    atom('Scoped Watcher', [
      "watched = explore({'thing': 'Watched'})[0]",
      'if changed([watched]):',
      '    pass'
    ].join('\n'), [], 'program')
  ];
  await createProgramRuntimeScheduler({ projectionRepository }).refresh(world);
  const restarted = createProgramRuntimeScheduler({ projectionRepository });

  await restarted.refresh(world, {
    prepareAllIndexes: true,
    isolateFailures: true,
    executeExplore: async () => {
      throw Object.assign(new Error('request window is unavailable during startup'), {
        code: 'WINDOW_ACCESS_DENIED'
      });
    }
  });
  const cycle = await restarted.refresh(structuredClone(world), {
    triggerEvent: {
      mode: 'transform', nodes: ['Unrelated'], preparedIndexesValid: true
    }
  });

  assert.equal(restarted.triggerContractsInitialized, true);
  assert.deepEqual(restarted.triggerContracts.get('Scoped Watcher')?.changedThings, ['Watched']);
  assert.equal(cycle.reconcileSummary.preparedIndexHit, true);
});

test('TC-PERF-AFFECTED-CLOSURE: a missing trigger index backfills from compiled contracts without unrelated execution', async () => {
  const executions = [];
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, triggered }) => {
      if (triggered) executions.push(program.path);
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: program.path === 'Trigger'
          ? { mode: 'transform', parameters: { nodes: ['Target'] } }
          : null,
        changedThings: []
      };
    }
  });
  const world = [
    atom('Target'),
    atom('Trigger', "trigger('transform', {'nodes': ['Target']}, main)", [], 'program'),
    ...Array.from({ length: 100 }, (_, index) => atom(`Unrelated ${index}`, 'pass', [], 'program'))
  ];
  await scheduler.refresh(world);
  scheduler.triggerIndex.clear();

  const cycle = await scheduler.refresh(structuredClone(world), {
    triggerEvent: { mode: 'transform', nodes: ['Target'] }
  });

  assert.equal(cycle.reconcileSummary.triggerIndexBackfilled, 1);
  assert.equal(cycle.reconcileSummary.candidateProgramCount, 1);
  assert.deepEqual(executions, ['Trigger']);
});

test('a denied trigger contract is retried under a later authorized Agent context', async () => {
  const scheduler = createProgramRuntimeScheduler();
  let deniedContractInspections = 0;
  const watched = atom('Watched');
  const program = atom('Scoped Trigger', [
    "watched = explore({'thing': 'Watched'})[0]",
    'def main():',
    "    message({'level': 'info', 'text': 'ran'})",
    'if changed([watched]):',
    '    main()'
  ].join('\n'), [], 'program');
  const agentSource = 'agent({"labels":[],"functions":{"groups":[],"names":["changed","explore","message"]}})';
  const world = [atom('Root', '', [
    atom('Denied Window', agentSource, [], 'program'),
    atom('Authorized Window', agentSource, [], 'program'),
    watched,
    program
  ])];

  await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['Root/Watched'] },
    agentOrigin: { path: 'Root/Denied Window' },
    executeExplore: async () => {
      deniedContractInspections += 1;
      throw Object.assign(new Error('fixed Agent cannot read outside scope'), {
        code: 'WINDOW_ACCESS_DENIED'
      });
    }
  });

  assert.equal(scheduler.triggerContracts.has('Scoped Trigger'), false);
  await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['Root/Watched'] },
    agentOrigin: { path: 'Root/Denied Window' },
    executeExplore: async () => {
      deniedContractInspections += 1;
      throw Object.assign(new Error('fixed Agent cannot read outside scope'), {
        code: 'WINDOW_ACCESS_DENIED'
      });
    }
  });
  assert.equal(deniedContractInspections, 1);
  const authorized = await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['Root/Watched'] },
    agentOrigin: { path: 'Root/Authorized Window' },
    executeExplore: async () => [{ path: 'Root/Watched' }]
  });

  assert.equal(deniedContractInspections, 1);
  assert.deepEqual(authorized.executedProgramPaths, ['Root/Scoped Trigger']);
  assert.deepEqual(authorized.messages.map(({ text }) => text), ['ran']);
});

test('a deferred contract does not rediscover already indexed Programs in the same context', async () => {
  let healthyDiscoveries = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, changedNodes }) => {
      if (program.path === 'Deferred Trigger' && changedNodes.length === 0) {
        throw Object.assign(new Error('fixed Agent cannot read outside scope'), {
          code: 'WINDOW_ACCESS_DENIED'
        });
      }
      if (program.path === 'Healthy Trigger' && changedNodes.length === 0) {
        healthyDiscoveries += 1;
      }
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: null,
        changedThings: program.path === 'Healthy Trigger' ? ['Writable Child'] : []
      };
    }
  });
  const world = [
    atom('Writable Child'),
    atom('Healthy Trigger', 'changed([])', [], 'program'),
    atom('Deferred Trigger', 'changed([])', [], 'program')
  ];
  const request = {
    triggerEvent: { mode: 'transform', nodes: ['Writable Child'] },
    agentOrigin: { path: 'Root/Denied Window' }
  };

  await scheduler.refresh(world, request);
  await scheduler.refresh(world, request);

  assert.equal(healthyDiscoveries, 1);
});

test('trigger contract discovery keeps invalid Program failures visible', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const invalid = atom('Invalid Trigger', 'changed([)', [], 'program');

  await assert.rejects(
    scheduler.refresh([atom('Writable Child'), invalid], {
      triggerEvent: { mode: 'transform', nodes: ['Writable Child'] }
    }),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
  );
});

test('a trigger-scoped cycle cannot replace the reusable full-world projection after a Program is added', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const seed = atom('Seed Program', "message({'level': 'info', 'text': 'seed'})", [], 'program');
  const target = atom('Protected Target');
  const lockProgram = atom('New Lock Program', [
    "target = explore({'thing': 'Protected Target'})[0]",
    "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['thing'], 'reason': {'code': 'NEW_PROGRAM_LOCK', 'message': 'new Program lock'}})"
  ].join('\n'), [], 'program');

  await scheduler.refresh([target, seed]);
  const expandedWorld = [structuredClone(target), structuredClone(seed), lockProgram];
  const triggered = await scheduler.refresh(expandedWorld, {
    triggerEvent: { mode: 'transform', nodes: ['Seed Program'] }
  });
  assert.equal(triggered.locks.length, 0);

  const complete = await scheduler.refresh(expandedWorld);

  assert.deepEqual(complete.executedProgramPaths, ['New Lock Program']);
  assert.equal(complete.locks[0].reason.code, 'NEW_PROGRAM_LOCK');
});

test('an unmatched Transform event does not revalidate unrelated Programs', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const legacy = atom('Legacy Reporter', [
    "value = explore({'thing': 'Legacy Input'})[0].situation",
    "message({'level': 'info', 'text': 'legacy:' + value})"
  ].join('\n'), [], 'program');
  const triggered = atom('Indexed Trigger', [
    'def main():',
    "    message({'level': 'info', 'text': 'indexed-only'})",
    "trigger('transform', {'nodes': ['Trigger Input']}, main)"
  ].join('\n'), [], 'program');

  await scheduler.refresh([atom('Legacy Input', 'before'), atom('Unrelated'), legacy, triggered]);
  const cycle = await scheduler.refresh([
    atom('Legacy Input', 'after'), atom('Unrelated'),
    structuredClone(legacy), structuredClone(triggered)
  ], {
    triggerEvent: { mode: 'transform', nodes: ['Unrelated'] }
  });

  assert.equal(cycle.cached, true);
  assert.deepEqual(cycle.messages, []);
  assert.deepEqual(cycle.executedProgramPaths, []);
});

test('editing a Program still runs that Program for the matching event', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const before = atom('Legacy Reporter', "message({'level': 'info', 'text': 'before'})", [], 'program');
  const after = atom('Legacy Reporter', "message({'level': 'info', 'text': 'after'})", [], 'program');

  await scheduler.refresh([before]);
  const cycle = await scheduler.refresh([after], {
    triggerEvent: { mode: 'transform', nodes: ['Legacy Reporter'] }
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['after']);
  assert.deepEqual(cycle.executedProgramPaths, ['Legacy Reporter']);
});

test('a cold scheduler does not replay an untriggered effect for an unrelated Transform', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('Unrelated', 'changed'),
    atom('Legacy Printer', "slot_body({'action':'print','body':'订单槽体','name':'订单001'})", [], 'program')
  ], {
    triggerEvent: { mode: 'transform', nodes: ['Unrelated'] }
  });

  assert.deepEqual(cycle.slotBodies, []);
  assert.deepEqual(cycle.executedProgramPaths, []);
});

test('trigger rejects eager main invocation instead of executing during contract registration', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const program = atom('Invalid Trigger Program', [
    'def main():',
    "    message({'level': 'info', 'text': 'must-not-run'})",
    "trigger('transform', {'nodes': ['A']}, main())"
  ].join('\n'), [], 'program');

  await assert.rejects(
    scheduler.validateProgramSources([atom('A'), program]),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && /function reference, not a call/u.test(error.message)
  );
});

test('concurrent refreshes for one world revision share one cycle and deliver its message once', async () => {
  const world = [
    atom('Program', "message({'level': 'info', 'text': 'delivered-once'})", [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler();

  const [left, right] = await Promise.all([
    scheduler.refresh(world),
    scheduler.refresh(structuredClone(world))
  ]);

  assert.equal(left.fingerprint, right.fingerprint);
  assert.equal([left, right].filter((cycle) => cycle.cached === false).length, 1);
  assert.equal(left.messages.length + right.messages.length, 1);
  assert.equal([...left.messages, ...right.messages][0].text, 'delivered-once');
});

test('a completed revision reuses lock projection without replaying an old message', async () => {
  const world = [
    atom('Target'),
    atom('Program', [
      "target = explore({'thing': 'Target'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write'})",
      "message({'level': 'info', 'text': 'projection-computed'})"
    ].join('\n'), [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler();

  const first = await scheduler.refresh(world);
  const cached = await scheduler.refresh(structuredClone(world));

  assert.equal(first.cached, false);
  assert.equal(first.messages.length, 1);
  assert.equal(first.locks.length, 1);
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.messages, []);
  assert.deepEqual(cached.locks, first.locks);
});

test('a changed world revision recomputes Programs instead of reusing the previous result', async () => {
  const program = atom('Reporter', [
    "value = explore({'thing': 'Input'})[0].situation",
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();

  const first = await scheduler.refresh([atom('Input', '41'), program]);
  const changed = await scheduler.refresh([atom('Input', '42'), structuredClone(program)]);

  assert.equal(first.cached, false);
  assert.equal(changed.cached, false);
  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.equal(changed.messages[0].text, '42');
});

test('a supplied undeclared origin cannot call registered Program functions while no context remains context-free', async () => {
  const world = [atom('Reporter', "message({'level':'info','text':'ran'})", [], 'program')];
  const unknownOrigin = await createProgramRuntimeScheduler().refresh(structuredClone(world), {
    agentOrigin: { ref: 'unknown-ref', path: 'Unknown Origin' }, isolateFailures: true
  });
  const contextFree = await createProgramRuntimeScheduler().refresh(structuredClone(world), {
    isolateFailures: true
  });

  assert.equal(unknownOrigin.failures[0].code, 'PROGRAM_FUNCTION_DENIED');
  assert.deepEqual(contextFree.messages.map(({ text }) => text), ['ran']);
});

test('derived Agent Program cache keys reuse child Program results across an unrelated revision', async () => {
  const agentSource = 'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})';
  const world = (unrelated) => [
    atom('Agent', agentSource, [
      atom('Child', "message({'level':'info','text':'child-ran'})", [], 'program')
    ], 'program'),
    atom('Unrelated', unrelated)
  ];
  const scheduler = createProgramRuntimeScheduler();
  const first = await scheduler.refresh(world('before'));
  const reused = await scheduler.refresh(world('after'));

  assert.deepEqual(first.messages.map(({ text }) => text), ['child-ran']);
  assert.equal(reused.cached, true);
  assert.deepEqual(reused.messages, []);
});

test('an unrelated fact change reuses Program results without replaying the Program', async () => {
  const program = atom('Target Reporter', [
    "value = explore({'thing': 'Target'})[0].situation",
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();

  const first = await scheduler.refresh([
    atom('Target', 'stable'),
    atom('Unrelated', 'before'),
    program
  ]);
  const unrelatedChange = await scheduler.refresh([
    atom('Target', 'stable'),
    atom('Unrelated', 'after'),
    structuredClone(program)
  ]);

  assert.equal(first.messages[0].text, 'stable');
  assert.equal(unrelatedChange.cached, true);
  assert.deepEqual(unrelatedChange.messages, []);
});

test('cached Program locks are rebound to the current world revision', async () => {
  const program = atom('Target Guard', [
    "target = explore({'thing': 'Target'})[0]",
    "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['situation']})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();

  const first = await scheduler.refresh([
    atom('Target', 'stable'),
    atom('Unrelated', 'before'),
    program
  ]);
  const unrelatedChange = await scheduler.refresh([
    atom('Target', 'stable'),
    atom('Unrelated', 'after'),
    structuredClone(program)
  ]);

  assert.equal(unrelatedChange.cached, true);
  assert.equal(unrelatedChange.locks.length, 1);
  assert.notEqual(unrelatedChange.locks[0].targets.refs[0], first.locks[0].targets.refs[0]);
  assert.equal(unrelatedChange.records.some((record) => record.ref === unrelatedChange.locks[0].targets.refs[0] && record.path === 'Target'), true);
});

test('a changed dependency reruns only the Program that reads it', async () => {
  const leftProgram = atom('Left Reporter', [
    "value = explore({'thing': 'Left'})[0].situation",
    "message({'level': 'info', 'text': 'left:' + value})"
  ].join('\n'), [], 'program');
  const rightProgram = atom('Right Reporter', [
    "value = explore({'thing': 'Right'})[0].situation",
    "message({'level': 'info', 'text': 'right:' + value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();

  await scheduler.refresh([atom('Left', '1'), atom('Right', '1'), leftProgram, rightProgram]);
  const changed = await scheduler.refresh([
    atom('Left', '2'), atom('Right', '1'),
    structuredClone(leftProgram), structuredClone(rightProgram)
  ]);

  assert.deepEqual(changed.messages.map((message) => message.text), ['left:2']);
});

test('one failed Program is isolated while healthy Program effects survive the same refresh', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    atom('Target'),
    atom('Broken Program', "raise ValueError('broken on purpose')", [], 'program'),
    atom('Healthy Program', [
      "target = explore({'thing': 'Target'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['situation']})",
      "message({'level': 'info', 'text': 'healthy survived'})"
    ].join('\n'), [], 'program')
  ];

  const cycle = await scheduler.refresh(world, { isolateFailures: true });

  assert.equal(cycle.locks.length, 1);
  assert.equal(cycle.messages[0].text, 'healthy survived');
  assert.equal(cycle.failures.length, 1);
  assert.equal(cycle.failures[0].programPath, 'Broken Program');
  assert.equal(cycle.failures[0].code, 'ATOM_PROGRAM_FAILED');
});

test('Programs nested below the typed default backup are not executed', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 500 });
  const cycle = await scheduler.refresh([
    atom('Default Backup', '', [
      atom('Archive', '', [
        atom('Broken Archived Program', 'if', [], 'program')
      ])
    ], 'backup@default'),
    atom('Active Program', "message({'level': 'info', 'text': 'active'})", [], 'program')
  ], { isolateFailures: true });

  assert.deepEqual(cycle.failures, []);
  assert.deepEqual(cycle.messages.map((message) => message.text), ['active']);
});

test('use_program cannot execute a Program stored below the default backup', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('Default Backup', '', [
      atom('Archived Library', [
        'def main(arguments):',
        "    return {'value': 'archived'}"
      ].join('\n'), [], 'program')
    ], 'backup@default'),
    atom('Active Caller', [
      "result = use_program({'name': 'Default Backup/Archived Library', 'arguments': {}})",
      "message({'level': 'info', 'text': result['value']})"
    ].join('\n'), [], 'program')
  ], { isolateFailures: true });

  assert.deepEqual(cycle.messages, []);
  assert.equal(cycle.failures.length, 1);
  assert.equal(cycle.failures[0].programPath, 'Active Caller');
  assert.match(cycle.failures[0].message, /Referenced Program not found/u);
});

test('a Program becomes executable again after it is restored outside the default backup', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('Default Backup', '', [], 'backup@default'),
    atom('Restored Program', "message({'level': 'info', 'text': 'restored'})", [], 'program')
  ]);

  assert.deepEqual(cycle.messages.map((message) => message.text), ['restored']);
});

test('multiple typed default backup roots fail explicitly instead of disabling multiple subtrees', async () => {
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(scheduler.refresh([
    atom('Default Backup A', '', [
      atom('Archived A', "message({'level': 'info', 'text': 'A'})", [], 'program')
    ], 'backup@default'),
    atom('Default Backup B', '', [
      atom('Archived B', "message({'level': 'info', 'text': 'B'})", [], 'program')
    ], 'backup@default')
  ]), { code: 'AMBIGUOUS_DEFAULT_BACKUP' });
});

test('Program cycles default to a ten-second wall-clock budget', () => {
  const scheduler = createProgramRuntimeScheduler();

  assert.equal(scheduler.timeoutMs, 10_000);
  assert.equal(scheduler.maxWorkers, 16);
});

test('one immutable world revision reuses its prepared Program records', async () => {
  let detailReads = 0;
  const program = {
    'thing@program': 'Cached Program',
    get detail() {
      detailReads += 1;
      return "message({'level': 'info', 'text': 'cached'})";
    },
    children: Object.freeze([]),
    partners: Object.freeze([])
  };
  Object.freeze(program);
  const world = Object.freeze([program]);
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => ({
      locks: [], messages: [], transforms: [], choices: [], trigger: null
    })
  });

  await scheduler.refresh(world);
  const readsAfterFirst = detailReads;
  await scheduler.refresh(world);

  assert.equal(detailReads, readsAfterFirst);
});

test('one immutable large-world revision reuses its Program cycle fingerprint', async () => {
  const freezeAtom = (value) => Object.freeze({
    ...value,
    children: Object.freeze(value.slot ?? []),
    partners: Object.freeze(value.strut ?? [])
  });
  const world = Object.freeze(Array.from({ length: 10_000 }, (_, index) => freezeAtom(
    atom(`Fact ${index}`, 'x'.repeat(1_000))
  )));
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);

  const startedAt = performance.now();
  const cached = await scheduler.refresh(world);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(cached.cached, true);
  assert.ok(elapsedMs < 30, `cached Program fingerprint took ${elapsedMs}ms`);
});

test('a revision-local Agent ref change does not replay Programs for the same context path', async () => {
  const program = atom('Context Reporter', [
    "value = explore({'thing': 'Agent/Status'})[0].situation",
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();
  const agent = () => atom('Agent',
    'agent({"labels":[],"functions":{"groups":[],"names":["explore","message"]}})',
    [atom('Status', 'stable')],
    'program'
  );

  const first = await scheduler.refresh([
    agent(),
    atom('Unrelated', 'before'),
    program
  ], { agentOrigin: { ref: 'revision-one-ref', path: 'Agent' } });
  const unrelatedChange = await scheduler.refresh([
    agent(),
    atom('Unrelated', 'after'),
    structuredClone(program)
  ], { agentOrigin: { ref: 'revision-two-ref', path: 'Agent' } });

  assert.equal(first.messages[0].text, 'stable');
  assert.equal(unrelatedChange.cached, true);
  assert.deepEqual(unrelatedChange.messages, []);
});

test('scheduler distinguishes Agent cycles while reusing context-independent Program results', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('No Program')];
  const first = await scheduler.refresh(world, { agentOrigin: { ref: 'agent-a', path: 'A/Agent' } });
  const second = await scheduler.refresh(world, { agentOrigin: { ref: 'agent-b', path: 'B/Agent' } });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("an Agent cycle executes only Programs owned by that Agent", async () => {
  const executed = [];
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      executed.push(program.path);
      if (program.path === 'Outer/Outer Jump Program') {
        throw Object.assign(new Error('Program cycle exceeded 2266ms'), {
          code: 'ATOM_PROGRAM_TIMEOUT'
        });
      }
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: null
      };
    }
  });
  const world = [
    atom('Outer', 'agent({"labels":[],"functions":{"groups":[],"names":["jump"]}})', [
      atom('Outer Jump Program', "jump({'thing':'Outer'})", [], 'program'),
      atom('Inner', 'agent({"labels":[],"functions":{"groups":[],"names":["jump"]}})', [
        atom('Inner Jump Program', "jump({'thing':'Inner'})", [], 'program')
      ], 'program')
    ], 'program')
  ];

  const cycle = await scheduler.refresh(world, {
    agentOrigin: { ref: 'inner-agent-ref', path: 'Outer/Inner' },
    force: true,
    isolateFailures: true
  });

  assert.deepEqual(executed.filter((programPath) => programPath.endsWith('Jump Program')), ['Outer/Inner/Inner Jump Program']);
  assert.deepEqual(cycle.failures, []);
});

test('Programs with explicit explore anchors are reused across Agent context paths', async () => {
  const program = atom('Explicit Reporter', [
    "value = explore({'thing': 'Target'})[0].situation",
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();
  const agentSource = 'agent({"labels":[],"functions":{"groups":[],"names":["explore","message"]}})';
  const world = [
    atom('A', '', [atom('Agent', agentSource, [], 'program')]),
    atom('B', '', [atom('Agent', agentSource, [], 'program')]),
    atom('Target', 'stable'),
    program
  ];
  let dependencyReads = 0;
  const executeExplore = async (request) => {
    dependencyReads += 1;
    return [{ path: request.thing }];
  };

  const first = await scheduler.refresh(world, {
    agentOrigin: { ref: 'agent-a', path: 'A/Agent' }, executeExplore
  });
  const readsAfterFirstCycle = dependencyReads;
  const second = await scheduler.refresh(structuredClone(world), {
    agentOrigin: { ref: 'agent-b', path: 'B/Agent' }, executeExplore
  });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.messages, []);
  assert.equal(dependencyReads, readsAfterFirstCycle);
});

test('independent Program dependency queries are revalidated concurrently', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const programs = ['A', 'B', 'C', 'D'].map((name) => atom(`${name} Reporter`, [
    `value = explore({'thing': '${name}'})[0].situation`,
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program'));
  const world = [
    atom('A', 'a'), atom('B', 'b'), atom('C', 'c'), atom('D', 'd'),
    atom('Unrelated', 'before'), ...programs
  ];
  let active = 0;
  let maxActive = 0;
  let measure = false;
  const executeExplore = async (request) => {
    if (measure) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
    }
    return [{ path: request.thing }];
  };

  await scheduler.refresh(world, { executeExplore });
  measure = true;
  const changed = await scheduler.refresh([
    atom('A', 'a'), atom('B', 'b'), atom('C', 'c'), atom('D', 'd'),
    atom('Unrelated', 'after'), ...structuredClone(programs)
  ], { executeExplore });

  assert.equal(changed.cached, true);
  assert.ok(maxActive > 1, `expected concurrent dependency reads, observed ${maxActive}`);
});

test('many Programs inspect a large world without copying every fact into every worker', async () => {
  const facts = [atom('Target', 'stable')];
  for (let index = 0; index < 10_000; index += 1) {
    facts.push(atom(`Fact ${index}`, 'x'.repeat(1_000)));
  }
  for (let index = 0; index < 12; index += 1) {
    facts.push(atom(`Reporter ${index}`, [
      "value = explore({'thing': 'Target'})[0].situation",
      "message({'level': 'info', 'text': value})"
    ].join('\n'), [], 'program'));
  }
  const scheduler = createProgramRuntimeScheduler({ maxWorkers: 4 });

  const startedAt = Date.now();
  const cycle = await scheduler.refresh(facts);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(cycle.messages.length, 12);
  assert.ok(elapsedMs < 5_000, `large-world Program cycle took ${elapsedMs}ms`);
});

test('an unrelated transform revalidates many Program queries against one prepared world', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-revalidation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const targets = Array.from({ length: 32 }, (_, index) => atom(`Target ${index}`, 'stable'));
  const programs = targets.map((_, index) => atom(`Reporter ${index}`, [
    `value = explore({'thing': 'Target ${index}'})[0].situation`,
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program'));
  const ballast = Array.from(
    { length: 10_000 },
    (_, index) => atom(`Ballast ${index}`, 'x'.repeat(1_000))
  );
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Unrelated', 'before'),
    ...targets,
    ...programs,
    ...ballast
  ]));
  const scheduler = createProgramRuntimeScheduler({ maxWorkers: 4 });
  const interaction = { id: 'program-revalidation', agent: null };
  const commitWorld = async ({ facts }) => {
    await fs.writeFile(contextFile, JSON.stringify(facts));
  };

  const initialized = await executeAtomLanguage({
    source: 'atom',
    contextFile,
    projectionFile,
    interaction,
    programScheduler: scheduler,
    programMode: 'reconcile',
    commitWorld
  });
  assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));

  const startedAt = Date.now();
  const changed = await executeAtomLanguage({
    source: 'transform {"thing":"Unrelated","situation.rep.after"}',
    contextFile,
    projectionFile,
    interaction: { ...interaction, id: 'program-revalidation:write' },
    programScheduler: scheduler,
    commitWorld
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  assert.ok(elapsedMs < 5_000, `Program dependency revalidation took ${elapsedMs}ms`);
});

test('a configurable timeout terminates a stuck worker and the scheduler can run the next revision', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 1_000 });
  const startedAt = Date.now();

  await assert.rejects(
    scheduler.refresh([atom('Stuck Program', 'while True:\n    pass', [], 'program')]),
    { code: 'ATOM_PROGRAM_TIMEOUT' }
  );

  assert.ok(Date.now() - startedAt < 5_000, 'the configured timeout must stop the stuck cycle promptly');

  const recovered = await scheduler.refresh([
    atom('Recovery Program', "message({'level': 'info', 'text': 'recovered'})", [], 'program')
  ]);
  assert.equal(recovered.cached, false);
  assert.equal(recovered.messages[0].text, 'recovered');
});

test('a timeout during an in-flight explore cannot crash the scheduler with EPIPE', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 150 });
  const slowExplore = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return [{ path: request.thing }];
  };

  await assert.rejects(
    scheduler.refresh([
      atom('Target'),
      atom('Slow Reader', "explore({'thing': 'Target'})", [], 'program')
    ], { executeExplore: slowExplore }),
    { code: 'ATOM_PROGRAM_TIMEOUT' }
  );
  scheduler.timeoutMs = 2_000;
  await new Promise((resolve) => setTimeout(resolve, 300));

  const recovered = await scheduler.refresh([
    atom('Recovery Program', "message({'level': 'info', 'text': 'recovered'})", [], 'program')
  ]);
  assert.equal(recovered.messages[0].text, 'recovered');
});

test('lock rejects a target reference that is not in the evaluated world revision', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    atom('Program', [
      "lock({'targets': {'refs': ['not-a-world-ref']}, 'mode': 'write'})"
    ].join('\n'), [], 'program')
  ];

  await assert.rejects(
    scheduler.refresh(world),
    { code: 'INVALID_PROGRAM_LOCK_TARGET' }
  );
});

test('lock rejects a mode outside the registered write and read_write values', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    atom('Target'),
    atom('Program', [
      "target = explore({'thing': 'Target'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'delete'})"
    ].join('\n'), [], 'program')
  ];

  await assert.rejects(
    scheduler.refresh(world),
    { code: 'INVALID_PROGRAM_LOCK_MODE' }
  );
});
