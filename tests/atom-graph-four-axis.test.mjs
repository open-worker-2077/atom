import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySupportCurrentEndpoints,
  exportGraphDocument,
  parseGraphDocument
} from '../cli/lib/graph-json.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';
import {
  evaluateSupportClauses,
  propagateSupportClauses
} from '../work-engine/atom-language/support-runtime.mjs';

const leaf = (thing, situation = '', support = []) => ({ thing, situation, contain: [], support });
const graphDocument = (contain, support = []) => ({
  config: { schema_version: '2.0.0' },
  graph: { thing: '世界', situation: '', contain, support }
});

test('ordinary static support is unconditional and does not evaluate Things as booleans', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('前项', 'ordinary fact', [{ 'if@current': true, then: [{ thing: '后项' }] }]),
    leaf('后项')
  ]));

  const decisions = evaluateSupportClauses(parsed, { nodesByPath: new Map() });

  assert.deepEqual(decisions.get('support:世界/前项:0'), {
    status: 'true',
    decision: true,
    trace: []
  });
});

test('only four axes are active and support accepts no key type markers', () => {
  for (const axis of ['thing', 'situation', 'contain', 'support']) assert.deepEqual(parseAtomKey(axis).errors, []);
  for (const retired of ['name', 'detail', 'children', 'partners']) {
    assert.equal(parseAtomKey(retired).errors[0]?.code, 'RETIRED_GRAPH_AXIS');
  }
  for (const key of ['support@program', 'support@reverse', 'support@consequent']) {
    assert.equal(parseAtomKey(key).errors[0]?.code, 'INVALID_SUPPORT_KEY');
  }
});

test('current owner is classified O(1) without reading if or then', () => {
  const inaccessible = new Proxy([], { get() { throw new Error('must not scan'); } });
  assert.deepEqual(classifySupportCurrentEndpoints({ 'if@current': true, then: inaccessible }), {
    currentAntecedent: true, currentConsequent: false
  });
  assert.deepEqual(classifySupportCurrentEndpoints({ if: inaccessible, 'then@current': true }), {
    currentAntecedent: false, currentConsequent: true
  });
  assert.throws(() => classifySupportCurrentEndpoints({ if: inaccessible, then: inaccessible }), {
    code: 'SUPPORT_OWNER_CURRENT_REQUIRED'
  });
  assert.throws(() => classifySupportCurrentEndpoints({ 'if@current': true, 'then@current': true }), {
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
  const [rule] = parsed.supportClauses;
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
  const [rule] = parsed.supportClauses;
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
  assert.equal(parsed.supportClauses[0].root.kind, 'and');
  assert.deepEqual(parsed.supportClauses[0].dependencyPaths, ['世界/A', '世界/B']);
});

test('modifiers are strict true, exactly one is required and both sides are non-empty', () => {
  const cases = [
    [[{ 'if@current': false, then: [{ thing: 'B' }] }], 'INVALID_CURRENT_MODIFIER'],
    [[{ 'if@current': 'true', then: [{ thing: 'B' }] }], 'INVALID_CURRENT_MODIFIER'],
    [[{ if: [{ thing: 'B' }], then: [{ thing: 'B' }] }], 'SUPPORT_OWNER_CURRENT_REQUIRED'],
    [[{ 'if@current': true }], 'MISSING_SUPPORT_CONSEQUENT']
  ];
  for (const [support, code] of cases) {
    assert.throws(() => parseGraphDocument(graphDocument([leaf('A', '', support), leaf('B')])), { code });
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
  const [rule] = parsed.supportClauses;
  assert.equal(rule.root.kind, 'and');
  assert.equal(rule.root.children[1].kind, 'or');
  assert.deepEqual(rule.dependencyPaths, ['世界/A', '世界/B', '世界/C']);
});

test('thing@program is a typed endpoint selector and never line-carried source code', () => {
  const parsed = parseGraphDocument(graphDocument([
    { 'thing@program': 'Predicate', situation: 'def main(arguments):\n    return True', contain: [], support: [] },
    leaf('H', '', [{ if: [{ 'thing@program': 'Predicate' }], 'then@current': true }])
  ]));
  assert.equal(parsed.supportClauses[0].root.kind, 'program');
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('Ordinary'), leaf('H', '', [{ if: [{ 'thing@program': 'Ordinary' }], 'then@current': true }])
  ])), { code: 'SUPPORT_PROGRAM_ENDPOINT_TYPE_MISMATCH' });
  assert.throws(() => parseGraphDocument(graphDocument([
    { 'thing@program': 'Predicate', situation: '', contain: [], support: [] },
    leaf('H', '', [{
      if: [{ 'thing@program': "satisfies({'thing':'Predicate'}, lambda node: True)" }],
      'then@current': true
    }])
  ])), { code: 'SUPPORT_INLINE_PROGRAM_UNSUPPORTED' });
});

