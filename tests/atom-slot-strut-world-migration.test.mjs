import assert from 'node:assert/strict';
import test from 'node:test';

import { planGraphFourAxisMigration } from '../work-engine/atom-language/graph-migration-planner.mjs';

const leaf = (thing, situation = '', support = []) => ({
  thing, situation, contain: [], support
});
test('one-shot planner converts a complete 2.0 world to slot and strut without a runtime compatibility branch', () => {
  const source = [{
    thing: '世界',
    situation: '',
    contain: [
      leaf('前项', '', [{ 'if@current': true, then: [{ thing: '后项' }] }]),
      leaf('后项'),
      {
        'thing@program': '程序',
        situation: "def main(arguments):\n    transform({'thing': '结果', 'situation': '', 'contain': [], 'support': []})",
        contain: [],
        support: []
      }
    ],
    support: []
  }];

  const { graph, summary } = planGraphFourAxisMigration(source);

  assert.equal(summary.readyToCommit, true);
  assert.equal(summary.nodes, 4);
  assert.equal(graph[0].thing, '世界');
  assert.equal(graph[0].slot[0].strut.length, 1);
  assert.equal(graph[0].slot[2].situation.includes("'slot': []"), true);
  assert.equal(graph[0].slot[2].situation.includes("'strut': []"), true);
  assert.equal(JSON.stringify(graph).includes('"contain"'), false);
  assert.equal(JSON.stringify(graph).includes('"support"'), false);
});

test('one-shot planner rejects a world that mixes 2.0 and 3.0 axes', () => {
  assert.throws(() => planGraphFourAxisMigration([{
    thing: '混合', situation: '', contain: [], strut: []
  }]), { code: 'MIXED_GRAPH_AXIS_GENERATION' });
});
