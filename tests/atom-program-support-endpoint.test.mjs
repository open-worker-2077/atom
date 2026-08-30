import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import {
  evaluateSupportClausesWithPrograms,
  propagateSupportClauses
} from '../work-engine/atom-language/support-runtime.mjs';

const atom = (thing, situation = '', type = '', support = []) => ({
  [`thing${type ? `@${type}` : ''}`]: thing,
  situation,
  contain: [],
  support
});

test('an independent support-decision Program gates one ordinary Thing-to-Thing support', async () => {
  const graph = {
    config: { schema_version: '2.0.0' },
    graph: {
      thing: '世界', situation: '', support: [], contain: [
        atom('前项', 'ordinary facts do not provide booleans', '', [{
          'if@current': true,
          if: [{ 'thing@program': '推支判定' }],
          then: [{ thing: '后项' }]
        }]),
        atom('推支判定', 'def main(arguments):\n    return True', 'program'),
        {
          thing: '后项', situation: 'ordinary consequent', support: [], contain: [
            atom('后项 Program', "raise ValueError('must not execute')", 'program')
          ]
        },
        atom('无关前项', 'unrelated', '', [{
          'if@current': true,
          if: [{ 'thing@program': '无关判定' }],
          then: [{ thing: '无关后项' }]
        }]),
        atom('无关判定', 'def main(arguments):\n    return True', 'program'),
        atom('无关后项')
      ]
    }
  };
  const parsed = parseGraphDocument(graph);
  const scheduler = createProgramRuntimeScheduler();
  const clauseId = 'support:世界/前项:0';

  const evaluate = async (decision) => {
    const calls = [];
    const world = structuredClone(graph.graph.contain);
    world.find((node) => node['thing@program'] === '推支判定').situation = [
      'def main(arguments):',
      `    return ${decision ? 'True' : 'False'}`
    ].join('\n');
    const decisions = await evaluateSupportClausesWithPrograms(parsed, {
      changedPaths: ['世界/前项'],
      evaluateProgram: async (programPath) => {
        calls.push(programPath);
        return scheduler.evaluateSupportProgram(world, programPath.replace(/^世界\//u, ''));
      }
    });
    return { calls, decisions, propagation: propagateSupportClauses(parsed, { decisions }) };
  };

  const denied = await evaluate(false);
  assert.deepEqual([...denied.decisions.keys()], [clauseId]);
  assert.deepEqual(denied.calls, ['世界/推支判定']);
  assert.equal(denied.decisions.get(clauseId).decision, false);
  assert.deepEqual(denied.decisions.get(clauseId).trace, ['世界/推支判定']);
  assert.deepEqual(denied.propagation.edges, []);

  const established = await evaluate(true);
  assert.deepEqual([...established.decisions.keys()], [clauseId]);
  assert.deepEqual(established.calls, ['世界/推支判定']);
  assert.equal(established.decisions.get(clauseId).decision, true);
  assert.deepEqual(established.decisions.get(clauseId).trace, ['世界/推支判定']);
  assert.deepEqual(
    established.propagation.edges.map(({ fromPath, toPath }) => ({ fromPath, toPath })),
    [{ fromPath: '世界/前项', toPath: '世界/后项' }]
  );
});

test('support-decision Programs return strict true or false through their own main(arguments)', async () => {
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

test('support-decision Program cannot emit effects or directly write a consequent', async () => {
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

test('and/or short-circuit support-decision Programs and never execute a consequent Program', async () => {
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
