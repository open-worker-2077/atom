import assert from 'node:assert/strict';
import test from 'node:test';

import { planStrutReceiverMigration } from '../work-engine/atom-language/strut-receiver-migration.mjs';

function atom(key, name, situation = '', slot = [], strut = []) {
  return { [key]: name, situation, slot, strut };
}

const receiver = (name, node = 'Result') => atom('thing@program', name, [
  'def receive(delivery):',
  '    return delivery["decision"]',
  `trigger("strut", {"nodes":[${JSON.stringify(node)}]}, receive)`
].join('\n'));

test('replaces one subscribed fact consequent with its receiver Program and rewrites only the trigger parameters', () => {
  const source = [
    atom('thing', 'Source', '', [], [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: 'Result' }]
    }]),
    atom('thing', 'Result'),
    receiver('Receiver')
  ];
  const snapshot = structuredClone(source);

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(source, snapshot, 'planner must not mutate authoritative source facts');
  assert.deepEqual(plan.facts[0].strut[0].then, [{ 'thing@program': 'Receiver' }]);
  assert.match(plan.facts[2].situation, /trigger\(['"]strut['"], \{\}, receive\)/u);
  assert.equal(plan.summary.migratedPrograms, 1);
  assert.equal(plan.summary.rewrittenConsequents, 1);
});

test('expands one subscribed fact consequent to every explicit receiver Program', () => {
  const source = [
    atom('thing', 'Source', '', [], [{ 'if@current': true, then: [{ thing: 'Result' }] }]),
    atom('thing', 'Result'),
    receiver('First'),
    receiver('Second')
  ];

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(plan.facts[0].strut[0].then, [
    { 'thing@program': 'First' },
    { 'thing@program': 'Second' }
  ]);
  assert.equal(plan.summary.migratedPrograms, 2);
});

test('resolves a relative slot-model node and points the clause at the shared Program role', () => {
  const source = [atom('thing', 'Body', '', [
    atom('thing', 'Model', '', [
      atom('thing', 'Input', '', [], [{ 'if@current': true, then: [{ thing: 'Run' }] }]),
      atom('thing', 'Run'),
      receiver('Action', './Run')
    ])
  ])];

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(plan.facts[0].slot[0].slot[0].strut[0].then, [
    { 'thing@program': 'Body/Model/Action' }
  ]);
});

test('keeps default-backup history untouched and blocks an active subscription without a Graph consequent', () => {
  const archived = atom('thing@backup@default', 'Backup', '', [receiver('OldReceiver')]);
  assert.deepEqual(planStrutReceiverMigration([archived]).facts, [archived]);

  assert.throws(() => planStrutReceiverMigration([
    atom('thing', 'Result'),
    receiver('Receiver')
  ]), { code: 'STRUT_RECEIVER_MIGRATION_CONSEQUENT_REQUIRED' });
});

test('blocks dynamic strut trigger parameters instead of guessing', () => {
  assert.throws(() => planStrutReceiverMigration([
    atom('thing@program', 'Receiver', [
      'def receive(delivery):',
      '    return True',
      'nodes = ["Result"]',
      'trigger("strut", {"nodes":nodes}, receive)'
    ].join('\n'))
  ]), { code: 'STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER' });
});
