import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

test('Python Program filters explored Atoms before passing validated refs to lock', async () => {
  const world = [
    atom('推进流', '', [
      atom('任务A', '', [atom('状态', '已人工冻结')]),
      atom('任务B', '', [atom('状态', '执行中')])
    ]),
    atom('冻结程序', [
      "flow = explore({'thing': '推进流', 'slot$latitude-2': None})",
      "approved = []",
      "for candidate in flow:",
      "    direct = explore({'thing': candidate.path, 'slot$latitude-1': None})",
      "    if any(item.ref != candidate.ref and item.thing == '状态' and item.situation == '已人工冻结' for item in direct):",
      "        approved.append(candidate)",
      "if approved:",
      "    lock({'targets': {'refs': [item.ref for item in approved]}, 'mode': 'write', 'protect': {'atom': True, 'messages': False}})",
      "    message({'level': 'info', 'text': f'锁定{len(approved)}个Atom'})"
    ].join('\n'), [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh(world);
  assert.equal(cycle.locks.length, 1);
  assert.equal(cycle.locks[0].targets.refs.length, 1);
  assert.equal(cycle.messages[0].text, '锁定1个Atom');
});

test('same world fingerprint reuses one completed Program cycle', async () => {
  const world = [atom('程序', "message({'level': 'info', 'text': 'once'})", [], 'program')];
  const scheduler = createProgramRuntimeScheduler();
  const first = await scheduler.refresh(world);
  const second = await scheduler.refresh(world);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.fingerprint, first.fingerprint);
});

test('slot_body print derives its body from the current print Program parent and cached cycles do not replay it', async () => {
  const world = [atom('订单槽体', '', [
    atom('print', "slot_body({'action':'print','name':'订单001'})", [], 'program')
  ])];
  const scheduler = createProgramRuntimeScheduler();
  const first = await scheduler.refresh(world);
  const second = await scheduler.refresh(world);

  assert.deepEqual(first.slotBodies, [{
    action: 'print', body: '订单槽体', name: '订单001',
    sourceProgramPath: '订单槽体/print'
  }]);
  assert.deepEqual(second.slotBodies, []);
});

test('slot_body seal self-declares the current Program as the slot body', async () => {
  const world = [atom('订单槽体', "slot_body({'action':'seal'})", [], 'program')];
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh(world);

  assert.deepEqual(cycle.failures, []);
  assert.deepEqual(cycle.slotBodies, [{
    action: 'seal',
    body: '订单槽体',
    sourceProgramPath: '订单槽体'
  }]);
});

test('slot_body rejects caller-supplied body and retired seal arguments', async () => {
  for (const extra of ["'body':'订单槽体'", "'limit':1", "'cursor':'retired'"]) {
    const world = [atom('程序', `slot_body({'action':'seal',${extra}})`, [], 'program')];
    await assert.rejects(
      createProgramRuntimeScheduler().refresh(world),
      { code: 'INVALID_SLOT_BODY_EFFECT' }
    );
  }
});

test('Program world functions require one JSON object root argument', async () => {
  const world = [atom('程序', "message(['not', 'an', 'object'])", [], 'program')];
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(scheduler.refresh(world), { code: 'ATOM_PROGRAM_FAILED' });
});

test('Program cycle has a wall-clock timeout', async () => {
  const world = [atom('程序', 'while True:\n    pass', [], 'program')];
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 30 });
  await assert.rejects(scheduler.refresh(world), { code: 'ATOM_PROGRAM_TIMEOUT' });
});
