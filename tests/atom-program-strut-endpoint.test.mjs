import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { buildStrutDeliveries, evaluateStrutClausesWithPrograms, propagateStrutClauses } from '../work-engine/atom-language/strut-runtime.mjs';

const atom = (thing, situation = '', strut = []) => ({ thing, situation, slot: [], strut });
const documentWith = (slot) => ({
  config: { schema_version: '3.0.0' },
  graph: { thing: '世界', situation: '', strut: [], slot }
});

test('a Strut-owned inline Program gates one ordinary Thing-to-Thing relation', async () => {
  const parsed = parseGraphDocument(documentWith([
    atom('前项', 'ordinary fact', [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: '后项' }]
    }]),
    atom('后项')
  ]));
  const clauseId = 'strut:世界/前项:0';
  const denied = await evaluateStrutClausesWithPrograms(parsed, {
    changedPaths: ['世界/前项'], evaluateProgram: async () => false
  });
  assert.equal(denied.get(clauseId).decision, false);
  assert.deepEqual(propagateStrutClauses(parsed, { decisions: denied }).edges, []);

  const established = await evaluateStrutClausesWithPrograms(parsed, {
    changedPaths: ['世界/前项'], evaluateProgram: async () => true
  });
  assert.equal(established.get(clauseId).decision, true);
  assert.deepEqual(
    propagateStrutClauses(parsed, { decisions: established }).edges
      .map(({ fromPath, toPath }) => ({ fromPath, toPath })),
    [{ fromPath: '世界/前项', toPath: '世界/后项' }]
  );
});

test('strict true produces immutable revision-bound deliveries while false produces none', () => {
  const parsed = parseGraphDocument(documentWith([
    atom('前项', '', [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: '后项甲' }, { thing: '后项乙' }]
    }]),
    atom('后项甲'), atom('后项乙')
  ]));
  const clauseId = 'strut:世界/前项:0';
  const truth = new Map([[clauseId, { status: 'true', decision: true, trace: [] }]]);
  const deliveries = buildStrutDeliveries(parsed, { decisions: truth, revision: 'sha256:r1' });
  assert.deepEqual(deliveries.map(({ consequentPath }) => consequentPath), ['世界/后项甲', '世界/后项乙']);
  assert.ok(deliveries.every(Object.isFrozen));
  assert.deepEqual(buildStrutDeliveries(parsed, {
    decisions: new Map([[clauseId, { status: 'false', decision: false, trace: [] }]]),
    revision: 'sha256:r1'
  }), []);
});

test('inline Strut Program returns strict bool and cannot emit effects', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('前项'), atom('后项')];
  const predicate = (source) => ({
    kind: 'program', source, predicateId: 'strut:世界/前项:0:predicate:1', exprPath: [1]
  });
  assert.equal(await scheduler.evaluateInlineStrutProgram(
    world, predicate('def main(context):\n    return True'), { context: {} }
  ), true);
  await assert.rejects(scheduler.evaluateInlineStrutProgram(
    world, predicate("def main(context):\n    return 'yes'"), { context: {} }
  ), { code: 'INVALID_PROGRAM_STRUT_RESULT' });
  await assert.rejects(scheduler.evaluateInlineStrutProgram(world, predicate([
    'def main(context):',
    "    transform({'thing':'前项','situation.rep.bad':None})",
    '    return True'
  ].join('\n')), { context: {} }), { code: 'PROGRAM_STRUT_EFFECT_FORBIDDEN' });
});

test('and/or short-circuits inline predicates in expression order', async () => {
  const parsed = parseGraphDocument(documentWith([
    atom('Source'),
    atom('Hub', '', [{
      if: [{ and: [{ thing: 'Source' }, { program: 'first' }, { program: 'skipped' }] }],
      'then@current': true
    }])
  ]));
  const calls = [];
  const decisions = await evaluateStrutClausesWithPrograms(parsed, {
    evaluateProgram: async ({ source }) => {
      calls.push(source);
      return source !== 'first';
    }
  });
  assert.equal(decisions.get('strut:世界/Hub:0').decision, false);
  assert.deepEqual(calls, ['first']);
});
