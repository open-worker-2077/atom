import assert from 'node:assert/strict';
import test from 'node:test';

import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';
import { createProgramRefBindingUpdate } from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { planShortThingIdentityMigration } from '../work-engine/atom-language/thing-identity-migration.mjs';

const legacy = Object.freeze({
  root: 'AAAAAAAAAAAAAAAAAAAAAA', target: 'BBBBBBBBBBBBBBBBBBBBBB',
  source: 'CCCCCCCCCCCCCCCCCCCCCC', shortcut: 'DDDDDDDDDDDDDDDDDDDDDD'
});

function atom(id, thing, { types = [], situation = '', slot = [], strut = [] } = {}) {
  return {
    [`thing${types.map(type => `@${type}`).join('')}&id=${id}`]: thing,
    situation, slot, strut
  };
}

test('cold Thing identity migration preserves four-axis topology and binds relations once', () => {
  const source = [atom(legacy.root, '域', { slot: [
    atom(legacy.target, '目标', { situation: '正文' }),
    atom(legacy.source, '来源', {
      strut: [{ 'if@current': true, then: [{ [`thing&id=${legacy.target}`]: '目标' }] }]
    }),
    atom(legacy.shortcut, '入口', {
      types: ['shortcut'],
      situation: JSON.stringify({
        contract: 'atom.shortcut', version: 1, referenceId: 'migration-entry',
        target: { state: 'linked', path: '域/目标', identity: legacy.target }
      })
    })
  ] })];
  const first = planShortThingIdentityMigration({
    facts: source,
    programRefBindings: createProgramRefBindingUpdate(),
    sourceWatermark: '000'
  });

  assert.equal(first.summary.thingCount, 4);
  assert.equal(first.summary.uniqueShortIdentityCount, 4);
  assert.equal(first.summary.topologyPreserved, true);
  assert.equal(first.summary.allocatorWatermark, '004');
  assert.equal(Object.keys(first.facts[0].slot[1].strut[0].then[0])[0], 'thing&id=002');
  assert.equal(JSON.parse(first.facts[0].slot[2].situation).target.identity, '002');
  assert.doesNotThrow(() => projectAtomContext(first.facts));

  const second = planShortThingIdentityMigration({
    facts: first.facts,
    programRefBindings: first.nextBindings,
    sourceWatermark: first.summary.allocatorWatermark
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.facts, first.facts);
  assert.equal(second.summary.uniqueShortIdentityCount, 4);
});

