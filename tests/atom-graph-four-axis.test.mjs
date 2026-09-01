import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyStrutCurrentEndpoints,
  exportGraphDocument,
  parseGraphDocument
} from '../cli/lib/graph-json.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';
import {
  evaluateStrutClauses,
  propagateStrutClauses
} from '../work-engine/atom-language/strut-runtime.mjs';

const leaf = (thing, situation = '', strut = []) => ({ thing, situation, slot: [], strut });
const graphDocument = (slot, strut = []) => ({
  config: { schema_version: '3.0.0' },
  graph: { thing: '世界', situation: '', slot, strut }
});

test('ordinary static strut is unconditional and does not evaluate Things as booleans', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('前项', 'ordinary fact', [{ 'if@current': true, then: [{ thing: '后项' }] }]),
    leaf('后项')
  ]));

  const decisions = evaluateStrutClauses(parsed, { nodesByPath: new Map() });

  assert.deepEqual(decisions.get('strut:世界/前项:0'), {
    status: 'true',
    decision: true,
    trace: []
  });
});

test('only four axes are active and strut accepts no key type markers', () => {
  for (const axis of ['thing', 'situation', 'slot', 'strut']) assert.deepEqual(parseAtomKey(axis).errors, []);
  for (const retired of ['name', 'detail', 'children', 'partners']) {
    assert.equal(parseAtomKey(retired).errors[0]?.code, 'RETIRED_GRAPH_AXIS');
  }
  for (const key of ['strut@program', 'strut@reverse', 'strut@consequent']) {
    assert.equal(parseAtomKey(key).errors[0]?.code, 'INVALID_STRUT_KEY');
  }
});

test('current owner is classified O(1) without reading if or then', () => {
  const inaccessible = new Proxy([], { get() { throw new Error('must not scan'); } });
  assert.deepEqual(classifyStrutCurrentEndpoints({ 'if@current': true, then: inaccessible }), {
    currentAntecedent: true, currentConsequent: false
  });
  assert.deepEqual(classifyStrutCurrentEndpoints({ if: inaccessible, 'then@current': true }), {
    currentAntecedent: false, currentConsequent: true
  });
  assert.throws(() => classifyStrutCurrentEndpoints({ if: inaccessible, then: inaccessible }), {
    code: 'STRUT_OWNER_CURRENT_REQUIRED'
  });
  assert.throws(() => classifyStrutCurrentEndpoints({ 'if@current': true, 'then@current': true }), {
    code: 'CURRENT_ENDPOINT_ON_BOTH_SIDES'
  });
});

test('1-to-N is declared once at its current source and preserves order', () => {
  const input = graphDocument([
    leaf('A', '', [{ 'if@current': true, then: [{ thing: 'B' }, { thing: 'C' }, { thing: 'D' }] }]),
    leaf('B'), leaf('C'), leaf('D')
  ]);
  const parsed = parseGraphDocument(input);
  assert.deepEqual(parsed.graph, input.graph);
  const [rule] = parsed.strutClauses;
  assert.equal(rule.currentSide, 'antecedent');
  assert.deepEqual(rule.dependencyPaths, ['世界/A']);
  assert.deepEqual(rule.then.map((item) => item.targetPath), ['世界/B', '世界/C', '世界/D']);
});

test('N-to-1 is declared once at its current hub target', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('A'), leaf('B'), leaf('C'),
    leaf('H', '', [{
      if: [{ and: [{ thing: 'A' }, { thing: 'B' }, { thing: 'C' }] }],
      'then@current': true
    }])
  ]));
  const [rule] = parsed.strutClauses;
  assert.equal(rule.currentSide, 'consequent');
  assert.equal(rule.root.kind, 'and');
  assert.deepEqual(rule.dependencyPaths, ['世界/A', '世界/B', '世界/C']);
  assert.deepEqual(rule.then.map((item) => item.targetPath), ['世界/H']);
});

test('current may combine with external antecedents only for a single consequent', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('A', '', [{ 'if@current': true, if: [{ thing: 'B' }], then: [{ thing: 'C' }] }]),
    leaf('B'), leaf('C')
  ]));
  assert.equal(parsed.strutClauses[0].root.kind, 'and');
  assert.deepEqual(parsed.strutClauses[0].dependencyPaths, ['世界/A', '世界/B']);
});