test('native 3-to-3 is rejected and explicit 3-to-hub-to-3 uses two rules', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('A'), leaf('B'), leaf('C'),
    leaf('H', '', [{
      if: [{ and: [{ thing: 'A' }, { thing: 'B' }, { thing: 'C' }] }],
      'then@current': true,
      then: [{ thing: 'Y' }, { thing: 'Z' }]
    }]),
    leaf('Y'), leaf('Z')
  ])), { code: 'NATIVE_MANY_TO_MANY_SUPPORT_UNSUPPORTED' });

  const parsed = parseGraphDocument(graphDocument([
    leaf('A'), leaf('B'), leaf('C'),
    leaf('H', '', [
      { if: [{ and: [{ thing: 'A' }, { thing: 'B' }, { thing: 'C' }] }], 'then@current': true },
      { 'if@current': true, then: [{ thing: 'X' }, { thing: 'Y' }, { thing: 'Z' }] }
    ]),
    leaf('X'), leaf('Y'), leaf('Z')
  ]));
  assert.equal(parsed.supportClauses.length, 2);
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
  assert.deepEqual(parsed.supportClauses.map((rule) => rule.root.kind), ['thing', 'thing', 'thing', 'and', 'or']);
});

test('duplicate canonical owner rules are rejected instead of copied for visibility', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    leaf('A', '', [
      { 'if@current': true, then: [{ thing: 'B' }] },
      { 'if@current': true, then: [{ thing: 'B' }] }
    ]), leaf('B')
  ])), { code: 'DUPLICATE_SUPPORT_RULE' });
});

test('relative selector cannot escape current domain', () => {
  assert.throws(() => parseGraphDocument(graphDocument([
    { thing: '域A', situation: '', support: [], contain: [leaf('H', '', [{
      if: [{ thing: './秘密' }], 'then@current': true
    }])] },
    { thing: '域B', situation: '', support: [], contain: [leaf('秘密')] }
  ])), { code: 'SUPPORT_SELECTOR_OUT_OF_DOMAIN' });
});

test('cyclic topology terminates with stable rule and edge identities', () => {
  const parsed = parseGraphDocument(graphDocument([
    leaf('P', '', [{ 'if@current': true, then: [{ thing: 'Q' }] }]),
    leaf('Q', '', [{ 'if@current': true, then: [{ thing: 'P' }] }])
  ]));
  const propagated = propagateSupportClauses(parsed);
  assert.equal(propagated.visitedClauseIds.length, 2);
  assert.equal(new Set(propagated.edges.map((edge) => edge.id)).size, 2);
});

test('spatial export emits one owner-local current source rule', () => {
  const a = { id: 'a', key: 'root::a', path: 'root', label: 'A', detail: 'a', aliases: [] };
  const b = { id: 'b', key: 'root::b', path: 'root', label: 'B', detail: 'b', aliases: [] };
  const result = exportGraphDocument({ nodes: [a, b], edges: [{
    from: { key: a.key }, to: { key: b.key }, label: 'support'
  }] }, { collection: true });
  assert.deepEqual(result.graph.contain[0].support, [{
    'if@current': true, then: [{ thing: 'B' }]
  }]);
});

test('large rule owner classification stays independent of expression size', () => {
  const inaccessible = new Proxy(Array.from({ length: 4000 }), {
    get() { throw new Error('must not scan'); }
  });
  assert.deepEqual(classifySupportCurrentEndpoints({
    'if@current': true, if: inaccessible, then: inaccessible
  }), { currentAntecedent: true, currentConsequent: false });
});
