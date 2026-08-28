import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

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

  const first = revisionOfWorldFacts(facts);
  const second = revisionOfWorldFacts(facts);

  assert.equal(second, first);
  assert.equal(reads, 1);
});

test('mutable fact arrays are rehashed after in-place changes', () => {
  const facts = [{ name: 'A', detail: 'before', children: [], partners: [] }];
  const before = revisionOfWorldFacts(facts);
  facts[0].detail = 'after';
  assert.notEqual(revisionOfWorldFacts(facts), before);
});

test('world revision hashing does not materialize the complete world as one JSON string', () => {
  const facts = Array.from({ length: 1_000 }, (_, index) => ({
    thing: `Fact ${index}`,
    situation: 'x'.repeat(1_000),
    contain: [],
    support: []
  }));
  const stringify = JSON.stringify;
  const expected = `sha256:${crypto.createHash('sha256').update(stringify(facts)).digest('hex')}`;
  JSON.stringify = (value, ...options) => {
    if (value === facts) throw new Error('complete-world JSON materialization');
    return stringify(value, ...options);
  };

  try {
    assert.equal(revisionOfWorldFacts(facts), expected);
  } finally {
    JSON.stringify = stringify;
  }
});
