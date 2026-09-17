import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  revisionOfWorldFacts,
  prepareWorldFactsRevision,
  sealWorldFactsRevision
} from '../src/atom-system/world-runtime/world-revision.mjs';

test('sealed plain JSON facts reuse one canonical revision', (t) => {
  const originalCreateHash = crypto.createHash;
  let hashes = 0;
  t.mock.method(crypto, 'createHash', (...args) => {
    hashes += 1;
    return originalCreateHash(...args);
  });
  const facts = [{ thing: 'A', situation: 'stable', slot: [], strut: [] }];
  const first = sealWorldFactsRevision(facts);
  assert.equal(revisionOfWorldFacts(facts), first);
  assert.equal(revisionOfWorldFacts(facts), first);
  assert.equal(hashes, 1);
  assert.equal(Object.isFrozen(facts[0]), true);
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

test('sealing rejects accessor facts before a cached revision can become stale', () => {
  let situation = 'before';
  const facts = Object.freeze([Object.freeze({ thing: 'A',
    get situation() { return situation; }, slot: Object.freeze([]), strut: Object.freeze([]) })]);
  assert.throws(() => sealWorldFactsRevision(facts), { code: 'INVALID_WORLD_FACTS' });
  const before = revisionOfWorldFacts(facts);
  situation = 'after';
  assert.notEqual(revisionOfWorldFacts(facts), before);
});

test('sealing rejects nested accessors and mutable exotic values', () => {
  const nestedGetter = [{ thing: 'A', situation: '', slot: [], strut: [{
    get then() { return [{ thing: 'B' }]; }
  }] }];
  assert.throws(() => sealWorldFactsRevision(nestedGetter), { code: 'INVALID_WORLD_FACTS' });
  assert.throws(() => sealWorldFactsRevision([{ thing: 'A', situation: '', slot: [],
    strut: [], extra: new Map([['mutable', 'before']]) }]), { code: 'INVALID_WORLD_FACTS' });
});

test('sealing accepts shared plain JSON data but rejects sparse arrays and cycles', () => {
  const shared = { thing: 'Shared', situation: '', slot: [], strut: [] };
  const facts = [{ thing: 'Root', situation: '', slot: [shared, shared], strut: [] }];
  assert.equal(sealWorldFactsRevision(facts), revisionOfWorldFacts(facts));
  const sparse = [{ thing: 'Root', situation: '', slot: new Array(1), strut: [] }];
  sparse[0].slot.extra = 'balances Object.keys length';
  assert.throws(() => sealWorldFactsRevision(sparse), { code: 'INVALID_WORLD_FACTS' });
  const cycle = [{ thing: 'Root', situation: '', slot: [], strut: [] }];
  cycle[0].slot.push(cycle[0]);
  assert.throws(() => sealWorldFactsRevision(cycle), { code: 'INVALID_WORLD_FACTS' });
});

test('sealing rejects a proxy that can change a frozen-looking fact', () => {
  let situation = 'before';
  const target = { thing: 'Root', situation: 'before', slot: [], strut: [] };
  const facts = [new Proxy(target, {
    get(object, key) { return key === 'situation' ? situation : Reflect.get(object, key); }
  })];
  assert.throws(() => sealWorldFactsRevision(facts), { code: 'INVALID_WORLD_FACTS' });
  situation = 'after';
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
