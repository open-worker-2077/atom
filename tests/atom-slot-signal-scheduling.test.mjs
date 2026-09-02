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

test('slot effects reject a non-array Python effect envelope', () => {
  assert.throws(() => validateProgramResult(
    { ok: true, slotSignals: {} },
    [{ ref: 'sender', path: 'Sender', types: ['program'] }],
    { ref: 'sender', path: 'Sender' }
  ), { code: 'INVALID_SLOT_SIGNAL_EFFECT' });
});
