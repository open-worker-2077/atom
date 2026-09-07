import assert from 'node:assert/strict';
import test from 'node:test';

import { inventorySlotTagRuntime } from '../scripts/inventory-slot-tag-runtime.mjs';

const atom = (key, thing, situation = '', slot = [], strut = []) => ({
  [key]: thing, situation, slot, strut
});

test('runtime inventory separates active declarations from the default backup subtree', () => {
  const facts = [
    atom('thing', 'Source', '', [], [{
      'if@current': true,
      if: [{ program: 'def main(packet):\n    slot_provide(["A"])' }],
      then: [{ thing: 'Target' }]
    }]),
    atom('thing', 'Target', '', [
      atom('thing@program', 'Receiver', [
        'def receive(packet):',
        '    pass',
        'slot_receive({"labels":["A"],"match":"all"}, receive)'
      ].join('\n'))
    ]),
    atom('thing@backup@default', 'Backup', '', [
      atom('thing@program', 'Old', 'slot({"to":"down","labels":["A"]})')
    ])
  ];

  const inventory = inventorySlotTagRuntime(facts);

  assert.deepEqual(inventory.summary, {
    'active:tag-line': 1,
    'active:tag-receive': 1,
    'backup:legacy-provide': 1
  });
  assert.deepEqual(inventory.active.map(({ kind, path }) => ({ kind, path })), [
    { kind: 'tag-line', path: 'Source' },
    { kind: 'tag-receive', path: 'Target/Receiver' }
  ]);
});

test('runtime inventory distinguishes strict boolean lines and adjacent legacy Slot APIs', () => {
  const inventory = inventorySlotTagRuntime([
    atom('thing', 'Old Source', '', [
      atom('thing@program', 'Sender', 'slot({"to":"down","labels":["A"]})'),
      atom('thing@program', 'Receiver', [
        'def receive():',
        '    signal()',
        'trigger("slot", {"from":"up","labels":["A"]}, receive)'
      ].join('\n'))
    ], [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: 'Old Target' }]
    }])
  ]);

  assert.deepEqual(inventory.summary, {
    'active:legacy-provide': 1,
    'active:legacy-receive': 1,
    'active:strict-bool-line': 1
  });
});
