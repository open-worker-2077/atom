import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';

const leaf = (thing, situation = '', strut = []) => ({ thing, situation, slot: [], strut });
const documentWith = (slot) => ({
  config: { schema_version: '3.0.0' },
  graph: { thing: '世界', situation: '', slot, strut: [] }
});

test('strut if owns inline predicate source without creating a Program Thing dependency', () => {
  const source = [
    'def main(context):',
    "    return context['antecedents'][0]['situation'] == '✅'"
  ].join('\n');
  const parsed = parseGraphDocument(documentWith([
    leaf('前项', '✅', [{
      'if@current': true,
      if: [{ program: source }],
      then: [{ thing: '后项' }]
    }]),
    leaf('后项', '⌛️')
  ]));

  const [clause] = parsed.strutClauses;
  assert.equal(clause.root.kind, 'and');
  assert.deepEqual(clause.dependencyPaths, ['世界/前项']);
  assert.deepEqual(clause.antecedentPaths, ['世界/前项']);
  assert.deepEqual(clause.root.children[1], {
    kind: 'program',
    source,
    predicateId: 'strut:世界/前项:0:predicate:1',
    exprPath: [1]
  });
});

test('inline predicate source must be non-empty text', () => {
  for (const program of ['', '   ', null, 1]) {
    assert.throws(() => parseGraphDocument(documentWith([
      leaf('前项', '', [{ 'if@current': true, if: [{ program }], then: [{ thing: '后项' }] }]),
      leaf('后项')
    ])), { code: 'INVALID_STRUT_INLINE_PROGRAM' });
  }
});

test('retired thing@program cannot act as a strut predicate', () => {
  assert.throws(() => parseGraphDocument(documentWith([
    leaf('前项', '', [{
      'if@current': true,
      if: [{ 'thing@program': '判定节点' }],
      then: [{ thing: '后项' }]
    }]),
    { 'thing@program': '判定节点', situation: 'def main(context):\n    return True', slot: [], strut: [] },
    leaf('后项')
  ])), { code: 'RETIRED_STRUT_PROGRAM_SELECTOR' });
});
