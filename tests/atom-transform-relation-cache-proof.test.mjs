import assert from 'node:assert/strict';
import test from 'node:test';

import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import {
  applyTransform,
  prepareTransformRelationIndex
} from '../work-engine/atom-language/transform-executor.mjs';

const atom = (thing, strut = []) => ({ thing, situation: '', slot: [], strut });
const relation = (target) => [{ 'if@current': true, then: [{ thing: target }] }];
const paths = (prepared) => prepared.matches.map((match) => match.path.join('/'));

test('a shallow-frozen getter cannot preserve a stale Transform relation index', () => {
  let name = 'Before';
  const target = Object.freeze({ get thing() { return name; }, situation: '',
    slot: Object.freeze([]), strut: Object.freeze([]) });
  const facts = Object.freeze([atom('Source', relation('Before')), target]);
  const first = prepareTransformRelationIndex(facts, 'atom.json');
  assert.deepEqual(paths(first), ['Source', 'Before']);
  assert.equal(first.bindings.length, 1);
  name = 'After';
  const second = prepareTransformRelationIndex(facts, 'atom.json');
  assert.deepEqual(paths(second), ['Source', 'After']);
  assert.equal(second.bindings.length, 0);
});

test('mutable facts cannot reuse stale Transform matches or bindings', () => {
  const target = atom('Before');
  const facts = [atom('Source', relation('Before')), target];
  const first = prepareTransformRelationIndex(facts, 'atom.json');
  assert.equal(first.bindings.length, 1);
  target.thing = 'After';
  const second = prepareTransformRelationIndex(facts, 'atom.json');
  assert.deepEqual(paths(second), ['Source', 'After']);
  assert.equal(second.bindings.length, 0);
});

test('an unsealed preparation cannot poison a later sealed Transform index', () => {
  const target = atom('Before');
  const facts = [atom('Source', relation('Before')), target];
  const provisional = prepareTransformRelationIndex(facts, 'atom.json');
  target.thing = 'After';
  sealWorldFactsRevision(facts);
  const sealed = prepareTransformRelationIndex(facts, 'atom.json');
  assert.notStrictEqual(sealed, provisional);
  assert.deepEqual(paths(sealed), ['Source', 'After']);
  assert.equal(sealed.bindings.length, 0);
  assert.strictEqual(prepareTransformRelationIndex(facts, 'atom.json'), sealed);
});

test('an unsealed structural Transform result cannot inherit stale relation matches', async () => {
  const facts = [atom('Source', relation('Target')), atom('Target')];
  sealWorldFactsRevision(facts);
  prepareTransformRelationIndex(facts, 'atom.json');
  const parsed = createAtomLanguageReceiver().receive('transform {"thing.ren.Renamed":"Target"}');
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const changed = await applyTransform({ atoms: facts, item: parsed.items[0], contextFile: 'atom.json' });
  assert.equal(changed.error, undefined);
  const provisional = prepareTransformRelationIndex(changed.atoms, 'atom.json');
  assert.deepEqual(paths(provisional), ['Source', 'Renamed']);
  changed.atoms[1].thing = 'After';
  const latest = prepareTransformRelationIndex(changed.atoms, 'atom.json');
  assert.deepEqual(paths(latest), ['Source', 'After']);
  assert.equal(latest.bindings.length, 0);
});
