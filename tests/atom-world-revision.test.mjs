import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  revisionOfWorldFacts,
  prepareWorldFactsRevision,
  sealWorldFactsRevision
} from '../src/atom-system/world-runtime/world-revision.mjs';

test('revision hashing is reused for one immutable fact snapshot', () => {
  let reads = 0;
  const atom = {
    name: 'A',
    get detail() {
      reads += 1;
      return 'stable';
    },
    children: [],
    partners: []
  };
  Object.freeze(atom.children);
  Object.freeze(atom.partners);
  Object.freeze(atom);
  const facts = Object.freeze([atom]);

  sealWorldFactsRevision(facts);
  const readsAfterSeal = reads;
  const first = revisionOfWorldFacts(facts);
  const second = revisionOfWorldFacts(facts);

  assert.equal(second, first);
  assert.equal(reads, readsAfterSeal);
});

test('mutable fact arrays are rehashed after in-place changes', () => {
  const facts = [{ name: 'A', detail: 'before', children: [], partners: [] }];
  const before = revisionOfWorldFacts(facts);
  facts[0].detail = 'after';
  assert.notEqual(revisionOfWorldFacts(facts), before);
});

test('a shallow-frozen fact array cannot cache a mutable descendant revision', () => {
  const facts = Object.freeze([{ thing: 'A', situation: 'before', slot: [], strut: [] }]);
  const before = revisionOfWorldFacts(facts);
  facts[0].situation = 'after';
  assert.notEqual(revisionOfWorldFacts(facts), before);
  sealWorldFactsRevision(facts);
  assert.equal(Object.isFrozen(facts[0]), true);
  assert.equal(Object.isFrozen(facts[0].slot), true);
});

test('a frozen but unsealed getter cannot bless a cached revision', () => {
  let situation = 'before';
  const facts = Object.freeze([Object.freeze({ thing: 'A',
    get situation() { return situation; }, slot: Object.freeze([]), strut: Object.freeze([]) })]);
  const before = revisionOfWorldFacts(facts);
  situation = 'after';
  assert.notEqual(revisionOfWorldFacts(facts), before);
});

test('a finalized world is sealed once and reuses one canonical revision downstream', () => {
  let reads = 0;
  const facts = [{
    thing: 'A',
    get situation() {
      reads += 1;
      return 'final';
    },
    slot: [{ thing: 'B', situation: '', slot: [], strut: [] }],
    strut: []
  }];

  const prepared = sealWorldFactsRevision(facts);
  const readsAfterSeal = reads;

  assert.equal(revisionOfWorldFacts(facts), prepared);
  assert.equal(revisionOfWorldFacts(facts), prepared);
  assert.equal(reads, readsAfterSeal);
  assert.equal(Object.isFrozen(facts), true);
  assert.equal(Object.isFrozen(facts[0]), true);
  assert.equal(Object.isFrozen(facts[0].slot[0]), true);
});

test('world revision is the sha256 of the canonical persisted JSON value', () => {
  const facts = Array.from({ length: 1_000 }, (_, index) => ({
    thing: `Fact ${index}`,
    situation: 'x'.repeat(1_000),
    slot: [],
    strut: []
  }));
  const expected = `sha256:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
  const prepared = prepareWorldFactsRevision(Object.freeze(facts));
  assert.equal(prepared.revision, expected);
  assert.equal(prepared.json, JSON.stringify(facts));
  assert.equal(revisionOfWorldFacts(facts), expected);
});
