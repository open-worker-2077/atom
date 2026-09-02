import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSlotSignalDeliveries } from '../work-engine/atom-language/slot-signal-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function program(path, situation, slot = []) {
  const names = path.split('/');
  let value = atom(names.pop(), situation, slot, 'program');
  while (names.length) value = atom(names.pop(), '', [value]);
  return value;
}

test('up resolves only the direct parent and flips to receiver-relative down', () => {
  const world = [atom('Root', '', [atom('Parent', '', [program('Child', '')], 'program')], 'program')];
  const deliveries = resolveSlotSignalDeliveries(world, [{
    sourceProgramPath: 'Root/Parent/Child', to: 'up', labels: ['状态上报']
  }], { revision: 'sha256:r1', createId: () => 'signal-1' });
  assert.deepEqual(deliveries, [{
    mode: 'slot', id: 'signal-1', revision: 'sha256:r1',
    sourcePath: 'Root/Parent/Child', recipientPath: 'Root/Parent',
    from: 'down', labels: ['状态上报']
  }]);
});

test('down broadcasts only to direct children and marks them from up', () => {
  const world = [program('Parent', '', [program('A', ''), program('B', '', [program('Grandchild', '')])])];
  assert.deepEqual(
    resolveSlotSignalDeliveries(world, [{
      sourceProgramPath: 'Parent', to: 'down', labels: ['通告']
    }], { revision: 'sha256:r2', createId: (() => { let n = 0; return () => `s${++n}`; })() })
      .map(({ recipientPath, from }) => ({ recipientPath, from })),
    [{ recipientPath: 'Parent/A', from: 'up' }, { recipientPath: 'Parent/B', from: 'up' }]
  );
});

test('top-level up yields zero deliveries', () => {
  assert.deepEqual(resolveSlotSignalDeliveries([program('Root', '')], [{
    sourceProgramPath: 'Root', to: 'up', labels: ['状态']
  }], { revision: 'sha256:r3', createId: () => 'unused' }), []);
});

test('leaf down yields zero deliveries', () => {
  assert.deepEqual(resolveSlotSignalDeliveries([program('Leaf', '')], [{
    sourceProgramPath: 'Leaf', to: 'down', labels: ['状态']
  }], { revision: 'sha256:r4', createId: () => 'unused' }), []);
});

test('duplicate sender effects receive distinct delivery ids', () => {
  let nextId = 0;
  const deliveries = resolveSlotSignalDeliveries([program('Parent', '', [program('Child', '')])], [
    { sourceProgramPath: 'Parent', to: 'down', labels: ['一'] },
    { sourceProgramPath: 'Parent', to: 'down', labels: ['二'] }
  ], { revision: 'sha256:r5', createId: () => `signal-${++nextId}` });
  assert.deepEqual(deliveries.map(({ id, labels }) => ({ id, labels })), [
    { id: 'signal-1', labels: ['一'] }, { id: 'signal-2', labels: ['二'] }
  ]);
});

test('resolver does not mutate inputs and freezes cloned delivery labels', () => {
  const world = [program('Parent', '', [program('Child', '')])];
  const effects = [{ sourceProgramPath: 'Parent', to: 'down', labels: ['通告'] }];
  const beforeWorld = structuredClone(world);
  const beforeEffects = structuredClone(effects);
  const [delivery] = resolveSlotSignalDeliveries(world, effects, {
    revision: 'sha256:r6', createId: () => 'signal-1'
  });
  assert.deepEqual(world, beforeWorld);
  assert.deepEqual(effects, beforeEffects);
  assert.notEqual(delivery.labels, effects[0].labels);
  assert.equal(Object.isFrozen(delivery.labels), true);
});

test('throws when the claimed source Program no longer exists', () => {
  assert.throws(() => resolveSlotSignalDeliveries([atom('Parent', '', [atom('Child')])], [{
    sourceProgramPath: 'Parent/Child', to: 'up', labels: ['状态']
  }], { revision: 'sha256:r7', createId: () => 'unused' }), { code: 'SLOT_SIGNAL_SOURCE_NOT_FOUND' });
});