test('modifiers are strict true, exactly one is required and both sides are non-empty', () => {
  const cases = [
    [[{ 'if@current': false, then: [{ thing: 'B' }] }], 'INVALID_CURRENT_MODIFIER'],
    [[{ 'if@current': 'true', then: [{ thing: 'B' }] }], 'INVALID_CURRENT_MODIFIER'],
    [[{ if: [{ thing: 'B' }], then: [{ thing: 'B' }] }], 'STRUT_OWNER_CURRENT_REQUIRED'],
    [[{ 'if@current': true }], 'MISSING_STRUT_CONSEQUENT']
  ];
  for (const [strut, code] of cases) {
    assert.throws(() => parseGraphDocument(graphDocument([leaf('A', '', strut), leaf('B')])), { code });
  }
});

test('current cannot occur on both sides or be smuggled through a selector', () => {
  assert.throws(() => parseGraphDocument(graphDocument([leaf('A', '', [{
    'if@current': true, 'then@current': true
  }])])), { code: 'CURRENT_ENDPOINT_ON_BOTH_SIDES' });
  assert.throws(() => parseGraphDocument(graphDocument([leaf('A', '', [{
    if: [{ thing: '.' }], 'then@current': true
  }])])), { code: 'CURRENT_ENDPOINT_REQUIRES_MODIFIER' });
});

test('nested A and (B or C) preserves explicit topology and order at a real hub', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('A'), leaf('B'), leaf('C'),
    leaf('H', '', [{
      if: [{ and: [{ thing: 'A' }, { or: [{ thing: 'B' }, { thing: 'C' }] }] }],
      'then@current': true
    }])
  ]));
  const [rule] = parsed.strutClauses;
  assert.equal(rule.root.kind, 'and');
  assert.equal(rule.root.children[1].kind, 'or');
  assert.deepEqual(rule.dependencyPaths, ['世界/A', '世界/B', '世界/C']);
});

test('thing@program is a typed endpoint selector and never line-carried source code', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('Source'),
    { 'thing@program': 'Predicate', situation: 'def main(arguments):\n    return True', slot: [], strut: [] },
    leaf('H', '', [{
      if: [{ and: [{ thing: 'Source' }, { 'thing@program': 'Predicate' }] }],
      'then@current': true
    }])
  ]));
  assert.equal(parsed.strutClauses[0].root.kind, 'and');
  assert.throws(() => parseGraphDocument(graphDocument([
    { 'thing@program': 'Predicate', situation: 'def main(arguments):\n    return True', slot: [], strut: [] },
    leaf('H', '', [{ if: [{ 'thing@program': 'Predicate' }], 'then@current': true }])
  ])), { code: 'STRUT_FACT_ANTECEDENT_REQUIRED' });
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('Ordinary'), leaf('H', '', [{ if: [{ 'thing@program': 'Ordinary' }], 'then@current': true }])
  ])), { code: 'STRUT_PROGRAM_ENDPOINT_TYPE_MISMATCH' });
  assert.throws(() => parseGraphDocument(graphDocument([
    { 'thing@program': 'Predicate', situation: '', slot: [], strut: [] },
    leaf('H', '', [{
      if: [{ 'thing@program': "satisfies({'thing':'Predicate'}, lambda node: True)" }],
      'then@current': true
    }])
  ])), { code: 'STRUT_INLINE_PROGRAM_UNSUPPORTED' });
});

test('native N-to-M is rejected even when its predicate Program is independent', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('A', '', [{
      'if@current': true,
      if: [{ and: [{ thing: 'B' }, { 'thing@program': 'Gate' }] }],
      then: [{ thing: 'Y' }, { thing: 'Z' }]
    }]),
    leaf('B'),
    { 'thing@program': 'Gate', situation: 'def main(arguments):\n    return True', slot: [], strut: [] },
    leaf('Y'), leaf('Z')
  ])), { code: 'NATIVE_MANY_TO_MANY_STRUT_UNSUPPORTED' });
});

test('a Program cannot own a current strut endpoint or become its own boolean fact', () => {
  const programOwner = (strut) => graphDocument([
    { 'thing@program': 'Decision', situation: 'def main(arguments):\n    return True', slot: [], strut },
    leaf('Fact')
  ]);
  assert.throws(() => parseGraphDocument(programOwner([
    { 'if@current': true, then: [{ thing: 'Fact' }] }
  ])), { code: 'STRUT_DECISION_PROGRAM_MUST_BE_INDEPENDENT' });
  assert.throws(() => parseGraphDocument(programOwner([
    { if: [{ thing: 'Fact' }], 'then@current': true }
  ])), { code: 'STRUT_DECISION_PROGRAM_MUST_BE_INDEPENDENT' });
});

