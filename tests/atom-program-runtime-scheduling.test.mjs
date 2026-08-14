import assert from 'node:assert/strict';
import test from 'node:test';

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

test('Program cycles default to a sixty-second wall-clock budget', () => {
  const scheduler = createProgramRuntimeScheduler();

  assert.equal(scheduler.timeoutMs, 60_000);
});

test('scheduler fingerprint includes the @agent context origin', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('No Program')];
  const first = await scheduler.refresh(world, { agentOrigin: { ref: 'agent-a', path: 'A/Agent' } });
  const second = await scheduler.refresh(world, { agentOrigin: { ref: 'agent-b', path: 'B/Agent' } });
  assert.equal(first.cached, false);
  assert.equal(second.cached, false);
  assert.notEqual(first.fingerprint, second.fingerprint);
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
