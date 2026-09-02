import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import {
  buildStrutDeliveries,
  evaluateStrutClausesWithPrograms
} from '../work-engine/atom-language/strut-runtime.mjs';

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

test('inline predicate executes in the restricted worker with immutable clause context', async () => {
  const source = [
    'def main(context):',
    "    return (context['antecedents'][0]['situation'] == '✅'",
    "            and context['transform']['action'] == 'click')"
  ].join('\n');
  const graph = documentWith([
    leaf('前项', '✅', [{ 'if@current': true, if: [{ program: source }], then: [{ thing: '后项' }] }]),
    leaf('后项', '⌛️')
  ]);
  const parsed = parseGraphDocument(graph);
  const scheduler = createProgramRuntimeScheduler();
  const context = {
    clauseId: 'strut:世界/前项:0',
    antecedents: [{ path: '世界/前项', thing: '前项', situation: '✅' }],
    consequents: [{ path: '世界/后项', thing: '后项', situation: '⌛️' }],
    transform: { targetPath: '世界/前项', action: 'click', parameter: null, payload: null, source: 'cli' }
  };
  const decisions = await evaluateStrutClausesWithPrograms(parsed, {
    evaluateProgram: (predicate) => scheduler.evaluateInlineStrutProgram(
      graph.graph.slot,
      predicate,
      { context }
    )
  });

  assert.equal(decisions.get(context.clauseId).decision, true);
  assert.deepEqual(buildStrutDeliveries(parsed, {
    decisions,
    revision: 'sha256:test'
  }).map(({ consequentPath }) => consequentPath), ['世界/后项']);
});

test('inline predicate requires strict bool and cannot emit effects', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [leaf('前项', '1'), leaf('后项', '2')];
  const predicate = (source) => ({
    kind: 'program', source, predicateId: 'strut:世界/前项:0:predicate:1', exprPath: [1]
  });

  await assert.rejects(
    scheduler.evaluateInlineStrutProgram(world, predicate("def main(context):\n    return 'yes'"), { context: {} }),
    { code: 'INVALID_PROGRAM_STRUT_RESULT' }
  );
  await assert.rejects(
    scheduler.evaluateInlineStrutProgram(world, predicate([
      'def main(context):',
      "    transform({'thing': '前项', 'situation.rep.bad': None})",
      '    return True'
    ].join('\n')), { context: {} }),
    { code: 'PROGRAM_STRUT_EFFECT_FORBIDDEN' }
  );
});
