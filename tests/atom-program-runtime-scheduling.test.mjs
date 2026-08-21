import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

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
      "target = explore({'name': 'Target'})[0]",
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
    "value = explore({'name': 'Input'})[0].detail",
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

test('an unrelated fact change reuses Program results without replaying the Program', async () => {
  const program = atom('Target Reporter', [
    "value = explore({'name': 'Target'})[0].detail",
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
    "target = explore({'name': 'Target'})[0]",
    "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['detail']})"
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
    "value = explore({'name': 'Left'})[0].detail",
    "message({'level': 'info', 'text': 'left:' + value})"
  ].join('\n'), [], 'program');
  const rightProgram = atom('Right Reporter', [
    "value = explore({'name': 'Right'})[0].detail",
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
      "target = explore({'name': 'Target'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'write', 'fields': ['detail']})",
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

test('Program cycles default to a ten-second wall-clock budget', () => {
  const scheduler = createProgramRuntimeScheduler();

  assert.equal(scheduler.timeoutMs, 10_000);
  assert.equal(scheduler.maxWorkers, 16);
});

test('a revision-local @agent ref change does not replay Programs for the same context path', async () => {
  const program = atom('Context Reporter', [
    "value = explore({'name': 'Agent'})[0].detail",
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();

  const first = await scheduler.refresh([
    atom('Agent', 'stable', [], 'agent'),
    atom('Unrelated', 'before'),
    program
  ], { agentOrigin: { ref: 'revision-one-ref', path: 'Agent' } });
  const unrelatedChange = await scheduler.refresh([
    atom('Agent', 'stable', [], 'agent'),
    atom('Unrelated', 'after'),
    structuredClone(program)
  ], { agentOrigin: { ref: 'revision-two-ref', path: 'Agent' } });

  assert.equal(first.messages[0].text, 'stable');
  assert.equal(unrelatedChange.cached, true);
  assert.deepEqual(unrelatedChange.messages, []);
});

test('scheduler distinguishes @agent cycles while reusing context-independent Program results', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('No Program')];
  const first = await scheduler.refresh(world, { agentOrigin: { ref: 'agent-a', path: 'A/Agent' } });
  const second = await scheduler.refresh(world, { agentOrigin: { ref: 'agent-b', path: 'B/Agent' } });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test('Programs with explicit explore anchors are reused across @agent context paths', async () => {
  const program = atom('Explicit Reporter', [
    "value = explore({'name': 'Target'})[0].detail",
    "message({'level': 'info', 'text': value})"
  ].join('\n'), [], 'program');
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('Target', 'stable'), program];
  let dependencyReads = 0;
  const executeExplore = async (request) => {
    dependencyReads += 1;
    return [{ path: request.name }];
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
    `value = explore({'name': '${name}'})[0].detail`,
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
    return [{ path: request.name }];
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
      "value = explore({'name': 'Target'})[0].detail",
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
    `value = explore({'name': 'Target ${index}'})[0].detail`,
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
    source: 'transform {"name":"Unrelated","detail.rep.after"}',
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
    return [{ path: request.name }];
  };

  await assert.rejects(
    scheduler.refresh([
      atom('Target'),
      atom('Slow Reader', "explore({'name': 'Target'})", [], 'program')
    ], { executeExplore: slowExplore }),
    { code: 'ATOM_PROGRAM_TIMEOUT' }
  );
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
      "target = explore({'name': 'Target'})[0]",
      "lock({'targets': {'refs': [target.ref]}, 'mode': 'delete'})"
    ].join('\n'), [], 'program')
  ];

  await assert.rejects(
    scheduler.refresh(world),
    { code: 'INVALID_PROGRAM_LOCK_MODE' }
  );
});
