import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { evaluateSupportClausesWithPrograms } from '../work-engine/atom-language/support-runtime.mjs';

const atom = (thing, situation = '', type = '', support = []) => ({
  [`thing${type ? `@${type}` : ''}`]: thing,
  situation,
  contain: [],
  support
});

test('antecedent Program endpoints return strict true or false through their own main(arguments)', async () => {
  const world = [
    atom('True Program', 'def main(arguments):\n    return True', 'program'),
    atom('False Program', 'def main(arguments):\n    return False', 'program')
  ];
  const scheduler = createProgramRuntimeScheduler();
  assert.equal(await scheduler.evaluateSupportProgram(world, 'True Program'), true);
  assert.equal(await scheduler.evaluateSupportProgram(world, 'False Program'), false);

  const nonBoolean = [atom('Bad Program', "def main(arguments):\n    return 'yes'", 'program')];
  await assert.rejects(scheduler.evaluateSupportProgram(nonBoolean, 'Bad Program'), {
    code: 'INVALID_PROGRAM_SUPPORT_RESULT'
  });
});

test('antecedent Program cannot emit effects or directly write a consequent', async () => {
  const world = [
    atom('Target', 'before'),
    atom('Writer', [
      'def main(arguments):',
      "    transform({'thing': 'Target', 'situation.rep.after': None})",
      '    return True'
    ].join('\n'), 'program')
  ];
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(scheduler.evaluateSupportProgram(world, 'Writer'), {
    code: 'PROGRAM_SUPPORT_EFFECT_FORBIDDEN'
  });
  assert.equal(world[0].situation, 'before');
});

test('and/or short-circuit Program antecedents and never execute a Program consequent', async () => {
  const input = {
    config: { schema_version: '2.0.0' },
    graph: {
      thing: '世界', situation: '', support: [], contain: [
        atom('False Program', '', 'program'),
        atom('Skipped Program', '', 'program'),
        atom('Consequent Program', '', 'program'),
        atom('Hub', '', '', [{
          if: [{ and: [
            { 'thing@program': 'False Program' },
            { 'thing@program': 'Skipped Program' }
          ] }],
          'then@current': true
        }]),
        atom('Source', '', '', [{
          'if@current': true,
          then: [{ 'thing@program': 'Consequent Program' }]
        }])
      ]
    }
  };
  const parsed = parseGraphDocument(input);
  const calls = [];
  const decisions = await evaluateSupportClausesWithPrograms(parsed, {
    evaluateProgram: async (path) => {
      calls.push(path);
      return path.endsWith('False Program') ? false : true;
    }
  });
  assert.equal(decisions.get('support:世界/Hub:0').decision, false);
  assert.equal(decisions.get('support:世界/Source:0').decision, true);
  assert.deepEqual(calls, ['世界/False Program']);

  calls.length = 0;
  const localDecisions = await evaluateSupportClausesWithPrograms(parsed, {
    changedPaths: ['世界/False Program'],
    evaluateProgram: async (path) => { calls.push(path); return false; }
  });
  assert.deepEqual([...localDecisions.keys()], ['support:世界/Hub:0']);
  assert.deepEqual(calls, ['世界/False Program']);
});
