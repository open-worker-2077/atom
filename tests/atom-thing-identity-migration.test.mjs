import assert from 'node:assert/strict';
import test from 'node:test';

import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';
import { createShortcutAtom } from '../work-engine/atom-language/shortcut-runtime.mjs';
import { planThingIdentityMigration } from '../work-engine/atom-language/thing-identity-migration.mjs';

function atom(thing, situation = '', slot = [], strut = []) {
  return { thing, situation, slot, strut };
}

test('cold Thing identity migration preserves four-axis topology and binds relations once', () => {
  const source = [
    atom('域', '', [
      atom('目标', '正文'),
      atom('来源', '', [], [{ 'if@current': true, then: [{ thing: '目标' }] }]),
      createShortcutAtom({ thing: '入口', targetPath: '域/目标', referenceId: 'migration-entry' })
    ])
  ];
  const first = planThingIdentityMigration(source);

  assert.equal(first.summary.thingCount, 4);
  assert.equal(first.summary.uniqueIdentityCount, 4);
  assert.equal(first.summary.topologyPreserved, true);
  assert.equal(first.summary.strutEndpointCount, 1);
  assert.equal(first.summary.boundStrutEndpointCount, 1);
  assert.deepEqual(first.summary.boundStrutPaths, ['域/来源']);
  assert.deepEqual(first.summary.boundShortcutPaths, ['域/入口']);
  assert.doesNotThrow(() => projectAtomContext(first.facts));

  const second = planThingIdentityMigration(first.facts);
  assert.equal(second.changed, false);
  assert.deepEqual(second.facts, first.facts);
  assert.equal(second.summary.uniqueIdentityCount, 4);
  assert.equal(second.summary.boundStrutEndpointCount, 1);
});