test('a Program cannot replace an ordinary consequent fact endpoint', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('Fact', '', [{
      'if@current': true,
      then: [{ 'thing@program': 'Decision' }]
    }]),
    { 'thing@program': 'Decision', situation: 'def main(arguments):\n    return True', slot: [], strut: [] }
  ])), { code: 'STRUT_FACT_CONSEQUENT_REQUIRED' });
});

test('explicit 3-to-hub-to-3 remains two independently auditable rules', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('A'), leaf('B'), leaf('C'),
    leaf('H', '', [
      { if: [{ and: [{ thing: 'A' }, { thing: 'B' }, { thing: 'C' }] }], 'then@current': true },
      { 'if@current': true, then: [{ thing: 'X' }, { thing: 'Y' }, { thing: 'Z' }] }
    ]),
    leaf('X'), leaf('Y'), leaf('Z')
  ]));
  assert.equal(parsed.strutClauses.length, 2);
  assert.equal(parsed.endpointIndex.get('世界/H').length, 2);
  for (const endpoint of ['世界/A', '世界/B', '世界/C', '世界/X', '世界/Y', '世界/Z']) {
    assert.equal(parsed.endpointIndex.get(endpoint).length, 1);
  }
});

test('AND OR and three auditable independent rules remain distinct', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('A', '', [{ 'if@current': true, then: [{ thing: 'Z' }] }]),
    leaf('B', '', [{ 'if@current': true, then: [{ thing: 'Z' }] }]),
    leaf('C', '', [{ 'if@current': true, then: [{ thing: 'Z' }] }]),
    leaf('AND Hub', '', [{ if: [{ and: [{ thing: 'A' }, { thing: 'B' }, { thing: 'C' }] }], 'then@current': true }]),
    leaf('OR Hub', '', [{ if: [{ or: [{ thing: 'A' }, { thing: 'B' }, { thing: 'C' }] }], 'then@current': true }]),
    leaf('Z')
  ]));
  assert.deepEqual(parsed.strutClauses.map((rule) => rule.root.kind), ['thing', 'thing', 'thing', 'and', 'or']);
});

test('duplicate canonical owner rules are rejected instead of copied for visibility', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('A', '', [
      { 'if@current': true, then: [{ thing: 'B' }] },
      { 'if@current': true, then: [{ thing: 'B' }] }
    ]), leaf('B')
  ])), { code: 'DUPLICATE_STRUT_RULE' });
});

test('relative selector cannot escape current domain', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    { thing: '域A', situation: '', strut: [], slot: [leaf('H', '', [{
      if: [{ thing: './秘密' }], 'then@current': true
    }])] },
    { thing: '域B', situation: '', strut: [], slot: [leaf('秘密')] }
  ])), { code: 'STRUT_SELECTOR_OUT_OF_DOMAIN' });
});

test('cyclic topology terminates with stable rule and edge identities', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('P', '', [{ 'if@current': true, then: [{ thing: 'Q' }] }]),
    leaf('Q', '', [{ 'if@current': true, then: [{ thing: 'P' }] }])
  ]));
  const propagated = propagateStrutClauses(parsed);
  assert.equal(propagated.visitedClauseIds.length, 2);
  assert.equal(new Set(propagated.edges.map((edge) => edge.id)).size, 2);
});

test('spatial export emits one owner-local current source rule', () => {
  const a = { id: 'a', key: 'root::a', path: 'root', label: 'A', detail: 'a', aliases: [] };
  const b = { id: 'b', key: 'root::b', path: 'root', label: 'B', detail: 'b', aliases: [] };
  const result = exportGraphDocument({ nodes: [a, b], edges: [{
    from: { key: a.key }, to: { key: b.key }, label: 'strut'
  }] }, { collection: true });
  assert.deepEqual(result.graph.slot[0].strut, [{
    'if@current': true, then: [{ thing: 'B' }]
  }]);
});

test('large rule owner classification stays independent of expression size', () => {
  const inaccessible = new Proxy(Array.from({ length: 4000 }), {
    get() { throw new Error('must not scan'); }
  });
  assert.deepEqual(classifyStrutCurrentEndpoints({
    'if@current': true, if: inaccessible, then: inaccessible
  }), { currentAntecedent: true, currentConsequent: false });
});
