import assert from 'node:assert/strict';
import test from 'node:test';

import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';
import {
  fieldsByBase,
  oneStoredField,
  prepareExploreWorld,
  walkAtoms
} from '../work-engine/atom-language/query-capability.mjs';

test('a sealed COW world reuses unchanged Atom field descriptions without exposing them', (t) => {
  const archived = { 'thing@backup@default': 'Backup', situation: '', slot: [
    { thing: 'Cold', situation: 'old', slot: [], strut: [] }
  ], strut: [] };
  const before = [{ thing: 'Active', situation: 'before', slot: [], strut: [] }, archived];
  sealWorldFactsRevision(before);
  const originalEntries = Object.entries;
  const visits = new Map();
  t.mock.method(Object, 'entries', (value) => {
    if (value && typeof value === 'object') visits.set(value, (visits.get(value) ?? 0) + 1);
    return originalEntries(value);
  });

  walkAtoms(before);
  visits.clear();
  walkAtoms(before);
  assert.equal(visits.get(archived) ?? 0, 0, 'same sealed Atom must not re-describe its keys');
  assert.equal(visits.get(archived.slot[0]) ?? 0, 0);

  const publicFields = fieldsByBase(archived);
  publicFields.get('thing')[0].parsed.types[0].raw = 'forged';
  publicFields.get('thing').push({ rawKey: 'forged' });
  publicFields.set('slot', []);
  const publicThing = oneStoredField(archived, 'thing');
  publicThing.rawKey = 'forged';
  publicThing.parsed.types.push({ raw: 'forged' });
  assert.deepEqual(oneStoredField(archived, 'thing').parsed.types.map(({ raw }) => raw),
    ['backup', 'default']);

  const after = [{ ...before[0], situation: 'after' }, archived];
  visits.clear();
  walkAtoms(after);
  assert.equal(visits.get(archived) ?? 0, 0, 'unchanged archive identity stays proven');
  assert.ok((visits.get(after[0]) ?? 0) > 0, 'new mutable COW Atom remains untrusted');
  sealWorldFactsRevision(after);
  walkAtoms(after);
  visits.clear();
  walkAtoms(after);
  assert.equal(visits.get(after[0]) ?? 0, 0, 'new Atom is reusable only after its world seal');
  assert.equal(before[0].situation, 'before', 'old readers remain unchanged');
});

test('a shallow-frozen accessor cannot provide a reusable Explore snapshot', () => {
  let name = 'Before';
  const atom = Object.freeze({ get thing() { return name; }, situation: '',
    slot: Object.freeze([]), strut: Object.freeze([]) });
  const facts = Object.freeze([atom]);
  assert.deepEqual(prepareExploreWorld(facts).allMatches.map(({ path }) => path.join('/')),
    ['世界之外', 'Before']);
  name = 'After';
  assert.deepEqual(prepareExploreWorld(facts).allMatches.map(({ path }) => path.join('/')),
    ['世界之外', 'After']);
});

test('sealed descriptions retain duplicate-field and invalid-key behavior', () => {
  const atom = { thing: 'First', 'thing@backup': 'Second', unknown: 'ignored',
    situation: '', slot: [], strut: [] };
  sealWorldFactsRevision([atom]);
  assert.equal(fieldsByBase(atom).get('thing').length, 2);
  assert.equal(oneStoredField(atom, 'thing'), null);
  assert.equal(fieldsByBase(atom).has('unknown'), false);
});
